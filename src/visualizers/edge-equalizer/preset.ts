import * as THREE from 'three';
import { shapeAudio, shapeBands } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { createEdgeMaterial, EDGE_BARS, MAX_PULSES } from './shaders';

/**
 * Edge Equalizer — 背景の絵に重ねて使う、画面の縁のイコライザー (ユーザー要望 2026-10-03「画面の縁のイコライザー」「イコライザー系いろいろ」)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる): 絵はそのまま見えて、縁に光の棒が並ぶ。
 * 画面の縁 (下・右・上・左) に棒が並び、内側へ伸びる。下の真ん中が低音、上の真ん中が高音で、左右対称。
 *
 * 反応の仕組み (docs/ARCHITECTURE.md「プリセット初期3種の反応設計」にならう):
 * - 帯域 (bands): 棒 48 本 (×左右) の長さ。立ち上がりは速く、戻りはゆっくり。
 * - ピーク線: 棒の先に、ゆっくり落ちる線が残る (しばらく止まってから、一定の速さで落ちる)。
 * - bass: 縁の細い線が明るくなる。
 * - beat (拍が変わったとき): 光が下の真ん中から縁を走る (同時に 3 つまで)。
 * - intensity: 全体の明るさ。
 * 設定: 使う辺 (全部 / 上下 / 左右 / 下だけ)・棒の長さ・LED 風の区切り・ピーク線の量・走る光の量。
 * 乱数は使わない (時刻の積み重ねだけで決まる = 同じプロジェクトなら同じ映像)。
 */

/** 棒の最大の長さ (画面の高さの半分 = 1 として) の基本 */
const BASE_LENGTH = 0.5;
/** ピーク線が止まっている時間 (秒) と、そのあと落ちる速さ (棒の長さ / 秒) */
const PEAK_HOLD = 0.3;
const PEAK_FALL = 0.55;
/** 走る光の速さ (縁の半周 = 1 として / 秒) */
const PULSE_SPEED = 0.85;
const PULSE_FADE = 0.9;

interface Palette {
  a: THREE.Color;
  b: THREE.Color;
  peak: THREE.Color;
}
const c = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
/** 配色 (線形色空間。共通パラメータ Color Theme に対応)。下の真ん中 (低音) が a、上の真ん中 (高音) が b。既定はミントグリーンから青 */
const PALETTES: Record<string, () => Palette> = {
  default: () => ({ a: c(0.16, 0.95, 0.62), b: c(0.3, 0.5, 1.0), peak: c(0.85, 1.0, 0.95) }),
  gold: () => ({ a: c(1.0, 0.55, 0.2), b: c(1.0, 0.9, 0.5), peak: c(1.0, 0.95, 0.8) }),
  ice: () => ({ a: c(0.4, 0.8, 1.0), b: c(0.7, 0.6, 1.0), peak: c(0.9, 0.97, 1.0) }),
  neon: () => ({ a: c(1.0, 0.3, 0.85), b: c(0.3, 0.85, 1.0), peak: c(1.0, 0.85, 1.0) }),
  mono: () => ({ a: c(1.0, 1.0, 1.0), b: c(0.72, 0.75, 0.85), peak: c(1.0, 1.0, 1.0) }),
};

/** 使う辺の組み合わせ (下・右・上・左) */
const EDGE_SETS: Record<string, [number, number, number, number]> = {
  all: [1, 1, 1, 1],
  topbottom: [1, 0, 1, 0],
  sides: [0, 1, 0, 1],
  bottom: [1, 0, 0, 0],
};

export interface EdgeEqualizerInspection {
  /** 棒の強さ (0..1。下の真ん中 = 低音から上の真ん中 = 高音) */
  levels: number[];
  /** ピーク線の位置 (0..1) */
  peaks: number[];
  /** いま走っている光の数と、その位置 (0..1。下の真ん中 = 0、上の真ん中 = 1) */
  pulseCount: number;
  pulsePositions: number[];
  /** 縁の細い線の明るさ */
  frame: number;
  /** 使う辺 (下・右・上・左) */
  edges: number[];
  /** 棒の最大の長さ */
  barLength: number;
  led: number;
}

const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const unit = (v: unknown, d: number): number => Math.min(1, Math.max(0, fin(v, d)));
/** 立ち上がりは速く、戻りはゆっくり */
function follow(cur: number, target: number, dt: number, up: number, down: number): number {
  return cur + (target - cur) * (1 - Math.exp(-(target > cur ? up : down) * dt));
}

export class EdgeEqualizerPreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly material = createEdgeMaterial();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private themeName = '';
  private aspect = 16 / 9;

  private readonly levels = new Float32Array(EDGE_BARS);
  private readonly peaks = new Float32Array(EDGE_BARS);
  private readonly peakHold = new Float32Array(EDGE_BARS);
  private frameGlow = 0;
  private readonly pulseM = new Float32Array(MAX_PULSES);
  private readonly pulseA = new Float32Array(MAX_PULSES);
  private nextPulse = 0;
  private lastBeatIndex = -1;
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
    const pulseAmount = unit(params.pulse, 0.7);

    // 棒: 帯域ごと (棒 j は帯域 j / 47 * 46)。立ち上がりは速く、戻りはゆっくり
    for (let j = 0; j < EDGE_BARS; j++) {
      const band = Math.round((j / (EDGE_BARS - 1)) * 46);
      const target = Math.min(1, fin(this.shapedBands[band], 0));
      this.levels[j] = follow(this.levels[j]!, target, dt, 32, 7);
      // ピーク線: 棒より上なら追いつく。そのあと PEAK_HOLD 秒止まって、一定の速さで落ちる
      if (this.levels[j]! >= this.peaks[j]!) {
        this.peaks[j] = this.levels[j]!;
        this.peakHold[j] = PEAK_HOLD;
      } else if (this.peakHold[j]! > 0) {
        this.peakHold[j] = Math.max(0, this.peakHold[j]! - dt);
      } else {
        this.peaks[j] = Math.max(this.levels[j]!, this.peaks[j]! - PEAK_FALL * dt);
      }
    }

    // 縁の細い線: 低音でほんのり明るい (なめらかに)
    this.frameGlow = follow(this.frameGlow, 0.12 + 0.5 * bass, dt, 14, 3);

    // 拍で走る光
    const beatIndex = Number.isFinite(frame.beatIndex) ? frame.beatIndex : -1;
    if (beatIndex !== this.lastBeatIndex) {
      this.lastBeatIndex = beatIndex;
      if (beatIndex >= 0 && beat > 0.25 && pulseAmount > 0) {
        const i = this.nextPulse;
        this.nextPulse = (this.nextPulse + 1) % MAX_PULSES;
        this.pulseM[i] = 0;
        this.pulseA[i] = Math.min(0.9, (0.35 + 0.5 * beat + 0.3 * bass) * pulseAmount * (0.6 + 0.8 * intensity));
      }
    }
    for (let i = 0; i < MAX_PULSES; i++) {
      if (this.pulseA[i]! <= 0) continue;
      this.pulseM[i] = this.pulseM[i]! + PULSE_SPEED * dt;
      this.pulseA[i] = this.pulseA[i]! * Math.exp(-PULSE_FADE * dt);
      if (this.pulseM[i]! > 1.05 || this.pulseA[i]! < 0.02) this.pulseA[i] = 0;
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
  inspect(): EdgeEqualizerInspection {
    const u = this.material.uniforms;
    const e = u.edges!.value as THREE.Vector4;
    const positions: number[] = [];
    for (let i = 0; i < MAX_PULSES; i++) if (this.pulseA[i]! > 0) positions.push(this.pulseM[i]!);
    return {
      levels: Array.from(this.levels),
      peaks: Array.from(this.peaks),
      pulseCount: positions.length,
      pulsePositions: positions,
      frame: this.frameGlow,
      edges: [e.x, e.y, e.z, e.w],
      barLength: u.barLen!.value as number,
      led: u.led!.value as number,
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
    (u.pulseM!.value as Float32Array).set(this.pulseM);
    (u.pulseA!.value as Float32Array).set(this.pulseA);
    const set = EDGE_SETS[String(params.edges)] ?? EDGE_SETS.all!;
    (u.edges!.value as THREE.Vector4).set(set[0], set[1], set[2], set[3]);
    const length = Math.min(1.5, Math.max(0.4, fin(params.length, 1)));
    u.barLen!.value = BASE_LENGTH * length;
    u.led!.value = params.style === 'led' ? 1 : 0;
    u.peakAmount!.value = unit(params.peaks, 0.8);
    u.frame!.value = this.frameGlow;
    u.intensity!.value = 0.55 + 0.75 * intensity;
  }
}
