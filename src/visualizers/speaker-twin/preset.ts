import * as THREE from 'three';
import { shapeAudio, shapeBands } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { createTwinMaterial, MAX_WAVES, STRIP_BARS, WOOFER_RINGS } from './shaders';

/**
 * Twin Speakers — 背景の絵に重ねて使う、スピーカー 2 台のエフェクト (ユーザー要望 2026-10-03「スピーカー 2 つバージョン」)。
 * Speaker Cone と同じく、黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる)。
 * 左右にキャビネットが 1 台ずつ。それぞれウーファー (大きなコーン) とツイーター (上の小さなコーン)、足元のイコライザーを持つ。
 *
 * 反応の仕組み (docs/ARCHITECTURE.md「プリセット初期3種の反応設計」にならう):
 * - bass: 両方のウーファーが動く。左は低音そのまま、右は低音を少し弱め、中音を足す (左右で動きが違う)。
 *   その動きが 7 本のリングを中心から外へ、時間差をつけて伝わる。立ち上がりは速く、戻りはゆっくり (光過敏への配慮)。
 * - beat: 拍が変わるたびに、強く鳴る側が左右で入れ替わる (「交互に鳴らす」の量で、もう片方がどれだけ控えめになるか)。
 *   強く鳴った側のウーファーから、圧力波が広がって薄れる (同時に 5 本まで)。波は先頭が鋭く (R・G・B がずれた縁)、内側へ長い尾と余韻の輪を引き、
 *   最初に速く遠くでゆっくり広がる。反対側のキャビネットに届くと、その輪郭とウーファーの縁が光る (左右の掛け合い。2026-10-03「波動がださい」で作り直し)。
 * - high: ツイーター (上の小さなコーン) が光る。右の台のほうが少し強い。
 * - 帯域 (bands): 足元の 16 本の棒。左の台は低〜中域、右の台は中〜高域。
 * - intensity: 全体の明るさ。
 * 設定: 大きさ・間隔・上下の位置・足元の棒の量・交互に鳴らす量。乱数は使わない (時刻の積み重ねだけで決まる)。
 */

/** スピーカーの基本の半径 (画面の高さの半分 = 1 として)。キャビネット全体 (足元の棒まで) は半径の約 4.3 倍の高さ */
const BASE_RADIUS = 0.34;
/** キャビネットの半幅 (半径の倍数) と、全体の高さ (半径の倍数。足元の棒の下から上の端まで) */
const HALF_WIDTH = 1.3;
const TOTAL_HEIGHT = 4.5;
/** リングの時間差を作る、低音の動きの履歴の刻み (秒) と、リング 1 つぶんの遅れ (刻みの数) */
const HISTORY_STEP = 1 / 60;
const RING_DELAY_STEPS = 2;
const HISTORY_LENGTH = WOOFER_RINGS * RING_DELAY_STEPS + 2;
/** 波の広がり方 (2026-10-03 作り直し): 最初に速く、遠くでゆっくり (イージング)。半径 = 1 + WAVE_REACH × (1 - exp(-経過秒 × WAVE_RATE)) */
const WAVE_REACH = 3.2;
const WAVE_RATE = 1.5;
const WAVE_FADE = 1.0;
/** 波が反対側のキャビネットの手前 (キャビネットの半幅ぶん手前) に届いたとき、そこが光る強さ (波の明るさにかける) と、戻る速さ */
const HIT_GAIN = 1.1;
const RIM_DECAY = 4.5;

interface Palette {
  a: THREE.Color;
  b: THREE.Color;
  cap: THREE.Color;
}
const c = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
/** 配色 (線形色空間。共通パラメータ Color Theme に対応)。左の台は a 寄り、右の台は b 寄り。既定はミントグリーンと青 */
const PALETTES: Record<string, () => Palette> = {
  default: () => ({ a: c(0.16, 0.95, 0.62), b: c(0.3, 0.55, 1.0), cap: c(0.6, 1.0, 0.88) }),
  gold: () => ({ a: c(1.0, 0.78, 0.35), b: c(1.0, 0.45, 0.2), cap: c(1.0, 0.9, 0.6) }),
  ice: () => ({ a: c(0.5, 0.85, 1.0), b: c(0.45, 0.5, 1.0), cap: c(0.8, 0.95, 1.0) }),
  neon: () => ({ a: c(1.0, 0.3, 0.85), b: c(0.3, 0.85, 1.0), cap: c(1.0, 0.6, 0.95) }),
  mono: () => ({ a: c(1.0, 1.0, 1.0), b: c(0.72, 0.75, 0.85), cap: c(1.0, 1.0, 1.0) }),
};

export interface SpeakerTwinInspection {
  /** 左右のウーファーの動き 0..1.2 */
  cap: { left: number; right: number };
  /** 左右のツイーターの強さ 0..1 */
  tweeter: { left: number; right: number };
  /** 左右のウーファーのリングの動き (中心 → 外。時間差がある) */
  rings: { left: number[]; right: number[] };
  /** 足元のイコライザーの棒 */
  strip: { left: number[]; right: number[] };
  /** いま出ている波の数と、波の中心が左右どちらか (-1 = 左、1 = 右) */
  waveCount: number;
  waveSides: number[];
  /** 波が届いて光る、左右のキャビネットの輪郭の強さ (0 .. 1.2) */
  rim: { left: number; right: number };
  /** いま出ている波の半径 (スピーカーの半径 = 1) */
  waveRadii: number[];
  /** スピーカーの半径と、左右の中心 (画面の高さの半分 = 1) */
  radius: number;
  centers: { left: { x: number; y: number }; right: { x: number; y: number } };
  /** 強く鳴っている側 (0 = 左 … 1 = 右。なめらかに入れ替わる) */
  side: number;
}

const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const unit = (v: unknown, d: number): number => Math.min(1, Math.max(0, fin(v, d)));
/** 立ち上がりは速く、戻りはゆっくり */
function follow(cur: number, target: number, dt: number, up: number, down: number): number {
  return cur + (target - cur) * (1 - Math.exp(-(target > cur ? up : down) * dt));
}

export class SpeakerTwinPreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly material = createTwinMaterial();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private themeName = '';
  private aspect = 16 / 9;

  private capL = 0;
  private capR = 0;
  private twL = 0;
  private twR = 0;
  private side = 0;
  private readonly histL = new Float32Array(HISTORY_LENGTH);
  private readonly histR = new Float32Array(HISTORY_LENGTH);
  private historyClock = 0;
  private readonly waveR = new Float32Array(MAX_WAVES);
  private readonly waveA = new Float32Array(MAX_WAVES);
  private readonly waveSide = new Int8Array(MAX_WAVES);
  private readonly waveAge = new Float32Array(MAX_WAVES);
  /** 波が反対側に届いたか (1 つの波につき 1 回だけ光らせる) */
  private readonly waveHit = new Uint8Array(MAX_WAVES);
  private rimL = 0;
  private rimR = 0;
  private nextWave = 0;
  private lastBeatIndex = -1;
  private readonly stripL = new Float32Array(STRIP_BARS);
  private readonly stripR = new Float32Array(STRIP_BARS);
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
    // 壊れた値 (NaN など) が来ても、動きに残らないようにする
    const bass = fin(shaped.bass, 0);
    const mid = fin(shaped.mid, 0);
    const high = fin(shaped.high, 0);
    const beat = fin(shaped.beat, 0);
    shapeBands(frame.bands, params, this.shapedBands);
    const intensity = unit(params.intensity, 0.8);
    const motion = unit(params.motion, 0.6);
    const alternate = unit(params.alternate, 0.7);

    // 強く鳴る側 (拍が変わるたびに左右が入れ替わる。なめらかに)
    const beatIndex = Number.isFinite(frame.beatIndex) ? frame.beatIndex : -1;
    const newBeat = beatIndex !== this.lastBeatIndex;
    if (newBeat) this.lastBeatIndex = beatIndex;
    const strongRight = beatIndex >= 0 && beatIndex % 2 === 1;
    const sideTarget = beatIndex < 0 ? 0.5 : strongRight ? 1 : 0;
    this.side = follow(this.side, sideTarget, dt, 9, 9);

    // ウーファーの動き: 左は低音そのまま、右は低音を少し弱めて中音を足す。強く鳴る側が大きい
    const wl = 1 - 0.5 * alternate * this.side;
    const wr = 1 - 0.5 * alternate * (1 - this.side);
    const driveL = Math.min(1.2, (bass * 1.1 + beat * 0.25) * wl);
    const driveR = Math.min(1.2, (bass * 0.9 + mid * 0.3 + beat * 0.25) * wr);
    this.capL = follow(this.capL, driveL, dt, 22, 5);
    this.capR = follow(this.capR, driveR, dt, 22, 5);
    // ツイーター (高音。右が少し強い)
    this.twL = follow(this.twL, Math.min(1, high * 0.85), dt, 28, 8);
    this.twR = follow(this.twR, Math.min(1, high * 1.0), dt, 28, 8);

    // 動きの履歴: 一定の刻みで積む (フレームの間隔に関係なく、リングの時間差が同じになる)
    this.historyClock += dt;
    while (this.historyClock >= HISTORY_STEP) {
      this.historyClock -= HISTORY_STEP;
      this.histL.copyWithin(1, 0, HISTORY_LENGTH - 1);
      this.histR.copyWithin(1, 0, HISTORY_LENGTH - 1);
      this.histL[0] = this.capL;
      this.histR[0] = this.capR;
    }
    this.histL[0] = this.capL;
    this.histR[0] = this.capR;

    // 拍の波: 強く鳴った側のウーファーから
    if (newBeat && beatIndex >= 0 && beat > 0.25) {
      const i = this.nextWave;
      this.nextWave = (this.nextWave + 1) % MAX_WAVES;
      this.waveR[i] = 1.0;
      this.waveAge[i] = 0;
      this.waveHit[i] = 0;
      this.waveSide[i] = strongRight ? 1 : -1;
      this.waveA[i] = Math.min(0.85, (0.3 + 0.5 * bass + 0.3 * beat) * (0.6 + 0.8 * intensity));
    }
    // 波: イージングで広がる (Motion で全体が速くなる)。反対側のキャビネットに届いたら、そこの輪郭が光る (1 つの波につき 1 回)
    const lay = this.layout(params);
    const reach = (2 * lay.dx) / lay.radius - HALF_WIDTH; // 反対側のキャビネットの手前の端までの、スピーカーの半径の倍数
    const rate = WAVE_RATE * (0.7 + 0.6 * motion);
    this.rimL = follow(this.rimL, 0, dt, 1, RIM_DECAY);
    this.rimR = follow(this.rimR, 0, dt, 1, RIM_DECAY);
    for (let i = 0; i < MAX_WAVES; i++) {
      if (this.waveA[i]! <= 0) continue;
      this.waveAge[i] = this.waveAge[i]! + dt;
      this.waveR[i] = 1 + WAVE_REACH * (1 - Math.exp(-this.waveAge[i]! * rate));
      this.waveA[i] = this.waveA[i]! * Math.exp(-WAVE_FADE * dt);
      if (!this.waveHit[i] && this.waveR[i]! >= reach) {
        this.waveHit[i] = 1;
        const hit = Math.min(1.2, this.waveA[i]! * HIT_GAIN);
        // 右から出た波 (side = 1) は左を、左から出た波は右を光らせる
        if (this.waveSide[i]! > 0) this.rimL = Math.max(this.rimL, hit);
        else this.rimR = Math.max(this.rimR, hit);
      }
      if (this.waveA[i]! < 0.02) this.waveA[i] = 0;
    }

    // 足元のイコライザー: 左は低〜中域 (0..30)、右は中〜高域 (16..46)
    for (let i = 0; i < STRIP_BARS; i++) {
      this.stripL[i] = follow(this.stripL[i]!, fin(this.shapedBands[i * 2], 0), dt, 30, 7);
      this.stripR[i] = follow(this.stripR[i]!, fin(this.shapedBands[16 + i * 2], 0), dt, 30, 7);
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
  inspect(): SpeakerTwinInspection {
    const u = this.material.uniforms;
    const cl = u.cL!.value as THREE.Vector2;
    const cr = u.cR!.value as THREE.Vector2;
    const waveSides: number[] = [];
    const waveRadii: number[] = [];
    let waveCount = 0;
    for (let i = 0; i < MAX_WAVES; i++) {
      if (this.waveA[i]! > 0) {
        waveCount++;
        waveSides.push(this.waveSide[i]!);
        waveRadii.push(this.waveR[i]!);
      }
    }
    return {
      cap: { left: this.capL, right: this.capR },
      tweeter: { left: this.twL, right: this.twR },
      rings: { left: Array.from(u.exL!.value as Float32Array), right: Array.from(u.exR!.value as Float32Array) },
      strip: { left: Array.from(this.stripL), right: Array.from(this.stripR) },
      waveCount,
      waveSides,
      rim: { left: this.rimL, right: this.rimR },
      waveRadii,
      radius: u.radius!.value as number,
      centers: { left: { x: cl.x, y: cl.y }, right: { x: cr.x, y: cr.y } },
      side: this.side,
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

  /** 2 台の配置 (半径・中心の左右の距離・中心の高さ)。大きさ・間隔・上下の設定と画面の縦横比から決まる */
  private layout(params: CommonParams & Record<string, unknown>): { radius: number; dx: number; cy: number } {
    const size = Math.min(1.6, Math.max(0.4, fin(params.size, 1)));
    const radius = BASE_RADIUS * size;
    // 配置: 2 台の中心の間隔は、画面の幅に収まる範囲で (間隔 0 = ぴったり並べる、1 = 左右の端いっぱい)
    const half = radius * HALF_WIDTH;
    const nearest = half + 0.03;
    const widest = Math.max(nearest, this.aspect - half - 0.03);
    const spacing = unit(params.spacing, 0.6);
    const dx = nearest + (widest - nearest) * spacing;
    // 上下: キャビネットは足元の棒から上の端まで高さがあるので、画面に収まる範囲で動かせる
    const total = radius * TOTAL_HEIGHT;
    const room = Math.max(0, 1 - total / 2 - 0.03);
    const oy = Math.min(1, Math.max(-1, fin(params.offsetY, 0)));
    // キャビネットの中心は、足元の棒の下 (-2.45) と上の端 (+2.05) の真ん中 (= -0.2 R) が画面の中心に来るようにする
    const cy = oy * room + radius * 0.2;
    return { radius, dx, cy };
  }

  private writeUniforms(params: CommonParams & Record<string, unknown>, intensity: number): void {
    const u = this.material.uniforms;
    const { radius, dx, cy } = this.layout(params);
    (u.cL!.value as THREE.Vector2).set(-dx, cy);
    (u.cR!.value as THREE.Vector2).set(dx, cy);
    u.radius!.value = radius;
    u.capL!.value = this.capL;
    u.capR!.value = this.capR;
    u.twL!.value = this.twL;
    u.twR!.value = this.twR;
    u.rimL!.value = this.rimL;
    u.rimR!.value = this.rimR;
    const exL = u.exL!.value as Float32Array;
    const exR = u.exR!.value as Float32Array;
    for (let k = 0; k < WOOFER_RINGS; k++) {
      const at = Math.min(HISTORY_LENGTH - 1, k * RING_DELAY_STEPS);
      exL[k] = this.histL[at]!;
      exR[k] = this.histR[at]!;
    }
    (u.stripL!.value as Float32Array).set(this.stripL);
    (u.stripR!.value as Float32Array).set(this.stripR);
    const waveC = u.waveC!.value as THREE.Vector2[];
    for (let i = 0; i < MAX_WAVES; i++) waveC[i]!.set(this.waveSide[i]! * dx, cy - 0.3 * radius);
    (u.waveR!.value as Float32Array).set(this.waveR);
    (u.waveA!.value as Float32Array).set(this.waveA);
    u.stripAmount!.value = unit(params.strip, 0.8);
    u.intensity!.value = 0.55 + 0.75 * intensity;
  }
}
