import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SpeakerRackPalette } from './palette';
import { DriverField, GeometryCache, type Materials, type Track } from './parts';

/**
 * 並び「積み上げたスピーカーの通路」(参考画像③)。奥へ続く通路の両側に、大きさの違うスピーカーを積み上げる。
 * 奥にはスモーク、上からは青白い光の筋、積み上げのあいだに琥珀色の灯り、濡れた床に映り込む。
 * 低音でコーンが動き、手前から奥へ少しずつ遅れて動く (波が奥へ伝わって見える。遅れは preset の DelayLine)。
 * 大きさ・積み方のばらつきは preset から渡される rng (ctx.rng) で決める。
 * 部品が多い (箱 80 前後・スピーカー 100 前後) ので、同じ種類の部品はまとめて描く (InstancedMesh)。
 * 1 つずつ描くと 1,500 回ほど描くことになり、ヘッドレスのテストで 1 コマに 1 秒以上かかった。
 */

export const ALLEY_ROWS = 7;
const ROW_DEPTH = 3.4;
const FIRST_Z = -1.5;
/** 通路の半分の幅 (手前はこれに FLARE だけ広げる) */
const CORRIDOR = 2.8;
const FLARE = 0.9;
/** 1 列奥へ行くごとの遅れ (秒) */
export const ALLEY_ROW_DELAY = 0.035;
/**
 * 床に映すものの印 (three.js の layers)。濡れた床に映るのは光 (上からの光の筋・灯り・LED・スモーク) だけにする。
 * 暗いスピーカーは映ってもほとんど見えず、映すと全部をもう一度描くことになって、とても重かった (1 コマの時間が約 4 倍)
 */
export const REFLECT_LAYER = 1;
export const ALLEY_CAMERA = { pos: new THREE.Vector3(0, 2.1, 9.5), look: new THREE.Vector3(0, 2.6, -18), fov: 46 };

/** 箱の種類: 大きさとスピーカー (半径と数) */
interface CabKind {
  w: number;
  h: number;
  drivers: { r: number; x: number; y: number }[];
  rack?: boolean;
}
const KINDS: CabKind[] = [
  { w: 2.2, h: 2.2, drivers: [{ r: 0.78, x: 0, y: 0 }] },
  { w: 1.6, h: 1.6, drivers: [{ r: 0.56, x: 0, y: 0 }] },
  { w: 2.6, h: 1.4, drivers: [{ r: 0.46, x: -0.62, y: 0 }, { r: 0.46, x: 0.62, y: 0 }] },
  { w: 1.4, h: 2.8, drivers: [{ r: 0.5, x: 0, y: 0.62 }, { r: 0.5, x: 0, y: -0.62 }] },
  { w: 2.0, h: 1.0, drivers: [], rack: true },
];
const CAB_DEPTH = 1.5;

const FLOOR_SHADER = {
  name: 'SpeakerAlleyFloor',
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    floorColor: { value: new THREE.Color() },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vPlane;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vPlane = position.xy;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 floorColor;
    varying vec4 vUv;
    varying vec2 vPlane;
    void main() {
      vec2 uv = vUv.xy / vUv.w;
      vec3 refl = texture2D(tDiffuse, uv).rgb * 0.5;
      refl += texture2D(tDiffuse, uv + vec2(0.0, 0.008)).rgb * 0.25;
      refl += texture2D(tDiffuse, uv - vec2(0.0, 0.008)).rgb * 0.25;
      // 濡れた床: 反射はほのかに、手前ほど弱く
      float wet = mix(0.18, 0.4, smoothstep(-6.0, 20.0, vPlane.y));
      gl_FragColor = vec4(floorColor + refl * wet, 1.0);
    }
  `,
};

const HAZE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** スモーク: ゆっくり流れるむら。下ほど濃く、端は消える。加算 */
const HAZE_FRAG = /* glsl */ `
uniform vec3 color;
uniform float density;
uniform float time;
varying vec2 vUv;
varying vec3 vWorld;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 q = vWorld.xy * vec2(0.22, 0.35) + vec2(time * 0.05, -time * 0.02);
  float v = n(q) * 0.6 + n(q * 2.3 + 7.0) * 0.4;
  float low = 1.0 - smoothstep(0.1, 0.9, vUv.y);
  float sides = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
  gl_FragColor = vec4(color * density * v * low * sides, 1.0);
}
`;

/** 上からの光の筋: 根元が明るく先へ行くほど弱く、輪郭が消える円錐。加算 */
const CONE_VERT = /* glsl */ `
varying float vAlong;
varying vec3 vNormalV;
varying vec3 vViewPos;
uniform float len;
void main() {
  vAlong = clamp(-position.y / len, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;
const CONE_FRAG = /* glsl */ `
uniform vec3 color;
uniform float strength;
varying float vAlong;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  float along = clamp(vAlong, 0.0, 1.0);
  float facing = clamp(abs(dot(normalize(vNormalV), normalize(-vViewPos))), 0.0, 1.0);
  float a = pow(facing, 2.0) * pow(1.0 - along, 1.5) * strength;
  gl_FragColor = vec4(color * a, 1.0);
}
`;

export interface AlleyAudioView {
  /** 列ごとの前後の動き (手前 0 → 奥)。長さ ALLEY_ROWS */
  rows: ArrayLike<number>;
  spectrum: ArrayLike<number>;
  /** 灯りの明るさ (0..1。beat で少し強まる) */
  accent: number;
  time: number;
}

export class AlleyScene {
  readonly group = new THREE.Group();
  /** スピーカー (列ごとに同じ動き) */
  private readonly drivers: DriverField;
  /** 機材の LED (全部の機材を 1 つにまとめる。1 台 = 8 本 × 3 段) */
  private readonly leds: THREE.InstancedMesh;
  private readonly ledCount: number;
  private readonly led = new THREE.Color();
  private readonly ledHot = new THREE.Color();
  private readonly tmpColor = new THREE.Color();
  private readonly floor: Reflector;
  private readonly floorUniforms: Record<string, THREE.IUniform>;
  private readonly hazeMaterials: THREE.ShaderMaterial[] = [];
  private readonly coneMaterials: THREE.ShaderMaterial[] = [];
  private readonly glowMaterial: THREE.SpriteMaterial;
  private readonly accentLights: THREE.PointLight[] = [];
  private readonly accent = new THREE.Color();
  private readonly spectrumBars = new Float32Array(8);
  private readonly instancedMeshes: THREE.InstancedMesh[] = [];

  constructor(m: Materials, track: Track, rng: () => number, haloTexture: THREE.Texture) {
    const cache = new GeometryCache(track);
    const box = cache.get('box', () => new THREE.BoxGeometry(1, 1, 1));
    this.drivers = new DriverField(m, cache);

    const baffleOf = (kind: CabKind, k: number): THREE.BufferGeometry =>
      cache.get(`baffle:${k}`, () => {
        const s = new THREE.Shape();
        s.moveTo(-kind.w / 2, -kind.h / 2);
        s.lineTo(kind.w / 2, -kind.h / 2);
        s.lineTo(kind.w / 2, kind.h / 2);
        s.lineTo(-kind.w / 2, kind.h / 2);
        s.closePath();
        for (const d of kind.drivers) {
          const p = new THREE.Path();
          p.absarc(d.x, d.y, d.r * 1.02, 0, Math.PI * 2, true);
          s.holes.push(p);
        }
        return new THREE.ShapeGeometry(s, 48);
      });
    const frameOf = (kind: CabKind, k: number): THREE.BufferGeometry =>
      cache.get(`frame:${k}`, () => {
        const parts = (
          [
            [0, kind.h / 2 - 0.04, kind.w, 0.08],
            [0, -kind.h / 2 + 0.04, kind.w, 0.08],
            [-kind.w / 2 + 0.04, 0, 0.08, kind.h],
            [kind.w / 2 - 0.04, 0, 0.08, kind.h],
          ] as const
        ).map(([bx, by, bw, bh]) => new THREE.BoxGeometry(bw, bh, 0.05).translate(bx, by, 0.02));
        const merged = mergeGeometries(parts)!;
        for (const p of parts) p.dispose();
        return merged;
      });

    // ---- 両側の積み上げ (列ごとに、通路に近い柱と外側の高い柱)。置き場所を集めてから、種類ごとにまとめて描く
    const bodies: THREE.Matrix4[] = [];
    const fronts = KINDS.map(() => [] as THREE.Matrix4[]);
    const ledSpots: THREE.Matrix4[] = [];
    const cab = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const tmp = new THREE.Matrix4();
    for (const side of [-1, 1]) {
      for (let row = 0; row < ALLEY_ROWS; row++) {
        const z = FIRST_Z - row * ROW_DEPTH;
        for (let col = 0; col < 2; col++) {
          const target = col === 0 ? 2.5 + rng() * 3.2 : 4.5 + rng() * 4;
          let y = 0;
          let x0 = 0;
          while (y < target) {
            const k = Math.floor(rng() * KINDS.length) % KINDS.length;
            const kind = KINDS[k]!;
            if (x0 === 0) x0 = CORRIDOR + FLARE * Math.max(0, 1 - row / 3) + (col === 0 ? 0 : 2.7) + kind.w / 2 + rng() * 0.3;
            const pos = new THREE.Vector3(side * (x0 + (rng() - 0.5) * 0.25), y + kind.h / 2, z + (rng() - 0.5) * 0.6 - col * 0.8);
            // 通路の方へ少し向ける
            q.setFromAxisAngle(up, -side * (0.28 + rng() * 0.12));
            cab.compose(pos, q, new THREE.Vector3(1, 1, 1));
            bodies.push(cab.clone().multiply(tmp.makeTranslation(0, 0, -0.35 - CAB_DEPTH / 2)).multiply(tmp.makeScale(kind.w, kind.h, CAB_DEPTH)));
            fronts[k]!.push(cab.clone());
            for (const d of kind.drivers) this.drivers.add(cab.clone().multiply(tmp.makeTranslation(d.x, d.y, 0.01)), d.r, row);
            if (kind.rack) {
              for (let b = 0; b < 8; b++) for (let sgm = 0; sgm < 3; sgm++) ledSpots.push(cab.clone().multiply(tmp.makeTranslation(-0.35 + (b - 3.5) * 0.17, -0.1 + sgm * 0.09, 0.03)));
            }
            y += kind.h + 0.02;
          }
        }
      }
    }
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[]): void => {
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.frustumCulled = false;
      this.instancedMeshes.push(mesh);
      this.group.add(mesh);
    };
    instanced(box, m.cabinet, bodies);
    KINDS.forEach((kind, k) => {
      instanced(baffleOf(kind, k), m.cabinet, fronts[k]!);
      instanced(frameOf(kind, k), m.darkMetal, fronts[k]!);
    });
    this.drivers.build();
    this.group.add(this.drivers.group);
    this.ledCount = ledSpots.length;
    this.leds = new THREE.InstancedMesh(cache.get('led', () => new THREE.BoxGeometry(0.12, 0.06, 0.03)), m.glowBasic, Math.max(1, ledSpots.length));
    ledSpots.forEach((mm, i) => this.leds.setMatrixAt(i, mm));
    for (let i = 0; i < Math.max(1, ledSpots.length); i++) this.leds.setColorAt(i, this.tmpColor.setRGB(0, 0, 0));
    this.leds.count = ledSpots.length;
    this.leds.frustumCulled = false;
    this.leds.layers.enable(REFLECT_LAYER);
    this.group.add(this.leds);

    // ---- 濡れた床
    this.floor = new Reflector(cache.get('floor', () => new THREE.PlaneGeometry(40, 70)), {
      clipBias: 0.003,
      textureWidth: 512,
      textureHeight: 512,
      color: 0xffffff,
      shader: FLOOR_SHADER,
    });
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.z = -18;
    this.floor.camera.layers.set(REFLECT_LAYER);
    this.floorUniforms = (this.floor.material as THREE.ShaderMaterial).uniforms;
    this.group.add(this.floor);

    // ---- 奥のスモーク (縦の板 3 枚)
    const hazeGeo = cache.get('haze', () => new THREE.PlaneGeometry(14, 9));
    for (const z of [-9, -15, -21]) {
      const hm = track(
        new THREE.ShaderMaterial({
          name: 'SpeakerAlleyHaze',
          vertexShader: HAZE_VERT,
          fragmentShader: HAZE_FRAG,
          uniforms: { color: { value: new THREE.Color() }, density: { value: 0.12 }, time: { value: 0 } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const haze = new THREE.Mesh(hazeGeo, hm);
      haze.position.set(0, 3.4, z);
      haze.renderOrder = 1;
      haze.layers.enable(REFLECT_LAYER);
      this.hazeMaterials.push(hm);
      this.group.add(haze);
    }

    // ---- 上からの光 (本物の照明 + 見える光の筋) 2 つ
    const coneLen = 9;
    const coneGeo = cache.get('cone', () => new THREE.CylinderGeometry(0.1, 1.6, coneLen, 32, 6, true).translate(0, -coneLen / 2, 0));
    for (const side of [-1, 1]) {
      const pos = new THREE.Vector3(side * 3.4, 8.2, -7);
      const target = new THREE.Vector3(side * 1.2, 0, -9);
      const spot = new THREE.SpotLight(0xcfe0ff, 45, 16, Math.PI / 7, 0.5, 1.4);
      spot.position.copy(pos);
      spot.target.position.copy(target);
      this.group.add(spot, spot.target);
      const cm = track(
        new THREE.ShaderMaterial({
          name: 'SpeakerAlleyCone',
          vertexShader: CONE_VERT,
          fragmentShader: CONE_FRAG,
          uniforms: { color: { value: new THREE.Color(0.55, 0.65, 0.85) }, strength: { value: 0.35 }, len: { value: coneLen } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const cone = new THREE.Mesh(coneGeo, cm);
      cone.position.copy(pos);
      // 円錐の -Y を、光の向きへ
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), target.clone().sub(pos).normalize());
      cone.renderOrder = 2;
      cone.layers.enable(REFLECT_LAYER);
      this.coneMaterials.push(cm);
      this.group.add(cone);
      const lamp = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: haloTexture, color: new THREE.Color(2.0, 2.2, 2.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
      lamp.position.copy(pos);
      lamp.scale.setScalar(0.9);
      lamp.layers.enable(REFLECT_LAYER);
      this.group.add(lamp);
    }

    // ---- 積み上げのあいだの琥珀色の灯り (点光源 + にじみ)
    this.glowMaterial = track(new THREE.SpriteMaterial({ map: haloTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    for (const [x, y, z] of [
      [-3.1, 5.6, -4],
      [3.1, 5.2, -5],
      [-3.0, 1.2, -12],
      [3.0, 1.6, -13],
    ] as const) {
      const l = new THREE.PointLight(0xffffff, 5, 7, 1.6);
      l.position.set(x, y, z);
      this.accentLights.push(l);
      const g = new THREE.Sprite(this.glowMaterial);
      g.position.set(x, y, z);
      g.scale.setScalar(3.2);
      g.renderOrder = 3;
      g.layers.enable(REFLECT_LAYER);
      this.group.add(l, g);
    }
  }

  applyPalette(p: SpeakerRackPalette): void {
    this.accent.copy(p.accent);
    for (const l of this.accentLights) l.color.copy(p.accent);
    this.led.copy(p.led);
    this.ledHot.copy(p.ledHot);
    for (const h of this.hazeMaterials) (h.uniforms.color!.value as THREE.Color).setRGB(0.35, 0.4, 0.5);
    (this.floorUniforms.floorColor!.value as THREE.Color).copy(p.background).multiplyScalar(1.5);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.floor.getRenderTarget().setSize(Math.max(1, Math.round(width * pixelRatio * 0.35)), Math.max(1, Math.round(height * pixelRatio * 0.35)));
  }

  update(a: AlleyAudioView): void {
    this.drivers.setExcursion(a.rows);
    // 機材の LED は、スペクトラムを 8 本にまとめたもの (1 本 3 段。いちばん上は ledHot)
    for (let i = 0; i < 8; i++) this.spectrumBars[i] = a.spectrum[Math.floor(((i + 0.5) / 8) * a.spectrum.length)] ?? 0;
    for (let i = 0; i < this.ledCount; i++) {
      const b = Math.floor(i / 3) % 8;
      const sgm = i % 3;
      const lit = Math.round(Math.min(1, Math.max(0, this.spectrumBars[b]!)) * 3) > sgm;
      this.tmpColor.copy(sgm === 2 ? this.ledHot : this.led).multiplyScalar(lit ? 1 : 0.035);
      this.leds.setColorAt(i, this.tmpColor);
    }
    if (this.leds.instanceColor) this.leds.instanceColor.needsUpdate = true;
    const lvl = 0.8 + 0.2 * (Number.isFinite(a.accent) ? Math.min(1, Math.max(0, a.accent)) : 0);
    for (const l of this.accentLights) l.intensity = 5 * lvl;
    this.glowMaterial.color.copy(this.accent).multiplyScalar(0.45 * lvl);
    for (const h of this.hazeMaterials) h.uniforms.time!.value = a.time;
  }

  /** テスト用: 列ごとのスピーカーの数と、各列の最初のスピーカーの動き */
  inspectRows(): { counts: number[]; excursion: number[] } {
    return this.drivers.inspect();
  }

  /** テスト用: 描く回数の目安 (このまとまりの中の物の数) */
  get objectCount(): number {
    let n = 0;
    this.group.traverse(() => n++);
    return n;
  }

  dispose(): void {
    this.drivers.dispose();
    for (const mesh of this.instancedMeshes) mesh.dispose();
    this.leds.dispose();
    this.floor.dispose();
    this.group.clear();
  }
}
