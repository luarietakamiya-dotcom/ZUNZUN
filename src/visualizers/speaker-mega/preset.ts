import * as THREE from 'three';
import { shapeAudio, shapeBands } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { createMegaMaterial, MEGA_BARS, MEGA_RINGS, MEGA_WAVES } from './shaders';

/**
 * Mega Speaker — めちゃくちゃ派手なスピーカー (ユーザー要望 2026-10-03「スピーカーをめっちゃ派手なバージョン」)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる前提)。派手だが、白飛びや強い点滅は避ける
 * (光が重なるところはやわらかく頭打ち、明るさの立ち上がりはなめらか。光過敏への配慮)。
 *
 * 反応の仕組み (docs/ARCHITECTURE.md「プリセット初期3種の反応設計」にならう):
 * - bass: コーン (中心の大きなドームと 11 本の虹色のリング) が動き、その動きがリングを中心から外へ、時間差をつけて伝わる。
 *   光の筋の長さとハローの明るさも低音で変わる。立ち上がりは速く、戻りはゆっくり。
 * - beat (拍が変わったとき): 色ずれ (R・G・B) の衝撃波が広がる。光の筋の回転がキックされて (速くなってから、なめらかに戻る)、
 *   星の閃光が走り、虹色が少し進む。
 * - mid: 光の筋の回る速さ (24 本が回り続ける)。
 * - 帯域 (bands): まわりの 48 本の棒 (左右対称、虹色、上が低音・下が高音)。
 * - intensity: 全体の明るさ。
 * 虹色の始まりの色は init() の ctx.rng (project.seed 由来) で決める。Math.random は使わない
 * (同じプロジェクトなら同じ映像)。設定: 大きさ・位置・光の筋の量・虹色の流れる速さ・まわりの棒の量・拍の衝撃波の量。
 */

const BASE_RADIUS = 0.42;
const HISTORY_STEP = 1 / 60;
const RING_DELAY_STEPS = 2;
const HISTORY_LENGTH = MEGA_RINGS * RING_DELAY_STEPS + 2;
const WAVE_SPEED = 1.2;
const WAVE_FADE = 1.2;

export interface SpeakerMegaInspection {
  cap: number;
  ringEx: number[];
  /** 光の筋の向き (ラジアン。増え続ける) と、いまの回る速さ (ラジアン / 秒) */
  rot: number;
  rotSpeed: number;
  /** 光の筋の長さ (スピーカーの半径の倍数) */
  rayLen: number;
  /** 星の閃光 (0..1) とハロー (0..1) */
  star: number;
  halo: number;
  /** 虹色の始まりの色 (0..1 で一周) */
  hue: number;
  waveCount: number;
  eq: number[];
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

export class SpeakerMegaPreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly material = createMegaMaterial();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private aspect = 16 / 9;

  private cap = 0;
  private halo = 0;
  private star = 0;
  private rayLen = 1;
  private rot = 0;
  /** 拍のキックで足される回転の速さ (ラジアン / 秒。なめらかに 0 へ戻る) */
  private kick = 0;
  private rotSpeed = 0;
  private hueBase = 0;
  private hueDrift = 0;
  /** 拍ごとに進む虹色の量 (目標と、そこへなめらかに追いかける現在の値。1 コマで色が飛ぶと、広い範囲の明るさが急に変わるため) */
  private hueStepTarget = 0;
  private hueStep = 0;
  private readonly history = new Float32Array(HISTORY_LENGTH);
  private historyClock = 0;
  private readonly waveR = new Float32Array(MEGA_WAVES);
  private readonly waveA = new Float32Array(MEGA_WAVES);
  private nextWave = 0;
  private lastBeatIndex = -1;
  private readonly eq = new Float32Array(MEGA_BARS);
  private readonly shapedBands = new Float32Array(64);

  init(ctx: VisualizerInitContext): void {
    this.hueBase = ctx.rng();
    this.scene.background = new THREE.Color(0x000000);
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.resize(ctx.width, ctx.height);
  }

  update(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void {
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(frame.dt) ? frame.dt : 0));
    const shaped = shapeAudio(frame, params);
    // 壊れた値 (NaN など) が来ても、動きに残らないようにする
    const bass = fin(shaped.bass, 0);
    const mid = fin(shaped.mid, 0);
    const beat = fin(shaped.beat, 0);
    shapeBands(frame.bands, params, this.shapedBands);
    const intensity = unit(params.intensity, 0.8);
    const motion = unit(params.motion, 0.6);
    const rainbow = unit(params.rainbow, 0.5);
    const wavesAmount = unit(params.waves, 0.8);

    // コーンの動き・ハロー・光の筋の長さ (立ち上がりは速く、戻りはゆっくり)
    this.cap = follow(this.cap, Math.min(1.2, bass * 1.1 + beat * 0.25), dt, 22, 5);
    this.halo = follow(this.halo, Math.min(1, bass * 0.8 + beat * 0.3), dt, 14, 3);
    this.rayLen = follow(this.rayLen, 1.0 + 1.6 * bass + 0.4 * mid, dt, 10, 2.5);
    this.star = follow(this.star, 0, dt, 1, 6); // 拍で上がり、すぐ戻る (上がるのは下の拍の処理)
    this.kick = follow(this.kick, 0, dt, 1, 2.2);

    // 動きの履歴 (一定の刻み。フレームの間隔が違っても、リングの時間差は同じ)
    this.historyClock += dt;
    while (this.historyClock >= HISTORY_STEP) {
      this.historyClock -= HISTORY_STEP;
      this.history.copyWithin(1, 0, HISTORY_LENGTH - 1);
      this.history[0] = this.cap;
    }
    this.history[0] = this.cap;

    // 拍: 衝撃波・回転のキック・星の閃光・虹色が少し進む
    const beatIndex = Number.isFinite(frame.beatIndex) ? frame.beatIndex : -1;
    if (beatIndex !== this.lastBeatIndex) {
      this.lastBeatIndex = beatIndex;
      if (beatIndex >= 0 && beat > 0.25) {
        const i = this.nextWave;
        this.nextWave = (this.nextWave + 1) % MEGA_WAVES;
        this.waveR[i] = 1.0;
        this.waveA[i] = Math.min(0.85, (0.35 + 0.5 * bass + 0.3 * beat) * wavesAmount * (0.6 + 0.8 * intensity));
        this.kick = Math.min(4, this.kick + 1.6 + 1.2 * beat);
        this.star = Math.min(1, 0.55 + 0.45 * beat);
        this.hueStepTarget += 1;
      }
    }
    const speed = WAVE_SPEED * (0.6 + 0.8 * motion);
    for (let i = 0; i < MEGA_WAVES; i++) {
      if (this.waveA[i]! <= 0) continue;
      this.waveR[i] = this.waveR[i]! + speed * dt;
      this.waveA[i] = this.waveA[i]! * Math.exp(-WAVE_FADE * dt);
      if (this.waveA[i]! < 0.02) this.waveA[i] = 0;
    }

    // 光の筋の回転: 基本の速さ (中音と Motion で速く) + 拍のキック (なめらかに戻る)
    this.rotSpeed = 0.18 + 0.5 * motion + 0.8 * mid + this.kick;
    this.rot += this.rotSpeed * dt;
    // 虹色の流れ: 時間でゆっくり + 拍ごとに少しずつ進む
    this.hueDrift += dt * (0.01 + 0.09 * rainbow);
    this.hueStep += (this.hueStepTarget - this.hueStep) * (1 - Math.exp(-dt * 3));

    for (let i = 0; i < MEGA_BARS; i++) this.eq[i] = follow(this.eq[i]!, fin(this.shapedBands[i], 0), dt, 30, 7);

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
  inspect(): SpeakerMegaInspection {
    const u = this.material.uniforms;
    const center = u.center!.value as THREE.Vector2;
    let waveCount = 0;
    for (let i = 0; i < MEGA_WAVES; i++) if (this.waveA[i]! > 0) waveCount++;
    return {
      cap: this.cap,
      ringEx: Array.from(u.ringEx!.value as Float32Array),
      rot: this.rot,
      rotSpeed: this.rotSpeed,
      rayLen: this.rayLen,
      star: this.star,
      halo: this.halo,
      hue: u.hue!.value as number,
      waveCount,
      eq: Array.from(this.eq),
      radius: u.radius!.value as number,
      center: { x: center.x, y: center.y },
      aspect: this.aspect,
    };
  }

  private writeUniforms(params: CommonParams & Record<string, unknown>, intensity: number): void {
    const u = this.material.uniforms;
    const size = Math.min(1.6, Math.max(0.4, fin(params.size, 1)));
    const radius = BASE_RADIUS * size;
    // 位置: まわりの棒の先 (半径の約 1.9 倍) が画面に収まる範囲で動かす
    const roomX = Math.max(0, this.aspect - radius * 1.9);
    const roomY = Math.max(0, 1 - radius * 1.9);
    const ox = Math.min(1, Math.max(-1, fin(params.offsetX, 0)));
    const oy = Math.min(1, Math.max(-1, fin(params.offsetY, 0)));
    (u.center!.value as THREE.Vector2).set(ox * roomX, oy * roomY);
    u.radius!.value = radius;
    u.cap!.value = this.cap;
    u.halo!.value = this.halo;
    u.star!.value = this.star;
    u.rot!.value = this.rot;
    u.hue!.value = (this.hueBase + this.hueDrift + this.hueStep * 0.045) % 1;
    u.rayLen!.value = this.rayLen;
    u.rayAmount!.value = unit(params.rays, 0.8);
    u.eqAmount!.value = unit(params.equalizer, 0.9);
    const ringEx = u.ringEx!.value as Float32Array;
    for (let k = 0; k < MEGA_RINGS; k++) ringEx[k] = this.history[Math.min(HISTORY_LENGTH - 1, k * RING_DELAY_STEPS)]!;
    (u.waveR!.value as Float32Array).set(this.waveR);
    (u.waveA!.value as Float32Array).set(this.waveA);
    (u.eq!.value as Float32Array).set(this.eq);
    u.intensity!.value = 0.5 + 0.7 * intensity;
  }
}
