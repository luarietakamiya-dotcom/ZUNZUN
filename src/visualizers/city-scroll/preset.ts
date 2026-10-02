import * as THREE from 'three';
import { shapeAudio } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { sceneSequence, SCENES, type CityScene, type ParticleKind } from './scenes';
import { createCityMaterial, createParticleMaterial, MAX_SCENES, PARTICLE_CODE, SEAM } from './shaders';

/**
 * 流れる街並み — 横長の街の絵を、左か右へゆっくり流してループさせる。きらめきと、舞い落ちるもの (花びら・雪・木の葉・
 * 光の粒・紙ふぶき) を重ねる。ユーザー要望 (2026-10-02)「左か右に動いてループ。動く方向と速度は変更可能。ぼかし度調整。
 * きらきら光ったり、何かが舞い落ちたり動くものも追加して」。
 *
 * 反応の仕組み (音で暴れない、ゆったりした背景向け):
 * - 流れる速さ: 設定の速さに、低音のゆっくりした強さ (bassSlow) × Motion で少しだけ足す (最大 4 割)。
 * - きらめき: 高音 (オートレベル) と拍で強くなる。
 * - 舞うもの: 音量が大きいほど、ひらひらが少し速くなり、光の粒は明るくなる。
 * - 絵の明るさ: 音量で少しだけ (±5%。光過敏への配慮で、なめらかに)。
 *
 * 乱数は init() の ctx.rng だけ (舞うものの位置・大きさ・回り方)。きらめきの位置はシェーダーの hash (決まった値)。
 * 位置は時刻の積み重ね (dt) だけで決まるので、同じプロジェクトなら同じ映像になる。
 */

/** 舞うものの最大の数 */
export const MAX_PARTICLES = 240;

export type TextureLoaderFn = (url: string) => Promise<THREE.Texture>;
const defaultLoader: TextureLoaderFn = async (url) => {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
};

export interface CityScrollInspection {
  scene: string;
  loaded: boolean;
  /** つないでいる絵の数 */
  count: number;
  /** 流れた位置 (絵の横幅 = 1。0 .. 枚数 × (1 - SEAM)) */
  scroll: number;
  blur: number;
  sparkle: number;
  sparkleBoost: number;
  brightness: number;
  particleKind: ParticleKind | 'none';
  particleCount: number;
  particlesAdditive: boolean;
  /** 舞うものが景色といっしょに流れた量 (画面の幅 = 1) */
  drift: number;
}

const fin = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? fin(v) : d);
const safeDt = (dt: number): number => (Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0);
function follow(cur: number, target: number, dt: number, up: number, down: number): number {
  const v = fin(target);
  return cur + (v - cur) * (1 - Math.exp(-(v > cur ? up : down) * dt));
}

/** 曲の音の大きさに合わせる (オートレベル。プリセット同士は部品を共有しない約束なので、ここにも持つ) */
class AutoLevel {
  private ref: number;
  constructor(
    private readonly floor: number,
    private readonly release = 4,
  ) {
    this.ref = floor;
  }
  update(value: number, dt: number): number {
    const v = Number.isFinite(value) ? Math.max(0, value) : 0;
    if (v > this.ref) this.ref = v;
    else this.ref += (v - this.ref) * (1 - Math.exp(-dt / this.release));
    this.ref = Math.max(this.floor, this.ref);
    return Math.min(1, v / this.ref);
  }
}

const PARTICLE_KINDS: readonly ParticleKind[] = ['petals', 'snow', 'leaves', 'lights', 'confetti'];

/** 設定の「舞うもの」→ 実際に舞わせるもの (auto は場面に合わせる。全部つなげるときは 1 枚目に合わせる) */
export function particleKindFor(setting: unknown, scenes: readonly CityScene[]): ParticleKind | 'none' {
  if (setting === 'none') return 'none';
  if (PARTICLE_KINDS.includes(setting as ParticleKind)) return setting as ParticleKind;
  return scenes[0]?.particles ?? 'petals';
}

/** 流れる速さ (絵の高さ = 1 として、1 秒に進む長さ)。設定の 0..1 を、ゆっくりから速くまで */
export const scrollSpeed = (speed: number): number => 0.01 + 0.45 * speed * speed;

export class CityScrollPreset implements VisualizerPreset {
  /** 絵の読み方 (テストで差し替える) */
  static loadTexture: TextureLoaderFn = defaultLoader;

  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly bgGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly bgMaterial = createCityMaterial();
  private readonly bg: THREE.Mesh;
  private readonly pGeometry = new THREE.InstancedBufferGeometry();
  private readonly pMaterial = createParticleMaterial();
  private readonly particles: THREE.Mesh;

  /** 読んだ絵 (url ごと) */
  private readonly textures = new Map<string, THREE.Texture>();
  private sequence: CityScene[] = [SCENES[0]!];
  private loaded = false;
  private wanted = '';
  private generation = 0;
  private aspect = 16 / 9;

  private scroll = 0;
  private drift = 0;
  private time = 0;
  private particleTime = 0;
  private highEnv = 0;
  private rmsEnv = 0;
  private beatEnv = 0;
  private bassSlow = 0;
  private readonly autoHigh = new AutoLevel(0.006);
  private readonly autoRms = new AutoLevel(0.03);
  private readonly autoBass = new AutoLevel(0.25);
  private kind: ParticleKind | 'none' = 'none';

  constructor() {
    this.bg = new THREE.Mesh(this.bgGeometry, this.bgMaterial);
    this.bg.frustumCulled = false;
    this.bg.renderOrder = 0;
    this.scene.add(this.bg);

    const quad = new THREE.PlaneGeometry(1, 1);
    this.pGeometry.index = quad.index;
    this.pGeometry.setAttribute('position', quad.getAttribute('position'));
    this.pGeometry.setAttribute('seedA', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 4), 4));
    this.pGeometry.setAttribute('seedB', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 4), 4));
    this.pGeometry.instanceCount = 0;
    quad.dispose();
    this.particles = new THREE.Mesh(this.pGeometry, this.pMaterial);
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 1;
    this.scene.add(this.particles);
    this.scene.background = new THREE.Color(0x000000);
  }

  async init(ctx: VisualizerInitContext): Promise<void> {
    this.resize(ctx.width, ctx.height);
    // 舞うものの位置・大きさ・回り方 (seed で決まる)
    const a = this.pGeometry.getAttribute('seedA') as THREE.InstancedBufferAttribute;
    const b = this.pGeometry.getAttribute('seedB') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      // 手前 (depth が大きい) ほど少なく
      a.setXYZW(i, ctx.rng(), ctx.rng(), ctx.rng(), Math.pow(ctx.rng(), 1.6));
      b.setXYZW(i, ctx.rng(), ctx.rng(), ctx.rng(), ctx.rng());
    }
    a.needsUpdate = true;
    b.needsUpdate = true;
    // 最初の場面は、絵を読み終わってから描き始める (書き出しの最初のフレームから絵が出るように)
    await this.selectScene(ctx.params.scene);
    this.writeUniforms(ctx.params);
  }

  update(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void {
    const dt = safeDt(frame.dt);
    if ((typeof params.scene === 'string' ? params.scene : '') !== this.wanted) void this.selectScene(params.scene);

    const a = shapeAudio(frame, params);
    const k = fin(params.intensity);
    const motion = fin(params.motion);
    this.highEnv = follow(this.highEnv, this.autoHigh.update(fin(a.high), dt), dt, 20, 4);
    this.rmsEnv = follow(this.rmsEnv, this.autoRms.update(fin(a.rms), dt), dt, 6, 2);
    this.beatEnv = follow(this.beatEnv, fin(a.beat), dt, 20, 5);
    this.bassSlow = follow(this.bassSlow, this.autoBass.update(fin(a.bass), dt), dt, 2, 0.7);

    // 流れる: 速さの設定 + 低音で少しだけ速く。向きは「左へ」(景色が左へ流れる) か「右へ」
    const imgAspect = this.sequence[0]?.aspect ?? 5;
    const dir = params.direction === 'right' ? -1 : 1;
    const v = (scrollSpeed(num(params.speed, 0.35)) / imgAspect) * (1 + 0.4 * motion * k * this.bassSlow);
    const total = this.sequence.length * (1 - SEAM);
    this.scroll = (((this.scroll + dir * v * dt) % total) + total) % total;
    // 舞うものも景色といっしょに流れる (画面の幅 = 1)
    const z = Math.max(1, this.aspect / imgAspect);
    this.drift -= (dir * v * dt * imgAspect * z) / this.aspect;
    this.time += dt;
    this.particleTime += dt * (1 + 0.5 * motion * this.rmsEnv);
    this.writeUniforms(params);
  }

  resize(width: number, height: number): void {
    this.aspect = Math.max(1, width) / Math.max(1, height);
  }

  dispose(): void {
    this.generation++;
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.bgMaterial.dispose();
    this.bgGeometry.dispose();
    this.pMaterial.dispose();
    this.pGeometry.dispose();
    this.scene.clear();
  }

  /** テスト用 */
  inspect(): CityScrollInspection {
    const u = this.bgMaterial.uniforms;
    return {
      scene: this.wanted === 'all' ? 'all' : this.sequence[0]!.id,
      loaded: this.loaded,
      count: u.count!.value as number,
      scroll: this.scroll,
      blur: u.blur!.value as number,
      sparkle: u.sparkle!.value as number,
      sparkleBoost: u.sparkleBoost!.value as number,
      brightness: u.brightness!.value as number,
      particleKind: this.kind,
      particleCount: this.particles.visible ? this.pGeometry.instanceCount : 0,
      particlesAdditive: this.pMaterial.blending === THREE.AdditiveBlending,
      drift: this.drift,
    };
  }

  // ----------------------------------------------------------------

  /** 場面を選ぶ。絵を読み終わるまでは前の場面のまま。途中で別の場面を選んだら、古い方は捨てる。使わなくなった絵は片づける */
  private async selectScene(id: unknown): Promise<void> {
    this.wanted = typeof id === 'string' ? id : '';
    const seq = sceneSequence(id);
    const my = ++this.generation;
    const missing = seq.filter((s) => !this.textures.has(s.url));
    const got = await Promise.all(missing.map((s) => CityScrollPreset.loadTexture(s.url).catch(() => null)));
    if (my !== this.generation) {
      for (const t of got) t?.dispose();
      return;
    }
    missing.forEach((s, i) => {
      const t = got[i];
      if (t) this.textures.set(s.url, t);
    });
    const usable = seq.filter((s) => this.textures.has(s.url)).slice(0, MAX_SCENES);
    if (usable.length === 0) return;
    // 使わない絵を片づける
    for (const [url, t] of [...this.textures]) {
      if (!usable.some((s) => s.url === url)) {
        t.dispose();
        this.textures.delete(url);
      }
    }
    const changed = usable.length !== this.sequence.length || usable.some((s, i) => s.id !== this.sequence[i]?.id);
    this.sequence = usable;
    this.loaded = true;
    if (changed) this.scroll = 0;
    const u = this.bgMaterial.uniforms;
    for (let i = 0; i < MAX_SCENES; i++) u[`map${i}`]!.value = this.textures.get((usable[i] ?? usable[0]!).url) ?? null;
    u.count!.value = usable.length;
    u.imgAspect!.value = usable[0]!.aspect;
    const img = this.textures.get(usable[0]!.url)?.image as { height?: number } | undefined;
    u.texelV!.value = 1 / Math.max(1, img?.height ?? 400);
  }

  private writeUniforms(params: CommonParams & Record<string, unknown>): void {
    const k = fin(params.intensity);
    const u = this.bgMaterial.uniforms;
    u.aspect!.value = this.aspect;
    u.scroll!.value = this.scroll;
    u.time!.value = this.time;
    // ぼかし: 円の半径 (絵の高さ = 1)。いちばん強いとき、1080px の画面で約 20px
    u.blur!.value = num(params.blur, 0) * 0.018;
    u.sparkle!.value = num(params.sparkle, 0.6);
    u.sparkleBoost!.value = Math.min(1.5, (0.8 * this.highEnv + 0.5 * this.beatEnv) * (0.3 + 0.7 * k));
    u.brightness!.value = 0.95 + 0.1 * this.rmsEnv * k;

    // 舞うもの
    const kind = particleKindFor(params.particles, this.sequence);
    if (kind !== this.kind) {
      this.kind = kind;
      this.pMaterial.blending = kind === 'lights' ? THREE.AdditiveBlending : THREE.NormalBlending;
      this.pMaterial.needsUpdate = true;
    }
    const amount = num(params.particleAmount, 0.5);
    const n = kind === 'none' ? 0 : Math.round(MAX_PARTICLES * amount);
    this.particles.visible = n > 0;
    this.pGeometry.instanceCount = n;
    const p = this.pMaterial.uniforms;
    p.kind!.value = kind === 'none' ? 0 : PARTICLE_CODE[kind];
    p.time!.value = this.particleTime;
    p.drift!.value = this.drift;
    p.aspect!.value = this.aspect;
    p.opacity!.value = kind === 'lights' ? 0.55 + 0.35 * this.rmsEnv : 0.9;
    p.glow!.value = this.rmsEnv * k;
  }
}
