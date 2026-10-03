import * as THREE from 'three';
import { shapeAudio } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { createRippleMaterial, MAX_RIPPLES } from './shaders';

/**
 * Ripples — 背景の絵に重ねて使う、水面の波紋のエフェクト。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる。Visualizer タブの既定の重ね方): 黒は透けて、光だけが絵に乗る。
 *
 * 反応の仕組み (docs/ARCHITECTURE.md「プリセット初期3種の反応設計」にならう):
 * - bass の立ち上がり: 画面の真ん中あたりに大きな波紋 (遠くまで広がる、ゆっくり薄れる)。
 * - beat (拍が変わったとき): 画面のあちこちに中くらいの波紋。
 * - high: 小さくて速く薄れる波紋 (間隔をあけて)。
 * - mid: 波の輪の細かさ (高いほど細かい輪が増える)。
 * - intensity: 全体の明るさ。
 * 波紋が出る位置は init() の ctx.rng (project.seed 由来) だけで決める。Math.random は使わない
 * (同じプロジェクトなら同じ映像)。同時に 14 個まで (古いものから置き換える)。
 * 設定: 広がる速さ・波紋の量・大きさ。
 */

/** 波紋の種類: [出たときの明るさの上限, 大きさ, 寿命 (秒)] */
const KIND = {
  big: { scale: 1.4, life: 3.6 },
  medium: { scale: 1.0, life: 2.8 },
  small: { scale: 0.55, life: 1.6 },
} as const;
type Kind = keyof typeof KIND;

/** 波の広がる速さ (画面の高さの半分 / 秒)。設定の速さ 0..1 で 0.35 .. 1.25 */
const speedOf = (setting: number): number => 0.35 + 0.9 * setting;

interface Palette {
  a: THREE.Color;
  b: THREE.Color;
}
const c = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
/** 配色 (線形色空間。共通パラメータ Color Theme に対応)。既定は水色がかった白 */
const PALETTES: Record<string, () => Palette> = {
  default: () => ({ a: c(0.55, 0.95, 1.0), b: c(0.25, 0.55, 1.0) }),
  gold: () => ({ a: c(1.0, 0.9, 0.55), b: c(1.0, 0.55, 0.2) }),
  ice: () => ({ a: c(0.75, 0.92, 1.0), b: c(0.35, 0.55, 1.0) }),
  neon: () => ({ a: c(1.0, 0.45, 0.9), b: c(0.3, 0.8, 1.0) }),
  mono: () => ({ a: c(1.0, 1.0, 1.0), b: c(0.7, 0.72, 0.8) }),
};

export interface RipplesInspection {
  /** いま広がっている波紋の数 */
  active: number;
  /** これまでに出した波紋の数 (種類ごと) */
  spawned: { big: number; medium: number; small: number };
  /** いちばん外の波紋の半径 (画面の高さの半分 = 1) */
  maxRadius: number;
  /** いま出ている波紋の明るさの最大 */
  maxAmp: number;
  /** 波の輪の細かさ */
  freq: number;
  /** 波紋の中心 (正規化: -1..1。いま出ているもの) */
  centers: { x: number; y: number }[];
}

const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const unit = (v: unknown, d: number): number => Math.min(1, Math.max(0, fin(v, d)));

export class RipplesPreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private rng: () => number = () => 0.5;
  private readonly material = createRippleMaterial();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private themeName = '';
  private aspect = 16 / 9;

  // 波紋のプール (中心は正規化 -1..1。描くときに画面の縦横比を掛ける)
  private readonly nx = new Float32Array(MAX_RIPPLES);
  private readonly ny = new Float32Array(MAX_RIPPLES);
  private readonly age = new Float32Array(MAX_RIPPLES);
  private readonly life = new Float32Array(MAX_RIPPLES);
  private readonly peak = new Float32Array(MAX_RIPPLES);
  private readonly scale = new Float32Array(MAX_RIPPLES);
  private readonly alive = new Uint8Array(MAX_RIPPLES);
  private nextSlot = 0;
  private readonly spawned = { big: 0, medium: 0, small: 0 };

  private lastBeatIndex = -1;
  private prevBass = 0;
  private bassCooldown = 0;
  private highCooldown = 0;
  private midEnv = 0;

  init(ctx: VisualizerInitContext): void {
    this.rng = ctx.rng;
    this.scene.background = new THREE.Color(0x000000);
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.applyTheme(String(ctx.params.colorTheme ?? 'default'));
    this.resize(ctx.width, ctx.height);
  }

  update(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void {
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(frame.dt) ? frame.dt : 0));
    if (params.colorTheme !== this.themeName) this.applyTheme(params.colorTheme);
    const shaped = shapeAudio(frame, params);
    // 壊れた値 (NaN など) が来ても、状態に残らないようにする
    const bass = fin(shaped.bass, 0);
    const mid = fin(shaped.mid, 0);
    const high = fin(shaped.high, 0);
    const beat = fin(shaped.beat, 0);
    const intensity = unit(params.intensity, 0.8);
    const amount = unit(params.amount, 0.6);
    // 量の設定: 反応のしきい値と明るさにかける (0 でもたまには出る / 1 でよく出る)
    const gain = 0.6 + 0.9 * amount;
    const speed = speedOf(unit(params.speed, 0.5));
    const size = Math.min(1.5, Math.max(0.5, fin(params.size, 1)));

    this.bassCooldown = Math.max(0, this.bassCooldown - dt);
    this.highCooldown = Math.max(0, this.highCooldown - dt);

    // 低音の立ち上がり: 真ん中あたりに大きな波紋
    if (this.bassCooldown <= 0 && bass * gain > 0.5 && bass - this.prevBass > 0.1) {
      this.spawn('big', (this.rng() - 0.5) * 0.7, (this.rng() - 0.5) * 0.7, Math.min(0.8, 0.3 + 0.5 * bass * gain), size);
      this.bassCooldown = 0.2;
    }
    this.prevBass = bass;

    // 拍が変わった: あちこちに中くらいの波紋
    const beatIndex = Number.isFinite(frame.beatIndex) ? frame.beatIndex : -1;
    if (beatIndex !== this.lastBeatIndex) {
      this.lastBeatIndex = beatIndex;
      if (beatIndex >= 0 && beat > 0.25) this.spawn('medium', (this.rng() - 0.5) * 1.7, (this.rng() - 0.5) * 1.5, Math.min(0.75, (0.25 + 0.4 * beat) * gain), size);
    }

    // 高音: 小さな波紋 (間隔をあけて)
    if (this.highCooldown <= 0 && high * gain > 0.55) {
      this.spawn('small', (this.rng() - 0.5) * 1.8, (this.rng() - 0.5) * 1.6, Math.min(0.55, (0.15 + 0.35 * high) * gain), size);
      this.highCooldown = 0.12;
    }

    // 中域: 輪の細かさ (なめらかに)
    this.midEnv += (mid - this.midEnv) * (1 - Math.exp(-dt * 5));

    // 広がる・薄れる
    for (let i = 0; i < MAX_RIPPLES; i++) {
      if (!this.alive[i]) continue;
      this.age[i] = this.age[i]! + dt;
      if (this.age[i]! >= this.life[i]!) this.alive[i] = 0;
    }
    this.writeUniforms(speed, intensity);
  }

  resize(width: number, height: number): void {
    this.aspect = Math.max(1, width) / Math.max(1, height);
    this.material.uniforms.aspect!.value = this.aspect;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.scene.clear();
  }

  /** テスト用: 反応の結果を数値で覗く (描画には使わない)。 */
  inspect(): RipplesInspection {
    const u = this.material.uniforms;
    const rad = u.rad!.value as Float32Array;
    const amp = u.amp!.value as Float32Array;
    let active = 0;
    let maxRadius = 0;
    let maxAmp = 0;
    const centers: { x: number; y: number }[] = [];
    for (let i = 0; i < MAX_RIPPLES; i++) {
      if (!this.alive[i]) continue;
      active++;
      maxRadius = Math.max(maxRadius, rad[i]!);
      maxAmp = Math.max(maxAmp, amp[i]!);
      centers.push({ x: this.nx[i]!, y: this.ny[i]! });
    }
    return { active, spawned: { ...this.spawned }, maxRadius, maxAmp, freq: u.freq!.value as number, centers };
  }

  private spawn(kind: Kind, x: number, y: number, peak: number, size: number): void {
    const i = this.nextSlot;
    this.nextSlot = (this.nextSlot + 1) % MAX_RIPPLES;
    this.nx[i] = Math.max(-1, Math.min(1, x));
    this.ny[i] = Math.max(-1, Math.min(1, y));
    this.age[i] = 0;
    this.life[i] = KIND[kind].life;
    this.peak[i] = peak;
    this.scale[i] = KIND[kind].scale * size;
    this.alive[i] = 1;
    this.spawned[kind]++;
  }

  private applyTheme(name: string): void {
    this.themeName = name;
    const p = (PALETTES[name] ?? PALETTES.default!)();
    this.material.uniforms.colA!.value.copy(p.a);
    this.material.uniforms.colB!.value.copy(p.b);
  }

  private writeUniforms(speed: number, intensity: number): void {
    const u = this.material.uniforms;
    const pos = u.pos!.value as THREE.Vector2[];
    const rad = u.rad!.value as Float32Array;
    const amp = u.amp!.value as Float32Array;
    const scl = u.scl!.value as Float32Array;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      if (!this.alive[i]) {
        amp[i] = 0;
        continue;
      }
      const t = this.age[i]! / this.life[i]!;
      pos[i]!.set(this.nx[i]! * this.aspect, this.ny[i]!);
      rad[i] = this.age[i]! * speed * (0.6 + 0.4 * this.scale[i]!);
      // 出た瞬間から薄れる (急に光らないよう、出始めの 0.15 秒は立ち上げる。光過敏への配慮)
      amp[i] = this.peak[i]! * Math.pow(1 - t, 1.6) * Math.min(1, this.age[i]! / 0.15);
      scl[i] = this.scale[i]!;
    }
    // 輪の細かさ: 中域が強いほど細かい (30 .. 52)
    u.freq!.value = 30 + 22 * this.midEnv;
    u.intensity!.value = 0.5 + 0.6 * intensity;
  }
}
