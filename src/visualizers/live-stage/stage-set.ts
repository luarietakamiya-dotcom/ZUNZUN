import * as THREE from 'three';
import { BandGear, type GearAudio } from './band-gear';
import type { LiveStagePalette } from './palette';
import { Uplights } from './uplights';

/**
 * Live Stage の舞台の機材 (このプリセットだけの設定 stageSet。既定 'none' = 今までどおり照明だけ)。
 * 'band' のとき: 格子のトラスと左右の柱 (門の形)、左右の黒い幕、奥のドラムの台、ドラム・アンプ・マイクスタンド (band-gear.ts)、
 * 奥の壁ぎわのアップライトと壁の色づき (uplights.ts)。
 * 機材は暗いシルエットにして、主役は照明のままにする。
 *
 * 形のばらつきに ctx.rng は使わない (rng を 1 回でも多く引くと、そのあとに選ばれるライトのパターンがずれて、
 * 機材なしの絵まで変わってしまうため)。形は決まった式だけで作る。
 */

export const STAGE_SETS = ['none', 'band'] as const;
export type StageSetName = (typeof STAGE_SETS)[number];

export function stageSetName(v: unknown): StageSetName {
  return typeof v === 'string' && (STAGE_SETS as readonly string[]).includes(v) ? (v as StageSetName) : 'none';
}

/** 舞台の寸法 (preset.ts の値と合わせる) */
export interface StageDims {
  trussY: number;
  trussZ: number;
  /** トラスの長さ (layoutScale を掛ける前) */
  span: number;
  wallZ: number;
}

/** トラスの太さ (四角い断面の一辺) と、格子の 1 マスの長さ */
const TRUSS_SIZE = 0.42;
const TRUSS_BAY = 0.9;
/** 格子の部材の太さ */
const CHORD = 0.05;
const LACE = 0.025;
/** 左右の幕: 位置 (x、layoutScale を掛ける)・奥行きの範囲・高さ */
const DRAPE_X = 15;
const DRAPE_Z0 = -10;
const DRAPE_Z1 = 14;
const DRAPE_H = 16;
/** 奥のドラムの台 (幅・奥行き・高さ、中心の z は壁からの距離) */
const RISER = { w: 5.5, d: 3.2, h: 0.55, fromWall: 2.6 };

interface Segment {
  a: THREE.Vector3;
  b: THREE.Vector3;
  t: number;
}

/**
 * 四角い断面の格子トラスの部材 (from → to の向きに伸びる)。4 本の太い柱 (弦材) と、各面のジグザグの筋交い。
 * side = 断面の横の向き (from → to と直交する単位ベクトル)、bays = 筋交いのマスの数
 */
export function trussSegments(from: THREE.Vector3, to: THREE.Vector3, side: THREE.Vector3, bays: number, size = TRUSS_SIZE): Segment[] {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (!(len > 0)) return [];
  dir.divideScalar(len);
  const s = side.clone().sub(dir.clone().multiplyScalar(side.dot(dir))).normalize();
  const u = new THREE.Vector3().crossVectors(dir, s).normalize();
  const h = size / 2;
  // 断面の 4 隅 (順に回る)
  const corners = [s.clone().multiplyScalar(h).addScaledVector(u, h), s.clone().multiplyScalar(-h).addScaledVector(u, h), s.clone().multiplyScalar(-h).addScaledVector(u, -h), s.clone().multiplyScalar(h).addScaledVector(u, -h)];
  const out: Segment[] = [];
  for (const c of corners) out.push({ a: from.clone().add(c), b: to.clone().add(c), t: CHORD });
  const n = Math.max(1, Math.round(bays));
  const at = (k: number, c: THREE.Vector3): THREE.Vector3 => from.clone().addScaledVector(dir, (len * k) / n).add(c);
  for (let face = 0; face < 4; face++) {
    const c0 = corners[face]!;
    const c1 = corners[(face + 1) % 4]!;
    for (let k = 0; k < n; k++) {
      // ジグザグ: 偶数マスは c0 → c1、奇数マスは c1 → c0
      const [p, q] = k % 2 === 0 ? [c0, c1] : [c1, c0];
      out.push({ a: at(k, p), b: at(k + 1, q), t: LACE });
    }
  }
  return out;
}

/** 部材 1 本を、1x1x1 の箱を伸ばして置く行列にする (箱の +Y を部材の向きへ) */
function segmentMatrix(seg: Segment, out: THREE.Matrix4): THREE.Matrix4 {
  const dir = seg.b.clone().sub(seg.a);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.divideScalar(Math.max(1e-9, len)));
  const mid = seg.a.clone().add(seg.b).multiplyScalar(0.5);
  return out.compose(mid, q, new THREE.Vector3(seg.t, len, seg.t));
}

const DRAPE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** 黒い幕: 縦のひだ (明暗のくり返し) と、下の方に壁と同じほのかな照り返し */
const DRAPE_FRAG = /* glsl */ `
uniform vec3 baseColor;
uniform vec3 glowColor;
uniform float glow;
varying vec2 vUv;
void main() {
  float fold = 0.55 + 0.45 * sin(vUv.x * 150.0 + sin(vUv.x * 23.0) * 1.6);
  vec3 col = baseColor * (0.7 + 0.9 * fold);
  col += glowColor * glow * 0.5 * exp(-vUv.y * 5.0) * (0.6 + 0.4 * fold);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class StageSet {
  readonly group = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly metal: THREE.MeshBasicMaterial;
  private readonly riserMaterial: THREE.MeshBasicMaterial;
  private readonly drapeMaterial: THREE.ShaderMaterial;
  private readonly truss: THREE.InstancedMesh;
  private readonly drapes: THREE.Mesh[] = [];
  private readonly riser: THREE.Mesh;
  private readonly box: THREE.BoxGeometry;
  private readonly gear: BandGear;
  private readonly uplights: Uplights;
  private name: StageSetName = 'none';

  /** sparkleTexture = シンバルのきらめきに使う丸い光 (preset の灯体と同じもの。片づけは preset 側) */
  constructor(
    private readonly dims: StageDims,
    sparkleTexture: THREE.Texture,
  ) {
    this.metal = this.track(new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.riserMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.drapeMaterial = this.track(
      new THREE.ShaderMaterial({
        name: 'LiveStageDrape',
        vertexShader: DRAPE_VERT,
        fragmentShader: DRAPE_FRAG,
        uniforms: { baseColor: { value: new THREE.Color() }, glowColor: { value: new THREE.Color() }, glow: { value: 0.1 } },
        side: THREE.DoubleSide,
      }),
    );
    this.box = this.track(new THREE.BoxGeometry(1, 1, 1));
    this.truss = new THREE.InstancedMesh(this.box, this.metal, this.segments(1).length);
    this.truss.frustumCulled = false;
    this.group.add(this.truss);

    const drapeGeo = this.track(new THREE.PlaneGeometry(DRAPE_Z1 - DRAPE_Z0, DRAPE_H));
    for (const side of [-1, 1]) {
      const d = new THREE.Mesh(drapeGeo, this.drapeMaterial);
      d.rotation.y = side * (Math.PI / 2);
      this.drapes.push(d);
      this.group.add(d);
    }
    this.riser = new THREE.Mesh(this.box, this.riserMaterial);
    this.group.add(this.riser);
    this.gear = new BandGear({ riserTop: RISER.h, riserZ: dims.wallZ + RISER.fromWall }, (o) => this.track(o), sparkleTexture);
    this.group.add(this.gear.group);
    this.uplights = new Uplights(dims.wallZ, (o) => this.track(o), sparkleTexture);
    this.group.add(this.uplights.group);
    this.group.visible = false;
    this.layout(1);
  }

  get current(): StageSetName {
    return this.name;
  }

  /** 機材の組を切り替える ('none' なら何も出さない) */
  set(name: StageSetName): void {
    this.name = name;
    this.group.visible = name !== 'none';
  }

  /** 縦長の画面では横の間隔を詰める (preset の layoutScale と同じ値) */
  layout(scale: number): void {
    const segs = this.segments(scale);
    const m = new THREE.Matrix4();
    for (let i = 0; i < segs.length; i++) this.truss.setMatrixAt(i, segmentMatrix(segs[i]!, m));
    this.truss.count = segs.length;
    this.truss.instanceMatrix.needsUpdate = true;
    this.truss.computeBoundingSphere();

    const { wallZ } = this.dims;
    const zMid = (DRAPE_Z0 + DRAPE_Z1) / 2;
    this.drapes[0]!.position.set(-DRAPE_X * scale, DRAPE_H / 2, zMid);
    this.drapes[1]!.position.set(DRAPE_X * scale, DRAPE_H / 2, zMid);
    this.riser.scale.set(RISER.w * Math.max(0.6, scale), RISER.h, RISER.d);
    this.riser.position.set(0, RISER.h / 2, wallZ + RISER.fromWall);
    this.gear?.layout(scale);
    this.uplights?.layout(scale);
  }

  applyPalette(p: LiveStagePalette): void {
    // トラスは照明の光を受けて、灯体 (ほぼ黒) より少しだけ明るい金属に見せる
    this.metal.color.copy(p.fixture).multiplyScalar(4);
    this.riserMaterial.color.copy(p.fixture).multiplyScalar(1.6);
    (this.drapeMaterial.uniforms.baseColor!.value as THREE.Color).copy(p.wall);
    (this.drapeMaterial.uniforms.glowColor!.value as THREE.Color).copy(p.wallGlow);
    this.gear.applyPalette(p);
    this.uplights.applyPalette(p);
  }

  /** 毎フレーム: 幕の照り返しを壁と同じ明るさにし、機材を音で動かす (機材なしのときは何もしない) */
  /** density = スモークの濃さ (アップライトの光の筋の濃さ。ムービングライトと同じ値) */
  update(dt: number, audio: GearAudio, intensity: number, wallGlow: number, camera: THREE.Vector3, density: number): void {
    if (this.name === 'none') return;
    const glow = Number.isFinite(wallGlow) ? wallGlow : 0;
    this.drapeMaterial.uniforms.glow!.value = glow;
    this.gear.update(dt, audio, intensity, glow, camera);
    this.uplights.update(dt, audio.beat, intensity, density);
  }

  /** テスト用: 部材の数・幕の位置など */
  inspect(): { visible: boolean; trussParts: number; drapeX: number[]; riserTop: number; gear: ReturnType<BandGear['inspect']>; uplights: ReturnType<Uplights['inspect']> } {
    return {
      uplights: this.uplights.inspect(),
      gear: this.gear.inspect(),
      visible: this.group.visible,
      trussParts: this.truss.count,
      drapeX: this.drapes.map((d) => d.position.x),
      riserTop: this.riser.position.y + this.riser.scale.y / 2,
    };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.truss.dispose();
    this.gear.dispose();
    this.group.clear();
  }

  private track<T extends { dispose(): void }>(obj: T): T {
    this.disposables.push(obj);
    return obj;
  }

  /** 門の形のトラス: 上の横のトラスと、左右の柱 (床からトラスの上まで) */
  private segments(scale: number): Segment[] {
    const { trussY, trussZ, span } = this.dims;
    const half = (span * scale) / 2 + TRUSS_SIZE / 2;
    const top = trussY + 0.42;
    const z = trussZ;
    const X = new THREE.Vector3(1, 0, 0);
    const Z = new THREE.Vector3(0, 0, 1);
    // マスの数は縮める前の長さで決める (部材の数を画面の形で変えない。InstancedMesh の数は最初に決まる)
    const topBays = Math.round((span + TRUSS_SIZE * 2) / TRUSS_BAY);
    const legBays = Math.round((top - TRUSS_SIZE / 2) / TRUSS_BAY);
    return [
      ...trussSegments(new THREE.Vector3(-half - TRUSS_SIZE / 2, top, z), new THREE.Vector3(half + TRUSS_SIZE / 2, top, z), Z, topBays),
      ...trussSegments(new THREE.Vector3(-half, 0, z), new THREE.Vector3(-half, top - TRUSS_SIZE / 2, z), X, legBays),
      ...trussSegments(new THREE.Vector3(half, 0, z), new THREE.Vector3(half, top - TRUSS_SIZE / 2, z), X, legBays),
    ];
  }
}
