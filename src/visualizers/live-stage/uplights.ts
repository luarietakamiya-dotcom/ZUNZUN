import * as THREE from 'three';
import type { LiveStagePalette } from './palette';
import { createBeamMaterial } from './shaders';

/**
 * Live Stage の「バンド」のアップライト (stage-set.ts の StageSet が持つ)。
 * 奥の壁ぎわの床に灯体を並べ、上へ光の筋を伸ばし、当たる所の壁を縦長にほんのり照らす。
 * ドラム・アンプの後ろにも来るので、機材の影絵がはっきりする。色はムービングライトと同じ 2 色を交互に。
 * beat で 0.75〜1.0 倍だけ強まる (壁は広いので、光過敏への配慮で明滅の幅は小さくする)。
 * ctx.rng は使わない (stage-set.ts の説明)。
 */

/** 灯体の x (layoutScale を掛ける)。ドラムの左右 (±1.5) とアンプのあたり (±4.5) を通る */
export const UPLIGHT_X = [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5];
/** 光の筋の長さ・根元と先の太さ・壁の方への傾き */
const LENGTH = 9;
const APEX_R = 0.08;
const END_R = 1.0;
const LEAN_BACK = 0.12;
/** 灯体は壁からこれだけ手前 */
const FROM_WALL = 0.7;
/** 壁の照らされる所 (幅・高さ) と濃さ */
const WASH_W = 2.6;
const WASH_H = 10;
const WASH_STRENGTH = 0.35;
/** 光の筋の強さ (ムービングライトより弱く) */
const BEAM_STRENGTH = 0.35;

const WASH_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** 下ほど明るく、上と左右へなめらかに消える縦長の光 (スキャロップ) */
const WASH_FRAG = /* glsl */ `
uniform vec3 color;
uniform float strength;
varying vec2 vUv;
void main() {
  float x = (vUv.x - 0.5) * 2.0;
  float across = exp(-x * x * 3.5) * (1.0 - smoothstep(0.75, 1.0, abs(x)));
  float up = smoothstep(0.0, 0.06, vUv.y) * exp(-vUv.y * 2.4);
  gl_FragColor = vec4(color * across * up * strength, 1.0);
}
`;

export class Uplights {
  readonly group = new THREE.Group();
  private readonly beams: THREE.Mesh[] = [];
  private readonly beamMaterials: THREE.ShaderMaterial[] = [];
  private readonly washes: THREE.Mesh[] = [];
  private readonly washMaterials: THREE.ShaderMaterial[] = [];
  private readonly lamps: THREE.Sprite[] = [];
  private readonly lampMaterials: THREE.SpriteMaterial[] = [];
  private pulse = 0;
  private level = 0;
  private time = 0;

  constructor(
    private readonly wallZ: number,
    track: <T extends { dispose(): void }>(obj: T) => T,
    lampTexture: THREE.Texture,
  ) {
    const beamGeo = track(new THREE.CylinderGeometry(APEX_R, END_R, LENGTH, 32, 8, true));
    beamGeo.translate(0, -LENGTH / 2, 0); // 根元を原点に -Y へ (ムービングライトと同じ形)。上へ向けて置く
    const washGeo = track(new THREE.PlaneGeometry(WASH_W, WASH_H));
    washGeo.translate(0, WASH_H / 2, 0);
    for (let i = 0; i < UPLIGHT_X.length; i++) {
      const bm = track(createBeamMaterial(LENGTH));
      bm.name = 'LiveStageUplight';
      const beam = new THREE.Mesh(beamGeo, bm);
      beam.rotation.x = Math.PI - LEAN_BACK; // 上へ、少し壁の方へ
      beam.frustumCulled = false;
      beam.renderOrder = 2;
      this.beams.push(beam);
      this.beamMaterials.push(bm);

      const wm = track(
        new THREE.ShaderMaterial({
          name: 'LiveStageWallWash',
          vertexShader: WASH_VERT,
          fragmentShader: WASH_FRAG,
          uniforms: { color: { value: new THREE.Color() }, strength: { value: 0 } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const wash = new THREE.Mesh(washGeo, wm);
      wash.renderOrder = 1;
      this.washes.push(wash);
      this.washMaterials.push(wm);

      const lm = track(new THREE.SpriteMaterial({ map: lampTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      const lamp = new THREE.Sprite(lm);
      lamp.scale.setScalar(0.5);
      lamp.renderOrder = 3;
      this.lamps.push(lamp);
      this.lampMaterials.push(lm);
      this.group.add(wash, beam, lamp);
    }
    this.layout(1);
  }

  layout(scale: number): void {
    const z = this.wallZ + FROM_WALL;
    for (let i = 0; i < UPLIGHT_X.length; i++) {
      const x = UPLIGHT_X[i]! * scale;
      this.beams[i]!.position.set(x, 0.15, z);
      this.lamps[i]!.position.set(x, 0.18, z + 0.05);
      this.washes[i]!.position.set(x, 0, this.wallZ + 0.02);
    }
  }

  applyPalette(p: LiveStagePalette): void {
    for (let i = 0; i < UPLIGHT_X.length; i++) {
      const c = i % 2 === 0 ? p.beamB : p.beamA;
      (this.beamMaterials[i]!.uniforms.color!.value as THREE.Color).copy(c);
      (this.washMaterials[i]!.uniforms.color!.value as THREE.Color).copy(c);
      this.lampMaterials[i]!.color.copy(c).multiplyScalar(2.2);
    }
  }

  /** beat = 0..1、intensity = 0..1、density = スモークの濃さ (光の筋の濃さ) */
  update(dt: number, beat: number, intensity: number, density: number): void {
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    const b = Number.isFinite(beat) ? Math.min(1, Math.max(0, beat)) : 0;
    const k = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
    const d = Number.isFinite(density) ? Math.min(2, Math.max(0, density)) : 0.4;
    this.time += step;
    this.pulse += (b - this.pulse) * (1 - Math.exp(-(b > this.pulse ? 25 : 6) * step));
    this.level = (0.3 + 0.7 * k) * (0.75 + 0.25 * this.pulse);
    for (let i = 0; i < UPLIGHT_X.length; i++) {
      const u = this.beamMaterials[i]!.uniforms;
      u.strength!.value = BEAM_STRENGTH * this.level;
      u.density!.value = d;
      u.time!.value = this.time;
      this.washMaterials[i]!.uniforms.strength!.value = WASH_STRENGTH * this.level;
      this.lampMaterials[i]!.opacity = Math.min(1, 0.5 + 0.5 * this.level);
    }
  }

  /** テスト用 */
  inspect(): { count: number; level: number } {
    return { count: this.beams.length, level: this.level };
  }
}
