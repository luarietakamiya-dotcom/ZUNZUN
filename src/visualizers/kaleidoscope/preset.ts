import * as THREE from 'three';
import { shapeAudio, shapeBands } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { createKaleidoscopeMaterial, KALEIDO_BANDS } from './shaders';

/**
 * Kaleidoscope — 万華鏡。2026-10-04 ユーザー「万華鏡のビジュアライザー追加。背景は考えないでいい」
 * (背景の絵に重ねる前提ではなく、画面いっぱいに描く。黒ではなく暗い色の地に、ガラス片の模様が広がる)。
 *
 * 反応の仕組み (docs/ARCHITECTURE.md「プリセット初期3種の反応設計」にならう):
 * - bands: 中心から外へ、スペクトル (中心 = 低音、外 = 高音) が 16 本の同心の帯になり、強い帯ほど模様が明るくなる。
 * - bass: 中心の宝石がふくらみ、全体がわずかに拡大する (立ち上がりは速く、戻りはゆっくり。光過敏への配慮)。
 * - mid: 模様のゆがみ (warp) が増える。high: ガラス片のにじみが明るくなる。
 * - 曲調 (2026-10-04 ユーザー「色やパターンは曲調に合わせて変換」): 音量・音の動き (flux) を数秒〜10 秒かけてならした mood (0 = 静か、1 = 激しい) で、
 *   色 (おだやかな配色 ↔ にぎやかな配色)・模様 (大きくやわらかい ↔ 細かくくっきり、筋が増える)・ゆがみ・回転の速さがゆっくり移り変わる。
 *   音の明るさ (tone) で 2 色の混ざり方が偏る。ゆっくりなので、色や模様が急に変わって光ることはない。
 * - beat: 回転が一瞬だけ速くなる (明るさは跳ねない)。
 * - Motion: 回転と変化の速さ。intensity: 全体の明るさ。
 * 設定: 鏡の枚数 (3..12)・模様の細かさ・回転の速さ。
 * 乱数は使わない (時刻の積み重ねと、プロジェクトの seed から決めた初期の位相だけ = 同じプロジェクトなら同じ映像)。
 */

interface Palette {
  a: THREE.Color;
  b: THREE.Color;
  c: THREE.Color;
}
const c = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
const pal = (a: [number, number, number], b: [number, number, number], cc: [number, number, number]): Palette => ({ a: c(...a), b: c(...b), c: c(...cc) });
/**
 * 配色 (線形色空間。共通パラメータ Color Theme に対応)。曲調に合わせて、おだやか (calm) とにぎやか (lively) の間を混ぜる。
 * 既定は、静かな曲 = 深い青と青緑、激しい曲 = マゼンタとオレンジ
 */
const PALETTES: Record<string, () => { calm: Palette; lively: Palette }> = {
  default: () => ({ calm: pal([0.1, 0.25, 0.8], [0.1, 0.65, 0.75], [0.7, 0.9, 1.0]), lively: pal([0.9, 0.1, 0.6], [1.0, 0.45, 0.15], [1.0, 0.9, 0.4]) }),
  gold: () => ({ calm: pal([0.6, 0.35, 0.1], [0.8, 0.6, 0.3], [1.0, 0.9, 0.7]), lively: pal([1.0, 0.45, 0.1], [1.0, 0.8, 0.3], [1.0, 0.97, 0.75]) }),
  ice: () => ({ calm: pal([0.15, 0.3, 0.7], [0.3, 0.6, 0.85], [0.8, 0.92, 1.0]), lively: pal([0.4, 0.5, 1.0], [0.5, 1.0, 0.95], [1.0, 1.0, 1.0]) }),
  neon: () => ({ calm: pal([0.5, 0.2, 0.9], [0.2, 0.6, 1.0], [0.8, 0.7, 1.0]), lively: pal([1.0, 0.15, 0.7], [0.15, 1.0, 0.8], [1.0, 0.95, 0.3]) }),
  mono: () => ({ calm: pal([0.4, 0.42, 0.5], [0.6, 0.62, 0.7], [0.9, 0.9, 0.95]), lively: pal([0.7, 0.72, 0.8], [0.9, 0.92, 0.97], [1.0, 1.0, 1.0]) }),
};

export interface KaleidoscopeInspection {
  /** 鏡の枚数 (整数) */
  segments: number;
  /** 回転の角度 (ラジアン。増える一方) */
  rot: number;
  /** 全体の拡大 (1 = 等倍) */
  zoom: number;
  /** 模様のゆがみ */
  warp: number;
  /** 中心の宝石の強さ 0..1 */
  bass: number;
  /** 曲調 0..1 (0 = 静か・おだやか、1 = 激しい・にぎやか。数秒かけてゆっくり変わる) */
  mood: number;
  /** 音の明るさ 0..1 (0 = 低い音が中心、1 = 高い音が中心。ゆっくり変わる) */
  tone: number;
  /** 半径ごとの帯の強さ (中心 = 低音 → 外 = 高音) 0..1 */
  bands: number[];
  aspect: number;
}

const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const unit = (v: unknown, d: number): number => Math.min(1, Math.max(0, fin(v, d)));
/** 立ち上がりは速く、戻りはゆっくり */
function follow(cur: number, target: number, dt: number, up: number, down: number): number {
  return cur + (target - cur) * (1 - Math.exp(-(target > cur ? up : down) * dt));
}

export class KaleidoscopePreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly material = createKaleidoscopeMaterial();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private themeName = '';
  private aspect = 16 / 9;
  private t = 0;
  private rot = 0;
  private bass = 0;
  private high = 0;
  private mid = 0;
  private beatEnv = 0;
  private zoom = 1;
  private mood = 0;
  private tone = 0.5;
  private palette = PALETTES.default!();
  private segments = 6;
  private readonly bandLevel = new Float32Array(KALEIDO_BANDS);
  private readonly shapedBands = new Float32Array(64);

  init(ctx: VisualizerInitContext): void {
    this.scene.background = new THREE.Color(0x000000);
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    // 初期の位相はプロジェクトの seed から (同じプロジェクトなら同じ映像)
    const phase = fin(ctx.rng(), 0.5);
    this.t = phase * 100;
    this.rot = phase * Math.PI * 2;
    this.applyTheme(String(ctx.params.colorTheme ?? 'default'));
    this.resize(ctx.width, ctx.height);
  }

  update(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void {
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(frame.dt) ? frame.dt : 0));
    if (params.colorTheme !== this.themeName) this.applyTheme(params.colorTheme);
    const shaped = shapeAudio(frame, params);
    const a = { bass: fin(shaped.bass, 0), mid: fin(shaped.mid, 0), high: fin(shaped.high, 0), beat: fin(shaped.beat, 0) };
    shapeBands(frame.bands, params, this.shapedBands);
    const motion = unit(params.motion, 0.6);
    const intensity = unit(params.intensity, 0.8);
    const spin = unit(params.spin, 0.5);

    this.bass = follow(this.bass, Math.min(1, a.bass), dt, 16, 4);
    this.mid = follow(this.mid, Math.min(1, a.mid), dt, 10, 3);
    this.high = follow(this.high, Math.min(1, a.high), dt, 14, 5);
    // 拍: 回転が一瞬だけ速くなる (明るさは変えない)
    this.beatEnv = follow(this.beatEnv, Math.min(1, a.beat), dt, 8, 3);
    // 曲調: 音量・音の動き (flux)・音の明るさを、数秒〜10 秒かけてならす (速い変化には反応しない = 色や模様が急に変わらない)
    const loud = Math.min(1, Math.max(fin(frame.rms, 0) * 1.8, fin(frame.spectralEnergy, 0) * 1.4));
    const active = Math.min(1, fin(frame.flux, 0) * 2.5);
    this.mood = follow(this.mood, 0.65 * loud + 0.35 * active, dt, 0.25, 0.12);
    let sum = 0;
    let weighted = 0;
    for (let i = 0; i < 64; i++) {
      const v = Math.max(0, fin(frame.bands[i], 0));
      sum += v;
      weighted += v * i;
    }
    if (sum > 0.01) this.tone = follow(this.tone, Math.min(1, (weighted / sum / 63) * 2), dt, 0.2, 0.2);
    this.zoom = 1 + 0.07 * this.bass;
    this.segments = Math.min(12, Math.max(3, Math.round(fin(params.segments, 6))));
    this.t += dt * (0.4 + 0.8 * motion);
    this.rot += dt * ((0.03 + 0.22 * spin) * (0.5 + motion) * (0.6 + 0.8 * this.mood) + 0.12 * this.beatEnv * (0.3 + spin));

    // 帯: 64 本を 16 本にまとめる (4 本ずつの平均)。立ち上がりは速く、戻りはゆっくり
    const per = Math.floor(64 / KALEIDO_BANDS);
    for (let i = 0; i < KALEIDO_BANDS; i++) {
      let s = 0;
      for (let j = 0; j < per; j++) s += fin(this.shapedBands[i * per + j], 0);
      this.bandLevel[i] = follow(this.bandLevel[i]!, Math.min(1, s / per), dt, 22, 6);
    }

    this.writeUniforms(params, intensity);
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
  inspect(): KaleidoscopeInspection {
    return {
      segments: this.segments,
      rot: this.rot,
      zoom: this.zoom,
      warp: this.material.uniforms.warp!.value as number,
      bass: this.bass,
      mood: this.mood,
      tone: this.tone,
      bands: Array.from(this.bandLevel),
      aspect: this.aspect,
    };
  }

  private applyTheme(name: string): void {
    this.themeName = name;
    this.palette = (PALETTES[name] ?? PALETTES.default!)();
    this.mixColors();
  }

  /** 曲調に合わせて、おだやかな配色とにぎやかな配色の間を混ぜる */
  private mixColors(): void {
    const u = this.material.uniforms;
    u.colA!.value.copy(this.palette.calm.a).lerp(this.palette.lively.a, this.mood);
    u.colB!.value.copy(this.palette.calm.b).lerp(this.palette.lively.b, this.mood);
    u.colC!.value.copy(this.palette.calm.c).lerp(this.palette.lively.c, this.mood);
  }

  private writeUniforms(params: CommonParams & Record<string, unknown>, intensity: number): void {
    const u = this.material.uniforms;
    this.mixColors();
    u.mood!.value = this.mood;
    u.tone!.value = this.tone;
    u.t!.value = this.t;
    u.rot!.value = this.rot;
    u.zoom!.value = this.zoom;
    u.warp!.value = 0.2 + 0.4 * this.mood + 0.4 * this.mid;
    u.seg!.value = this.segments;
    u.detail!.value = 0.6 + 1.2 * unit(params.detail, 0.5);
    u.bass!.value = this.bass;
    u.high!.value = this.high;
    (u.bandLevel!.value as Float32Array).set(this.bandLevel);
    // 全体の明るさ (広い面積なので、やや控えめ。静かなときも形が見える程度に残す)
    u.intensity!.value = 0.5 + 0.6 * intensity;
  }
}
