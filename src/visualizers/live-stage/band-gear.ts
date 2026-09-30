import * as THREE from 'three';
import type { LiveStagePalette } from './palette';

/**
 * Live Stage の「バンド」の機材 (stage-set.ts の StageSet が持つ)。ドラム・左右のアンプ・マイクスタンド。
 * - bass: バスドラムの面とスピーカーのコーンが前へ押し出される (立ち上がりは速く、引きは少しゆっくり)
 * - high: シンバルの縁がきらっと光り、少し揺れる
 * - rms (音量): アンプの上の LED のメーターが伸びる (緑 → 黄 → 赤)
 * 機材は照明の邪魔をしない暗いシルエット。光るのは LED とシンバルのきらめきだけ (小さいので画面全体は明るくしない)。
 * ctx.rng は使わない (stage-set.ts の説明)。
 */

/**
 * 機材の胴・箱の色: ほぼ黒に、縁 (面が視線と平行に近い所) だけ照明の色でほのかに明るくする (後ろから照らされた縁の光)。
 * 光らない (1 を超えない) ので Bloom には拾われない
 */
const RIM_VERT = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;
const RIM_FRAG = /* glsl */ `
uniform vec3 baseColor;
uniform vec3 rimColor;
uniform float rimStrength;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  float facing = clamp(abs(dot(normalize(vNormalV), normalize(-vViewPos))), 0.0, 1.0);
  float rim = pow(1.0 - facing, 2.5);
  gl_FragColor = vec4(baseColor + rimColor * rim * rimStrength, 1.0);
}
`;

/** 縁の光の強さ: 壁の照り返し (スモーク・ビートで変わる) に合わせる */
const RIM_BASE = 0.12;
const RIM_GLOW = 0.4;
/** カメラがドラムにこれより近いと、ドラムを隠す (ステージの奥からのカメラで、シンバルが目の前を覆わないように) */
const DRUM_HIDE_DIST = 2.5;

export interface GearAudio {
  bass: number;
  high: number;
  rms: number;
}

/** 奥の台 (ドラムを置く) の上面の高さと奥行きの中心 */
export interface GearDims {
  riserTop: number;
  riserZ: number;
}

/** アンプ 1 台 (キャビネット 2 段 + ヘッド) の置き場所: x (layoutScale を掛ける)・奥行き */
const AMP_X = 5.2;
const AMP_Z = -6.8;
const CAB = { w: 1.5, h: 1.0, d: 0.8 };
const HEAD = { w: 1.5, h: 0.42, d: 0.7 };
/** キャビネット 1 段のスピーカーの並び (2 x 2) */
const CONES_PER_CAB = 4;
const CONE_R = 0.2;
const LEDS_PER_AMP = 10;
/** マイクスタンドの x (layoutScale を掛ける) と奥行き */
const MIC_X = [-3.2, 0, 3.2];
const MIC_Z = -2.4;
/** 押し出す量 (バスドラムの面・コーン) */
const KICK_PUSH = 0.06;
const CONE_PUSH = 0.05;

/** 立ち上がりは速く、引きはゆっくりの追いかけ */
function follow(cur: number, target: number, dt: number, up: number, down: number): number {
  const v = Number.isFinite(target) ? Math.min(1, Math.max(0, target)) : 0;
  const rate = v > cur ? up : down;
  return cur + (v - cur) * (1 - Math.exp(-rate * dt));
}

/** LED の色 (下から緑 → 黄 → 赤)。点いているときは 1 を超えて Bloom で光る */
function ledColor(i: number, n: number, out: THREE.Color): THREE.Color {
  const f = i / Math.max(1, n - 1);
  if (f < 0.6) return out.setRGB(0.15, 1.4, 0.3);
  if (f < 0.85) return out.setRGB(1.4, 1.1, 0.15);
  return out.setRGB(1.6, 0.18, 0.12);
}

export class BandGear {
  readonly group = new THREE.Group();
  private readonly shell: THREE.ShaderMaterial;
  private readonly face: THREE.ShaderMaterial;
  private readonly coneMaterial: THREE.MeshBasicMaterial;
  private readonly bronze: THREE.MeshBasicMaterial;
  private readonly sparkleMaterial: THREE.SpriteMaterial;
  private readonly kickHead: THREE.Mesh;
  private readonly cymbals: THREE.Mesh[] = [];
  private readonly sparkles: THREE.Sprite[] = [];
  private readonly amps: THREE.Group[] = [];
  private readonly cones: THREE.InstancedMesh;
  private readonly caps: THREE.InstancedMesh;
  private readonly leds: THREE.InstancedMesh;
  private readonly mics: THREE.Group[] = [];
  private readonly drums = new THREE.Group();
  /** コーンの置き場所 (アンプの中の位置。押し出す前) */
  private readonly conePlaces: THREE.Vector3[] = [];
  private kick = 0;
  private cone = 0;
  private level = 0;
  private sparkle = 0;
  private t = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(
    private readonly dims: GearDims,
    track: <T extends { dispose(): void }>(obj: T) => T,
    sparkleTexture: THREE.Texture,
  ) {
    const rim = (name: string): THREE.ShaderMaterial =>
      track(
        new THREE.ShaderMaterial({
          name,
          vertexShader: RIM_VERT,
          fragmentShader: RIM_FRAG,
          uniforms: { baseColor: { value: new THREE.Color() }, rimColor: { value: new THREE.Color() }, rimStrength: { value: RIM_BASE } },
        }),
      );
    this.shell = rim('LiveStageGear');
    this.face = rim('LiveStageGearFace');
    this.coneMaterial = track(new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.bronze = track(new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.sparkleMaterial = track(
      new THREE.SpriteMaterial({ map: sparkleTexture, color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }),
    );
    const box = track(new THREE.BoxGeometry(1, 1, 1));
    const cyl = track(new THREE.CylinderGeometry(1, 1, 1, 28));
    const disc = track(new THREE.CircleGeometry(1, 28));

    // ---- ドラム (奥の台の上)
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], scale: [number, number, number], rot: [number, number, number] = [0, 0, 0]): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...pos);
      mesh.scale.set(...scale);
      mesh.rotation.set(...rot);
      this.drums.add(mesh);
      return mesh;
    };
    const R = Math.PI / 2;
    // バスドラム (胴は z 向き) と、客席を向いた面
    part(cyl, this.shell, [0, 0.5, 0], [0.5, 0.42, 0.5], [R, 0, 0]);
    this.kickHead = part(disc, this.face, [0, 0.5, 0.215], [0.47, 0.47, 1]);
    // タム 2 つ・フロアタム・スネア
    part(cyl, this.shell, [-0.34, 1.12, -0.05], [0.22, 0.2, 0.22], [0.35, 0, 0.12]);
    part(cyl, this.shell, [0.34, 1.12, -0.05], [0.24, 0.22, 0.24], [0.35, 0, -0.12]);
    part(cyl, this.shell, [-0.95, 0.42, 0.3], [0.3, 0.42, 0.3]);
    part(cyl, this.shell, [0.85, 0.66, 0.4], [0.3, 0.16, 0.3], [0.15, 0, 0]);
    // シンバル 3 枚 (左のクラッシュ・右のライド・ハイハット) とスタンド
    const cymbalAt: [number, number, number, number][] = [
      [-1.25, 1.7, 0.05, 0.42],
      [1.35, 1.8, -0.1, 0.48],
      [1.25, 1.05, 0.55, 0.3],
    ];
    for (const [x, y, z, r] of cymbalAt) {
      part(cyl, this.shell, [x, y / 2, z], [0.018, y, 0.018]);
      const cy = part(cyl, this.bronze, [x, y, z], [r, 0.012, r], [0.18, 0, 0]);
      this.cymbals.push(cy);
      const sp = new THREE.Sprite(this.sparkleMaterial);
      sp.position.set(x + r * 0.6, y + 0.05, z + r * 0.3);
      sp.scale.setScalar(0.7);
      sp.renderOrder = 4;
      this.sparkles.push(sp);
      this.drums.add(sp);
    }
    this.group.add(this.drums);

    // ---- アンプ (左右。キャビネット 2 段 + ヘッド)
    for (const side of [-1, 1]) {
      const amp = new THREE.Group();
      for (let k = 0; k < 2; k++) {
        const cab = new THREE.Mesh(box, this.shell);
        cab.scale.set(CAB.w, CAB.h * 0.97, CAB.d);
        cab.position.set(0, CAB.h * (k + 0.5), 0);
        amp.add(cab);
      }
      const head = new THREE.Mesh(box, this.shell);
      head.scale.set(HEAD.w, HEAD.h, HEAD.d);
      head.position.set(0, CAB.h * 2 + HEAD.h / 2, -0.05);
      amp.add(head);
      amp.userData.side = side;
      this.amps.push(amp);
      this.group.add(amp);
    }
    // スピーカーのコーン (外側の縁 = 明るめ、中のキャップ) を、全部のアンプぶんまとめて描く
    const coneCount = this.amps.length * 2 * CONES_PER_CAB;
    this.cones = new THREE.InstancedMesh(disc, this.coneMaterial, coneCount);
    this.caps = new THREE.InstancedMesh(disc, this.bronze, coneCount);
    for (const mesh of [this.cones, this.caps]) {
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    for (let k = 0; k < 2; k++) {
      for (let j = 0; j < CONES_PER_CAB; j++) {
        const cx = (j % 2 === 0 ? -1 : 1) * CAB.w * 0.24;
        const cy = CAB.h * (k + 0.5) + (j < 2 ? 1 : -1) * CAB.h * 0.22;
        this.conePlaces.push(new THREE.Vector3(cx, cy, CAB.d / 2 + 0.005));
      }
    }
    // LED のメーター (アンプのヘッドの前、横一列)
    this.leds = new THREE.InstancedMesh(box, track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })), this.amps.length * LEDS_PER_AMP);
    this.leds.frustumCulled = false;
    this.group.add(this.leds);

    // ---- マイクスタンド (手前に 3 本)
    for (let i = 0; i < MIC_X.length; i++) {
      const mic = new THREE.Group();
      const add = (geo: THREE.BufferGeometry, pos: [number, number, number], scale: [number, number, number], rot: [number, number, number] = [0, 0, 0]): void => {
        const mesh = new THREE.Mesh(geo, this.shell);
        mesh.position.set(...pos);
        mesh.scale.set(...scale);
        mesh.rotation.set(...rot);
        mic.add(mesh);
      };
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        add(box, [Math.sin(a) * 0.14, 0.03, Math.cos(a) * 0.14], [0.02, 0.02, 0.3], [0, a, 0]);
      }
      add(cyl, [0, 0.78, 0], [0.012, 1.5, 0.012]);
      add(cyl, [0, 1.55, 0.12], [0.009, 0.3, 0.009], [1.0, 0, 0]);
      add(cyl, [0, 1.62, 0.26], [0.03, 0.17, 0.03], [1.0, 0, 0]);
      this.mics.push(mic);
      this.group.add(mic);
    }
    this.layout(1);
    this.writeInstances();
  }

  /** 縦長の画面では横の間隔を詰める */
  layout(scale: number): void {
    const { riserTop, riserZ } = this.dims;
    this.drums.position.set(0, riserTop, riserZ + 0.2);
    for (const amp of this.amps) amp.position.set((amp.userData.side as number) * AMP_X * scale, 0, AMP_Z);
    for (let i = 0; i < this.mics.length; i++) this.mics[i]!.position.set(MIC_X[i]! * scale, 0, MIC_Z);
    this.writeInstances();
  }

  applyPalette(p: LiveStagePalette): void {
    // 胴・箱は灯体と同じくほぼ黒、面 (バスドラムの面・コーンの縁) は少し明るく、シンバルはほのかな金色
    (this.shell.uniforms.baseColor!.value as THREE.Color).copy(p.fixture).multiplyScalar(2.2);
    (this.face.uniforms.baseColor!.value as THREE.Color).copy(p.fixture).multiplyScalar(5);
    this.coneMaterial.color.copy(p.fixture).multiplyScalar(6);
    this.bronze.color.setRGB(0.035, 0.024, 0.01);
    // 縁の光は 2 色のライトの間の色
    const rimColor = this.c.copy(p.beamA).lerp(p.beamB, 0.5).multiplyScalar(0.6);
    for (const m of [this.shell, this.face]) (m.uniforms.rimColor!.value as THREE.Color).copy(rimColor);
  }

  /** camera = いまのカメラの位置 (近すぎるときドラムを隠す)、glow = 壁の照り返し (縁の光の強さ) */
  update(dt: number, audio: GearAudio, intensity: number, glow: number, camera: THREE.Vector3): void {
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    const k = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
    this.t += step;
    this.kick = follow(this.kick, audio.bass * k, step, 30, 9);
    this.cone = follow(this.cone, audio.bass * k, step, 24, 7);
    this.level = follow(this.level, audio.rms * (0.4 + 0.6 * k), step, 18, 3);
    this.sparkle = follow(this.sparkle, audio.high * k, step, 20, 5);

    const push = this.kick * KICK_PUSH;
    this.kickHead.position.z = 0.215 + push;
    this.kickHead.scale.set(0.47 * (1 + this.kick * 0.04), 0.47 * (1 + this.kick * 0.04), 1);
    this.sparkleMaterial.opacity = Math.min(0.9, this.sparkle * 0.9);
    for (let i = 0; i < this.cymbals.length; i++) {
      // シンバルは high で少し揺れる (叩かれて傾く)
      this.cymbals[i]!.rotation.z = Math.sin(this.t * (9 + i * 2.3) + i) * 0.06 * this.sparkle;
      this.sparkles[i]!.scale.setScalar(0.4 + this.sparkle * 0.5);
    }
    const rimStrength = RIM_BASE + RIM_GLOW * (Number.isFinite(glow) ? Math.min(1, Math.max(0, glow)) : 0);
    for (const m of [this.shell, this.face]) m.uniforms.rimStrength!.value = rimStrength;
    this.drums.visible = this.drums.getWorldPosition(this.v).distanceTo(camera) > DRUM_HIDE_DIST;
    this.writeInstances();
  }

  /** テスト用 */
  inspect(): { kickPush: number; conePush: number; ledsLit: number; sparkle: number; drumsVisible: boolean } {
    return { kickPush: this.kick * KICK_PUSH, conePush: this.cone * CONE_PUSH, ledsLit: this.litLeds(), sparkle: this.sparkleMaterial.opacity, drumsVisible: this.drums.visible };
  }

  dispose(): void {
    for (const mesh of [this.cones, this.caps, this.leds]) mesh.dispose();
    this.group.clear();
  }

  private litLeds(): number {
    return Math.round(Math.min(1, this.level * 1.25) * LEDS_PER_AMP);
  }

  /** コーンと LED の行列・色を書く */
  private writeInstances(): void {
    const lit = this.litLeds();
    let n = 0;
    let led = 0;
    for (const amp of this.amps) {
      amp.updateMatrix();
      for (const place of this.conePlaces) {
        this.v.copy(place);
        this.v.z += this.cone * CONE_PUSH;
        this.v.applyMatrix4(amp.matrix);
        const r = CONE_R * (1 + this.cone * 0.05);
        this.cones.setMatrixAt(n, this.m.compose(this.v, this.q.identity(), this.s.set(r, r, 1)));
        this.v.z += 0.004;
        this.caps.setMatrixAt(n, this.m.compose(this.v, this.q, this.s.set(r * 0.28, r * 0.28, 1)));
        n++;
      }
      for (let i = 0; i < LEDS_PER_AMP; i++) {
        const x = (i - (LEDS_PER_AMP - 1) / 2) * 0.1;
        this.v.set(x, CAB.h * 2 + HEAD.h * 0.5, HEAD.d / 2 - 0.04).applyMatrix4(amp.matrix);
        this.leds.setMatrixAt(led, this.m.compose(this.v, this.q.identity(), this.s.set(0.06, 0.05, 0.02)));
        ledColor(i, LEDS_PER_AMP, this.c);
        if (i >= lit) this.c.multiplyScalar(0.03);
        this.leds.setColorAt(led, this.c);
        led++;
      }
    }
    this.cones.instanceMatrix.needsUpdate = true;
    this.caps.instanceMatrix.needsUpdate = true;
    this.leds.instanceMatrix.needsUpdate = true;
    if (this.leds.instanceColor) this.leds.instanceColor.needsUpdate = true;
  }
}
