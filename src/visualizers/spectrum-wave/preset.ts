import * as THREE from 'three';
import { shapeAudio, shapeBands } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { createWaveMaterial, MAX_SPOTS, WAVE_POINTS } from './shaders';

/**
 * Spectrum Wave — 背景の絵に重ねて使う、スペクトルのなめらかな光の波形 (ユーザー要望 2026-10-03「イコライザー系いろいろ」)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる)。画面いっぱいに、低音 (左) から高音 (右) への形が
 * なめらかな光の曲線になる。曲線は 3 本 (速い・少し遅い・遅い) で、遅い線ほど前の音の形が残る (リボンのような残像)。
 *
 * 反応の仕組み (docs/ARCHITECTURE.md「プリセット初期3種の反応設計」にならう):
 * - 帯域 (bands): 曲線の高さ。3 本の線は、それぞれ違う戻りの速さで追いかける (立ち上がりは速い線ほど速い)。
 * - bass: 全体の明るさが少し上がる。
 * - beat (拍が変わったとき): 光の点が曲線の上を左から右へ走る (同時に 3 つまで)。
 * - intensity: 全体の明るさ。
 * 設定: 位置 (基準線の高さ)・高さ・反射の量・残像 (リボン) の量・塗りの量。乱数は使わない (同じプロジェクトなら同じ映像)。
 */

/** 光の点が曲線を渡る速さ (横幅 = 1 として / 秒) */
const SPOT_SPEED = 0.7;
const SPOT_FADE = 0.7;

interface Palette {
  a: THREE.Color;
  b: THREE.Color;
  c: THREE.Color;
}
const c = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
/** 配色 (線形色空間。共通パラメータ Color Theme に対応): a = 主な線、b = 2 本目と塗り、c = 3 本目 */
const PALETTES: Record<string, () => Palette> = {
  default: () => ({ a: c(0.35, 0.95, 0.85), b: c(0.3, 0.55, 1.0), c: c(0.85, 0.4, 1.0) }),
  gold: () => ({ a: c(1.0, 0.85, 0.45), b: c(1.0, 0.55, 0.2), c: c(1.0, 0.35, 0.3) }),
  ice: () => ({ a: c(0.7, 0.92, 1.0), b: c(0.4, 0.6, 1.0), c: c(0.6, 0.5, 1.0) }),
  neon: () => ({ a: c(1.0, 0.3, 0.85), b: c(0.3, 0.85, 1.0), c: c(0.7, 1.0, 0.4) }),
  mono: () => ({ a: c(1.0, 1.0, 1.0), b: c(0.75, 0.78, 0.88), c: c(0.5, 0.52, 0.6) }),
};

export interface SpectrumWaveInspection {
  /** 3 本の線の高さ (0..1)。速い線・少し遅い線・遅い線 */
  fast: number[];
  mid: number[];
  slow: number[];
  /** いま走っている光の数と、その位置 (0..1。左 = 0、右 = 1) */
  spotCount: number;
  spotPositions: number[];
  /** 基準線の高さ・曲線のいちばんの高さ・反射・残像・塗り */
  baseY: number;
  height: number;
  mirror: number;
  ribbons: number;
  fill: number;
}

const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const unit = (v: unknown, d: number): number => Math.min(1, Math.max(0, fin(v, d)));
/** 立ち上がりは速く、戻りはゆっくり */
function follow(cur: number, target: number, dt: number, up: number, down: number): number {
  return cur + (target - cur) * (1 - Math.exp(-(target > cur ? up : down) * dt));
}

export class SpectrumWavePreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly material = createWaveMaterial();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private themeName = '';
  private aspect = 16 / 9;

  private readonly fast = new Float32Array(WAVE_POINTS);
  private readonly mid = new Float32Array(WAVE_POINTS);
  private readonly slow = new Float32Array(WAVE_POINTS);
  private readonly spotX = new Float32Array(MAX_SPOTS);
  private readonly spotA = new Float32Array(MAX_SPOTS);
  private nextSpot = 0;
  private lastBeatIndex = -1;
  private glow = 0;
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

    // 3 本の線: 点 j は帯域 j / 47 * 46。速い線ほど立ち上がり・戻りとも速く、遅い線は戻りがゆっくり (前の形が残る)
    for (let j = 0; j < WAVE_POINTS; j++) {
      const band = Math.round((j / (WAVE_POINTS - 1)) * 46);
      // 隣の帯域とならして、曲線をなめらかにする
      const a = fin(this.shapedBands[Math.max(0, band - 1)], 0);
      const b = fin(this.shapedBands[band], 0);
      const d = fin(this.shapedBands[Math.min(63, band + 1)], 0);
      const target = Math.min(1, (a + 2 * b + d) / 4);
      this.fast[j] = follow(this.fast[j]!, target, dt, 32, 9);
      this.mid[j] = follow(this.mid[j]!, target, dt, 20, 3.5);
      this.slow[j] = follow(this.slow[j]!, target, dt, 12, 1.4);
    }
    this.glow = follow(this.glow, bass, dt, 14, 3);

    // 拍で走る光
    const beatIndex = Number.isFinite(frame.beatIndex) ? frame.beatIndex : -1;
    if (beatIndex !== this.lastBeatIndex) {
      this.lastBeatIndex = beatIndex;
      if (beatIndex >= 0 && beat > 0.25) {
        const i = this.nextSpot;
        this.nextSpot = (this.nextSpot + 1) % MAX_SPOTS;
        this.spotX[i] = 0;
        this.spotA[i] = Math.min(0.9, (0.4 + 0.5 * beat + 0.3 * bass) * (0.6 + 0.8 * intensity));
      }
    }
    for (let i = 0; i < MAX_SPOTS; i++) {
      if (this.spotA[i]! <= 0) continue;
      this.spotX[i] = this.spotX[i]! + SPOT_SPEED * dt;
      this.spotA[i] = this.spotA[i]! * Math.exp(-SPOT_FADE * dt);
      if (this.spotX[i]! > 1.1 || this.spotA[i]! < 0.02) this.spotA[i] = 0;
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
  inspect(): SpectrumWaveInspection {
    const u = this.material.uniforms;
    const positions: number[] = [];
    for (let i = 0; i < MAX_SPOTS; i++) if (this.spotA[i]! > 0) positions.push(this.spotX[i]!);
    return {
      fast: Array.from(this.fast),
      mid: Array.from(this.mid),
      slow: Array.from(this.slow),
      spotCount: positions.length,
      spotPositions: positions,
      baseY: u.baseY!.value as number,
      height: u.height!.value as number,
      mirror: u.mirror!.value as number,
      ribbons: u.ribbons!.value as number,
      fill: u.fillAmount!.value as number,
    };
  }

  private applyTheme(name: string): void {
    this.themeName = name;
    const p = (PALETTES[name] ?? PALETTES.default!)();
    const u = this.material.uniforms;
    u.colA!.value.copy(p.a);
    u.colB!.value.copy(p.b);
    u.colC!.value.copy(p.c);
  }

  private writeUniforms(params: CommonParams & Record<string, unknown>, intensity: number): void {
    const u = this.material.uniforms;
    (u.fast!.value as Float32Array).set(this.fast);
    (u.mid!.value as Float32Array).set(this.mid);
    (u.slow!.value as Float32Array).set(this.slow);
    (u.spotX!.value as Float32Array).set(this.spotX);
    (u.spotA!.value as Float32Array).set(this.spotA);
    // 位置: -1 (下) .. 1 (上)。基準線は、画面の高さの半分 (= 1) の -0.8 .. +0.5。曲線は基準線から上へ伸びるので、上の余白を残す
    const pos = Math.min(1, Math.max(-1, fin(params.position, -0.3)));
    const height = 0.35 + 0.75 * unit(params.height, 0.6);
    const baseY = -0.8 + ((pos + 1) / 2) * 1.3;
    u.baseY!.value = Math.min(baseY, 1 - height - 0.05);
    u.height!.value = height;
    u.mirror!.value = unit(params.mirror, 0.6);
    u.ribbons!.value = unit(params.ribbons, 0.8);
    u.fillAmount!.value = unit(params.fill, 0.7);
    u.intensity!.value = (0.55 + 0.75 * intensity) * (1 + 0.15 * this.glow);
  }
}
