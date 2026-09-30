import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { SpeakerRackPalette } from './palette';
import { Driver, GeometryCache, LedBars, makeKnob, type Materials, type Track } from './parts';

/**
 * 並び「積み上げたスピーカーの通路」(参考画像③)。奥へ続く通路の両側に、大きさの違うスピーカーを積み上げる。
 * 奥にはスモーク、上からは青白い光の筋、積み上げのあいだに琥珀色の灯り、濡れた床に映り込む。
 * 低音でコーンが動き、手前から奥へ少しずつ遅れて動く (波が奥へ伝わって見える。遅れは preset の DelayLine)。
 * 大きさ・積み方のばらつきは preset から渡される rng (ctx.rng) で決める。
 */

export const ALLEY_ROWS = 7;
const ROW_DEPTH = 3.4;
const FIRST_Z = 0.5;
const CORRIDOR = 2.7;
/** 1 列奥へ行くごとの遅れ (秒) */
export const ALLEY_ROW_DELAY = 0.035;
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
  /** 列ごとのスピーカー (動かすもの) */
  private readonly rowDrivers: Driver[][] = [];
  private readonly racks: LedBars[] = [];
  private readonly floor: Reflector;
  private readonly floorUniforms: Record<string, THREE.IUniform>;
  private readonly hazeMaterials: THREE.ShaderMaterial[] = [];
  private readonly coneMaterials: THREE.ShaderMaterial[] = [];
  private readonly glowMaterial: THREE.SpriteMaterial;
  private readonly accentLights: THREE.PointLight[] = [];
  private readonly accent = new THREE.Color();
  private readonly spectrumBars = new Float32Array(8);

  constructor(m: Materials, track: Track, rng: () => number, haloTexture: THREE.Texture) {
    const cache = new GeometryCache(track);
    const box = cache.get('box', () => new THREE.BoxGeometry(1, 1, 1));
    for (let r = 0; r < ALLEY_ROWS; r++) this.rowDrivers.push([]);

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

    // ---- 両側の積み上げ (列ごとに、通路に近い柱と外側の高い柱)
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
            const cab = new THREE.Group();
            if (x0 === 0) x0 = CORRIDOR + (col === 0 ? 0 : 2.7) + kind.w / 2 + rng() * 0.3;
            cab.position.set(side * (x0 + (rng() - 0.5) * 0.25), y + kind.h / 2, z + (rng() - 0.5) * 0.6 - col * 0.8);
            // 通路の方へ少し向ける
            cab.rotation.y = -side * (0.28 + rng() * 0.12);
            const body = new THREE.Mesh(box, m.cabinet);
            body.scale.set(kind.w, kind.h, CAB_DEPTH);
            body.position.z = -0.35 - CAB_DEPTH / 2;
            cab.add(body);
            // 前の面 (スピーカーの所は穴)。縁は金属
            cab.add(new THREE.Mesh(baffleOf(kind, k), m.cabinet));
            for (const [bx, by, bw, bh] of [
              [0, kind.h / 2 - 0.04, kind.w, 0.08],
              [0, -kind.h / 2 + 0.04, kind.w, 0.08],
              [-kind.w / 2 + 0.04, 0, 0.08, kind.h],
              [kind.w / 2 - 0.04, 0, 0.08, kind.h],
            ] as const) {
              const e = new THREE.Mesh(box, m.darkMetal);
              e.scale.set(bw, bh, 0.05);
              e.position.set(bx, by, 0.02);
              cab.add(e);
            }
            for (const d of kind.drivers) {
              const drv = new Driver(d.r, m, track, false, cache);
              drv.group.position.set(d.x, d.y, 0.01);
              cab.add(drv.group);
              this.rowDrivers[row]!.push(drv);
            }
            if (kind.rack) {
              const leds = new LedBars(8, 3, { w: 0.12, h: 0.06, gapX: 0.05, gapY: 0.03 }, m.glowBasic, track, 0.7);
              leds.mesh.position.set(-0.35, -0.1, 0.03);
              cab.add(leds.mesh);
              this.racks.push(leds);
              for (const kx of [0.55, 0.82]) {
                const knob = makeKnob(0.1, (rng() - 0.5) * 4, m, track);
                knob.position.set(kx, 0, 0.02);
                cab.add(knob);
              }
            }
            this.group.add(cab);
            y += kind.h + 0.02;
          }
        }
      }
    }

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
      this.coneMaterials.push(cm);
      this.group.add(cone);
      const lamp = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: haloTexture, color: new THREE.Color(2.0, 2.2, 2.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
      lamp.position.copy(pos);
      lamp.scale.setScalar(0.9);
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
      this.group.add(l, g);
    }
  }

  applyPalette(p: SpeakerRackPalette): void {
    this.accent.copy(p.accent);
    for (const l of this.accentLights) l.color.copy(p.accent);
    for (const r of this.racks) r.setColors(p.led, p.ledHot);
    for (const h of this.hazeMaterials) (h.uniforms.color!.value as THREE.Color).setRGB(0.35, 0.4, 0.5);
    (this.floorUniforms.floorColor!.value as THREE.Color).copy(p.background).multiplyScalar(1.5);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.floor.getRenderTarget().setSize(Math.max(1, Math.round(width * pixelRatio * 0.5)), Math.max(1, Math.round(height * pixelRatio * 0.5)));
  }

  update(a: AlleyAudioView): void {
    for (let r = 0; r < ALLEY_ROWS; r++) {
      const e = a.rows[r] ?? 0;
      for (const d of this.rowDrivers[r]!) d.setExcursion(e);
    }
    // 機材の LED は、スペクトラムを 8 本にまとめたもの
    for (let i = 0; i < 8; i++) this.spectrumBars[i] = a.spectrum[Math.floor(((i + 0.5) / 8) * a.spectrum.length)] ?? 0;
    for (const r of this.racks) r.write(this.spectrumBars);
    const lvl = 0.8 + 0.2 * (Number.isFinite(a.accent) ? Math.min(1, Math.max(0, a.accent)) : 0);
    for (const l of this.accentLights) l.intensity = 5 * lvl;
    this.glowMaterial.color.copy(this.accent).multiplyScalar(0.45 * lvl);
    for (const h of this.hazeMaterials) h.uniforms.time!.value = a.time;
  }

  /** テスト用: 列ごとのスピーカーの数と、各列の最初のスピーカーの動き */
  inspectRows(): { counts: number[]; excursion: number[] } {
    return { counts: this.rowDrivers.map((r) => r.length), excursion: this.rowDrivers.map((r) => r[0]?.excursion ?? 0) };
  }

  dispose(): void {
    for (const r of this.racks) r.mesh.dispose();
    this.floor.dispose();
    this.group.clear();
  }
}
