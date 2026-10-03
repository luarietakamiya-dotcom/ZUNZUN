import * as THREE from 'three';
import { shapeAudio, shapeBands } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { createLedMaterial, LED_BANDS } from './shaders';

/**
 * LED Matrix — 背景の絵に重ねて使う、ドット格子の LED メーター (ユーザー要望 2026-10-03「イコライザー系いろいろ」)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる)。丸い LED が格子に並び、列ごとにスペクトルの強さまで点灯する。
 *
 * 反応の仕組み (docs/ARCHITECTURE.md「プリセット初期3種の反応設計」にならう):
 * - 帯域 (bands): 列ごとの高さ (左が低音、右が高音)。立ち上がりは速く、戻りはゆっくり。
 * - ピーク: 点灯の上に、LED 1 つぶんのピークが残る (しばらく止まってから、ゆっくり落ちる。点灯より下には落ちない)。
 * - bass: 点灯していない LED がうっすら光る (格子が見える。低音で少し強くなる)。
 * - beat: 点灯している LED の明るさが少し上がる (なめらかに。最大 +25%)。
 * - intensity: 全体の明るさ。
 * 設定: 列の数 (24 / 32 / 48)・並べ方 (下から / 中央から上下)・色 (クラシックの緑黄赤 / テーマの色)・高さ・LED の大きさ・うすい格子の量。
 * 乱数は使わない (同じプロジェクトなら同じ映像)。
 */

/** ピークが止まっている時間 (秒) と、そのあと落ちる速さ (高さ全体 / 秒) */
const PEAK_HOLD = 0.35;
const PEAK_FALL = 0.5;

interface Palette {
  a: THREE.Color;
  b: THREE.Color;
  peak: THREE.Color;
}
const c = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
/** 配色 (線形色空間。共通パラメータ Color Theme に対応)。「テーマの色」を選んだときの、下 (a) から上 (b) のグラデーション */
const PALETTES: Record<string, () => Palette> = {
  default: () => ({ a: c(0.16, 0.95, 0.62), b: c(0.3, 0.5, 1.0), peak: c(0.9, 1.0, 0.95) }),
  gold: () => ({ a: c(1.0, 0.55, 0.2), b: c(1.0, 0.9, 0.5), peak: c(1.0, 0.95, 0.8) }),
  ice: () => ({ a: c(0.4, 0.8, 1.0), b: c(0.7, 0.6, 1.0), peak: c(0.9, 0.97, 1.0) }),
  neon: () => ({ a: c(1.0, 0.3, 0.85), b: c(0.3, 0.85, 1.0), peak: c(1.0, 0.85, 1.0) }),
  mono: () => ({ a: c(1.0, 1.0, 1.0), b: c(0.72, 0.75, 0.85), peak: c(1.0, 1.0, 1.0) }),
};

/** 列の数の選択肢 */
const COLUMNS: Record<string, number> = { '24': 24, '32': 32, '48': 48 };

export interface LedMatrixInspection {
  /** 帯域ごとの強さ (0..1。左 = 低音) */
  levels: number[];
  /** ピークの位置 (0..1) */
  peaks: number[];
  /** 列の数・中央から上下か・クラシックの色か */
  cols: number;
  centered: boolean;
  classic: boolean;
  /** 高さ (画面の高さの割合)・LED の大きさ・点灯していない LED の明るさ・点灯の明るさの倍率 */
  heightFrac: number;
  dotSize: number;
  dim: number;
  boost: number;
}

const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const unit = (v: unknown, d: number): number => Math.min(1, Math.max(0, fin(v, d)));
/** 立ち上がりは速く、戻りはゆっくり */
function follow(cur: number, target: number, dt: number, up: number, down: number): number {
  return cur + (target - cur) * (1 - Math.exp(-(target > cur ? up : down) * dt));
}

export class LedMatrixPreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly material = createLedMaterial();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private themeName = '';

  private readonly levels = new Float32Array(LED_BANDS);
  private readonly peaks = new Float32Array(LED_BANDS);
  private readonly peakHold = new Float32Array(LED_BANDS);
  private bassGlow = 0;
  private beatGlow = 0;
  private readonly shapedBands = new Float32Array(64);

  init(ctx: VisualizerInitContext): void {
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
    const beat = fin(shaped.beat, 0);
    shapeBands(frame.bands, params, this.shapedBands);
    const intensity = unit(params.intensity, 0.8);

    for (let j = 0; j < LED_BANDS; j++) {
      const band = Math.round((j / (LED_BANDS - 1)) * 46);
      const target = Math.min(1, fin(this.shapedBands[band], 0));
      this.levels[j] = follow(this.levels[j]!, target, dt, 32, 7);
      // ピーク: 点灯より上なら追いつく。そのあと PEAK_HOLD 秒止まって、一定の速さで落ちる (点灯より下には落ちない)
      if (this.levels[j]! >= this.peaks[j]!) {
        this.peaks[j] = this.levels[j]!;
        this.peakHold[j] = PEAK_HOLD;
      } else if (this.peakHold[j]! > 0) {
        this.peakHold[j] = Math.max(0, this.peakHold[j]! - dt);
      } else {
        this.peaks[j] = Math.max(this.levels[j]!, this.peaks[j]! - PEAK_FALL * dt);
      }
    }
    this.bassGlow = follow(this.bassGlow, bass, dt, 14, 3);
    this.beatGlow = follow(this.beatGlow, beat, dt, 18, 4);

    this.writeUniforms(params, intensity);
  }

  resize(width: number, height: number): void {
    this.material.uniforms.aspect!.value = Math.max(1, width) / Math.max(1, height);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.scene.clear();
  }

  /** テスト用: 反応の結果を数値で覗く (描画には使わない)。 */
  inspect(): LedMatrixInspection {
    const u = this.material.uniforms;
    return {
      levels: Array.from(this.levels),
      peaks: Array.from(this.peaks),
      cols: u.cols!.value as number,
      centered: (u.centered!.value as number) > 0.5,
      classic: (u.classic!.value as number) > 0.5,
      heightFrac: u.heightFrac!.value as number,
      dotSize: u.dotSize!.value as number,
      dim: u.dim!.value as number,
      boost: u.boost!.value as number,
    };
  }

  private applyTheme(name: string): void {
    this.themeName = name;
    const p = (PALETTES[name] ?? PALETTES.default!)();
    const u = this.material.uniforms;
    u.colA!.value.copy(p.a);
    u.colB!.value.copy(p.b);
    u.colPeak!.value.copy(p.peak);
  }

  private writeUniforms(params: CommonParams & Record<string, unknown>, intensity: number): void {
    const u = this.material.uniforms;
    (u.lv!.value as Float32Array).set(this.levels);
    (u.pk!.value as Float32Array).set(this.peaks);
    u.cols!.value = COLUMNS[String(params.columns)] ?? 32;
    u.centered!.value = params.layout === 'center' ? 1 : 0;
    u.classic!.value = params.colors === 'theme' ? 0 : 1;
    u.heightFrac!.value = 0.25 + 0.7 * unit(params.height, 0.6);
    u.dotSize!.value = 0.4 + 0.55 * unit(params.dot, 0.7);
    // 点灯していない LED: うっすら (うすい格子の設定 + 低音で少し)
    u.dim!.value = unit(params.grid, 0.4) * (0.1 + 0.1 * this.bassGlow);
    // 点灯の明るさ: 拍で少しだけ (最大 +25%)
    u.boost!.value = 1 + 0.25 * this.beatGlow;
    u.intensity!.value = 0.55 + 0.75 * intensity;
  }
}
