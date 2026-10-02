import type { SectionKind } from '../lyrics/sections';

/**
 * 背景のスライドショーの画像を、映している間にゆっくり動かす (ケン・バーンズ効果)。計算だけ (DOM・WebGL を使わない)。
 * 2026-10-02 ユーザー「スライドもただ写すだけでなく、微妙に動かしたりしたい」→ 区切りで強さを変える・拍で寄るも「いれる！
 * オンオフや強度などの設定も」。
 *
 * - 画像を少し拡大し (amount で 1.03〜1.12 倍)、映している間に 寄る / 引く / 左へ / 右へ / 斜め のどれかで動かす。
 *   どの動きかは切り替えの順番で決める (乱数は使わない。同じプロジェクトなら書き出すたびに同じ動き)
 * - 動きは、その画像が出てから次の画像に替わり終わるまで (じわっと替わる間も、前の画像は動き続ける) をなめらかに進む
 * - 区切りで強さを変える (bySection): サビは大きく、イントロ・アウトロはゆっくり (区切りの種類ごとの倍率 SECTION_GAIN)
 * - 拍で寄る (beatPush): 拍の直後にほんの少し (最大 2%) 寄って、すぐ戻る。明るさは変えない (光過敏への配慮)
 * 位置は「動かせる幅」に対する割合 (-1..1) で返す。どれだけ動かせるかは、画面に収めたときにはみ出した分で決まる (background.ts)。
 */

export interface SlideMotionSettings {
  /** 動かすか */
  enabled: boolean;
  /** 動きの大きさ (0..1) */
  amount: number;
  /** 区切りで強さを変えるか (サビは大きく、イントロ・アウトロはゆっくり) */
  bySection: boolean;
  /** 拍で寄る強さ (0..1。0 で寄らない) */
  beatPush: number;
}

/** 新しく作るスライドショーの既定 (前のプロジェクトで motion が無いものは、動かさない = 今までどおり) */
export const defaultSlideMotion = (): SlideMotionSettings => ({ enabled: true, amount: 0.5, bySection: true, beatPush: 0.3 });

export interface SlideTransform {
  /** 拡大 (1 = そのまま) */
  zoom: number;
  /** 動かせる幅に対する位置 (-1..1)。x は右が正、y は上が正 */
  x: number;
  y: number;
}

export const STILL: SlideTransform = { zoom: 1, x: 0, y: 0 };

/** 区切りの種類ごとの強さの倍率 */
export const SECTION_GAIN: Record<SectionKind, number> = {
  intro: 0.6,
  verse: 1,
  prechorus: 1.2,
  chorus: 1.5,
  bridge: 0.8,
  interlude: 0.8,
  outro: 0.6,
  other: 1,
};

/** 動きの種類。z = 拡大の割合 (0 = 少しだけ、1 = いちばん)、x / y = 位置 (始め → 終わり) */
interface Pattern {
  z: [number, number];
  x: [number, number];
  y: [number, number];
}
const PATTERNS: readonly Pattern[] = [
  { z: [0.2, 1], x: [0, 0], y: [0, 0] }, // 寄る
  { z: [1, 0.2], x: [0, 0], y: [0, 0] }, // 引く
  { z: [1, 1], x: [-0.9, 0.9], y: [0, 0] }, // 右へ流れる (見ている所が右へ)
  { z: [1, 1], x: [0.9, -0.9], y: [0, 0] }, // 左へ流れる
  { z: [0.5, 1], x: [-0.6, 0.6], y: [0.6, -0.6] }, // 寄りながら右下へ
  { z: [1, 0.5], x: [0.6, -0.6], y: [-0.5, 0.5] }, // 引きながら左上へ
];

/** amount = 1 のときの、いちばんの拡大 (12%)。0 でも少しは動く (3%) */
const ZOOM_MIN = 0.03;
const ZOOM_RANGE = 0.09;
/** 拍で寄る大きさ (beatPush = 1 で 2%) と、戻る速さ (秒) */
const BEAT_ZOOM = 0.02;
const BEAT_DECAY = 0.12;

const unit = (v: number, d: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface SlideMotionInput {
  /** 何回目の切り替えか (切り替え表の何番目。動きの種類を決める) */
  cue: number;
  /** その画像が出た時刻と、次の画像に替わる時刻 (最後の画像なら曲の終わり) */
  start: number;
  end: number;
  /** じわっと替わる長さ (秒。パッと替わるなら 0)。前の画像はこの間も動き続ける */
  fade: number;
  /** その画像が出る区切りの種類 */
  kind: SectionKind | undefined;
  t: number;
}

/** 映している画像の、時刻 t の拡大と位置 */
export function slideTransform(m: SlideMotionSettings | undefined, input: SlideMotionInput, beats: readonly number[] = []): SlideTransform {
  if (!m?.enabled) return STILL;
  const amount = unit(m.amount, 0.5);
  const gain = m.bySection ? (SECTION_GAIN[input.kind ?? 'other'] ?? 1) : 1;
  const zmax = Math.min(0.2, (ZOOM_MIN + ZOOM_RANGE * amount) * gain);
  const p = PATTERNS[((input.cue % PATTERNS.length) + PATTERNS.length) % PATTERNS.length]!;
  const len = Math.max(0.5, input.end - input.start + Math.max(0, input.fade));
  const raw = Number.isFinite(input.t) ? (input.t - input.start) / len : 0;
  // なめらかに (始めと終わりはゆっくり)
  const e = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, raw)));
  let zoom = 1 + zmax * lerp(p.z[0], p.z[1], e);
  zoom *= 1 + unit(m.beatPush, 0) * BEAT_ZOOM * beatEnvelope(beats, input.t);
  return { zoom, x: lerp(p.x[0], p.x[1], e), y: lerp(p.y[0], p.y[1], e) };
}

/** 拍の直後に 1、すぐに 0 へ戻る (beats は小さい順) */
export function beatEnvelope(beats: readonly number[], t: number): number {
  if (!beats.length || !Number.isFinite(t)) return 0;
  // t 以下でいちばん後ろの拍 (二分探索)
  let lo = 0;
  let hi = beats.length - 1;
  if (beats[0]! > t) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  const dt = t - beats[lo]!;
  return dt < 0.6 ? Math.exp(-dt / BEAT_DECAY) : 0;
}
