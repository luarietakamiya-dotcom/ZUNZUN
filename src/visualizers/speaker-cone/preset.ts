import * as THREE from 'three';
import { shapeAudio, shapeBands } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { CONE_RINGS, createConeMaterial, EQ_BARS, MAX_BURSTS } from './shaders';

/**
 * Speaker Cone — 背景の絵に重ねて使う、スピーカーのコーン風のエフェクト。
 * 2026-10-03 ユーザー「背景を絵にした状態で使うのを前提にした、スピーカーのコーン風エフェクトとか」。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる。Visualizer タブの既定の重ね方): 黒は透けて、光だけが絵に乗る。
 *
 * 反応の仕組み (docs/ARCHITECTURE.md「プリセット初期3種の反応設計」にならう):
 * - bass: コーンが前後に動く。中心のドームがふくらんで明るくなり、その動きが 9 本のリングを中心から外へ、時間差をつけて伝わる
 *   (コーンが波打つ)。立ち上がりは速く、戻りはゆっくり (光過敏への配慮)。
 * - beat: 拍ごとに、縁から放射状に 48 粒が飛び出し、彗星のような尾を引いて薄れる (同時に 4 回分まで)。向きは拍ごとに回る。
 *   強さは低音と拍で決まる。飛ぶ範囲は半径の 3 倍まで (画面いっぱいには広がらない = 背景の絵が隠れない。
 *   2026-10-03 ユーザー「波動で画面見えなくなる」で、広がる輪から変えた)。
 * - 帯域 (bands): 外枠のまわりの 40 本の棒 (左右対称、上が低音・下が高音) が、帯域ごとの強さで伸びる (イコライザー)。
 * - intensity: 全体の明るさ。
 * 設定: 大きさ・位置 (左右 / 上下)・まわりの棒 (イコライザー) の量・拍の波の量。
 * 乱数は使わない (時刻の積み重ねだけで決まる = 同じプロジェクトなら同じ映像)。
 */

/** コーンの基本の半径 (画面の高さの半分 = 1 として) */
const BASE_RADIUS = 0.5;
/** リングごとの時間差を作る、低音の動きの履歴の刻み (秒) と、リング 1 つぶんの遅れ (刻みの数) */
const HISTORY_STEP = 1 / 60;
const RING_DELAY_STEPS = 2;
const HISTORY_LENGTH = CONE_RINGS * RING_DELAY_STEPS + 2;
/** 波の広がる速さ (スピーカーの半径 / 秒) と、薄れる速さ */
/** 粒の飛び方 (最初に速く、遠くでゆっくり): 半径 = 1.08 + 飛ぶ距離 × (1 - exp(-経過秒 × BURST_RATE))。薄れる速さと、消える時間 */
const BURST_RATE = 1.8;
const BURST_FADE = 1.1;
const BURST_LIFE = 2.4;
/** 粒が飛ぶいちばん遠い距離 (スピーカーの半径の倍数。シェーダーの 1.08 + 0.7 + 1.3 = 3.08 より内側に収まる) */
const BURST_MAX_RADIUS = 3.08;

interface Palette {
  a: THREE.Color;
  b: THREE.Color;
  cap: THREE.Color;
}
const c = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
/** 配色 (線形色空間。共通パラメータ Color Theme に対応)。既定はミントグリーンと青 */
const PALETTES: Record<string, () => Palette> = {
  default: () => ({ a: c(0.16, 0.95, 0.62), b: c(0.22, 0.58, 1.0), cap: c(0.55, 1.0, 0.85) }),
  gold: () => ({ a: c(1.0, 0.78, 0.35), b: c(1.0, 0.5, 0.18), cap: c(1.0, 0.9, 0.6) }),
  ice: () => ({ a: c(0.5, 0.85, 1.0), b: c(0.35, 0.55, 1.0), cap: c(0.8, 0.95, 1.0) }),
  neon: () => ({ a: c(1.0, 0.3, 0.85), b: c(0.3, 0.85, 1.0), cap: c(1.0, 0.6, 0.95) }),
  mono: () => ({ a: c(1.0, 1.0, 1.0), b: c(0.75, 0.78, 0.85), cap: c(1.0, 1.0, 1.0) }),
};

export interface SpeakerConeInspection {
  /** コーンの中心 (ドーム) の動き 0..1.2 */
  cap: number;
  /** 各リングの動き (中心 → 外。時間差がある) */
  ringEx: number[];
  /** いま出ている波の数と、いちばん外の波の半径 (スピーカーの半径 = 1) */
  burstCount: number;
  /** いちばん遠くへ飛んでいる粒の半径の上限 (スピーカーの半径 = 1) */
  burstMaxRadius: number;
  /** イコライザーの棒の強さ (0..1) */
  eq: number[];
  /** スピーカーの半径と中心 (画面の高さの半分 = 1) */
  radius: number;
  center: { x: number; y: number };
  aspect: number;
}

const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const unit = (v: unknown, d: number): number => Math.min(1, Math.max(0, fin(v, d)));
/** 立ち上がりは速く、戻りはゆっくり */
function follow(cur: number, target: number, dt: number, up: number, down: number): number {
  return cur + (target - cur) * (1 - Math.exp(-(target > cur ? up : down) * dt));
}

export class SpeakerConePreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly material = createConeMaterial();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private themeName = '';
  private aspect = 16 / 9;
  private t = 0;

  private cap = 0;
  /** 低音の動きの履歴 (新しい順に前へ詰める刻みごとの値)。リングの時間差に使う */
  private readonly history = new Float32Array(HISTORY_LENGTH);
  private historyClock = 0;
  private readonly burstAge = new Float32Array(MAX_BURSTS);
  private readonly burstAmp = new Float32Array(MAX_BURSTS);
  private readonly burstPhase = new Float32Array(MAX_BURSTS);
  private readonly burstSalt = new Float32Array(MAX_BURSTS);
  private nextBurst = 0;
  /** 粒の飛ぶ速さに使う Motion (update で受け取る) */
  private motion = 0.6;
  private lastBeatIndex = -1;
  private readonly eq = new Float32Array(EQ_BARS);
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
    this.t += dt;
    if (params.colorTheme !== this.themeName) this.applyTheme(params.colorTheme);
    const shaped = shapeAudio(frame, params);
    // 壊れた値 (NaN など) が来ても、動きに残らないようにする
    const a = { bass: fin(shaped.bass, 0), beat: fin(shaped.beat, 0) };
    shapeBands(frame.bands, params, this.shapedBands);
    const motion = unit(params.motion, 0.6);
    this.motion = motion;
    const intensity = unit(params.intensity, 0.8);

    // コーンの動き (低音。立ち上がりは速く、戻りはゆっくり)
    this.cap = follow(this.cap, Math.min(1.2, a.bass * 1.1 + a.beat * 0.25), dt, 22, 5);
    // 動きの履歴: 一定の刻みで積む (フレームの間隔に関係なく、リングの時間差が同じになる)
    this.historyClock += dt;
    while (this.historyClock >= HISTORY_STEP) {
      this.historyClock -= HISTORY_STEP;
      this.history.copyWithin(1, 0, HISTORY_LENGTH - 1);
      this.history[0] = this.cap;
    }
    this.history[0] = this.cap;

    // 拍で飛ぶ粒: 拍が変わったら 1 回分 (48 粒) を出す。拍ごとに粒の向きを少しずつ回す (黄金角。乱数は使わない)
    const burstAmount = unit(params.waves, 0.7);
    const beatIndex = Number.isFinite(frame.beatIndex) ? frame.beatIndex : -1;
    if (beatIndex !== this.lastBeatIndex) {
      this.lastBeatIndex = beatIndex;
      if (beatIndex >= 0 && a.beat > 0.25 && burstAmount > 0) {
        const i = this.nextBurst;
        this.nextBurst = (this.nextBurst + 1) % MAX_BURSTS;
        this.burstAge[i] = 0;
        this.burstPhase[i] = (beatIndex * 2.399963) % (Math.PI * 2);
        this.burstSalt[i] = (beatIndex * 7.31) % 97;
        this.burstAmp[i] = Math.min(0.9, (0.35 + 0.5 * a.bass + 0.3 * a.beat) * burstAmount * (0.6 + 0.8 * intensity));
      }
    }
    for (let i = 0; i < MAX_BURSTS; i++) {
      if (this.burstAmp[i]! <= 0) continue;
      this.burstAge[i] = this.burstAge[i]! + dt;
      this.burstAmp[i] = this.burstAmp[i]! * Math.exp(-BURST_FADE * dt);
      if (this.burstAmp[i]! < 0.02 || this.burstAge[i]! > BURST_LIFE) this.burstAmp[i] = 0;
    }

    // イコライザーの棒 (帯域ごと。立ち上がりは速く、戻りはゆっくり)
    for (let i = 0; i < EQ_BARS; i++) this.eq[i] = follow(this.eq[i]!, fin(this.shapedBands[i], 0), dt, 30, 7);

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
  inspect(): SpeakerConeInspection {
    const u = this.material.uniforms;
    const center = u.center!.value as THREE.Vector2;
    let burstCount = 0;
    let burstMax = 0;
    const rate = BURST_RATE * (0.7 + 0.6 * this.motion);
    for (let i = 0; i < MAX_BURSTS; i++) {
      if (this.burstAmp[i]! > 0) {
        burstCount++;
        // いちばん遠くへ飛ぶ粒 (飛ぶ距離 2.0) の、いまの半径
        burstMax = Math.max(burstMax, 1.08 + 2.0 * (1 - Math.exp(-this.burstAge[i]! * rate)));
      }
    }
    return {
      cap: this.cap,
      ringEx: Array.from(u.ringEx!.value as Float32Array),
      burstCount,
      burstMaxRadius: Math.min(BURST_MAX_RADIUS, burstMax),
      eq: Array.from(this.eq),
      radius: u.radius!.value as number,
      center: { x: center.x, y: center.y },
      aspect: this.aspect,
    };
  }

  private applyTheme(name: string): void {
    this.themeName = name;
    const p = (PALETTES[name] ?? PALETTES.default!)();
    const u = this.material.uniforms;
    u.colA!.value.copy(p.a);
    u.colB!.value.copy(p.b);
    u.colCap!.value.copy(p.cap);
  }

  private writeUniforms(params: CommonParams & Record<string, unknown>, intensity: number): void {
    const u = this.material.uniforms;
    const size = Math.min(1.6, Math.max(0.4, fin(params.size, 1)));
    const radius = BASE_RADIUS * size;
    // 位置: 画面の中で、スピーカーの外枠 (半径の 1.9 倍ほど: イコライザーの棒まで) が収まる範囲を、-1..1 で
    const roomX = Math.max(0, this.aspect - radius * 1.9);
    const roomY = Math.max(0, 1 - radius * 1.9);
    const ox = Math.min(1, Math.max(-1, fin(params.offsetX, 0)));
    const oy = Math.min(1, Math.max(-1, fin(params.offsetY, 0)));
    (u.center!.value as THREE.Vector2).set(ox * roomX, oy * roomY);
    u.radius!.value = radius;
    u.cap!.value = this.cap;
    const ringEx = u.ringEx!.value as Float32Array;
    for (let k = 0; k < CONE_RINGS; k++) ringEx[k] = this.history[Math.min(HISTORY_LENGTH - 1, k * RING_DELAY_STEPS)]!;
    (u.burstAge!.value as Float32Array).set(this.burstAge);
    (u.burstAmp!.value as Float32Array).set(this.burstAmp);
    (u.burstPhase!.value as Float32Array).set(this.burstPhase);
    (u.burstSalt!.value as Float32Array).set(this.burstSalt);
    u.burstRate!.value = BURST_RATE * (0.7 + 0.6 * this.motion);
    (u.eq!.value as Float32Array).set(this.eq);
    u.eqAmount!.value = unit(params.equalizer, 0.8);
    // 全体の明るさ (静かなときも、コーンの形が見える程度に残す)
    u.intensity!.value = 0.55 + 0.75 * intensity;
  }
}
