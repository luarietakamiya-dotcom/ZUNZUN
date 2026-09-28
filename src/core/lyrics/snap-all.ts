import type { OnsetCandidate } from './candidates';
import { nearest, type SnapKind } from './snap';

/**
 * 叩き終えたあとに「吸着」ボタンでまとめて吸着させる。1 行ずつ吸着するより精密にできる:
 *
 * 1. 叩くタイミングのくせ (全体的に遅め/早め) を見積もる: 各行の近く (±biasRange) で「近さ × 強さ」が最大の
 *    歌い出し候補とのずれの中央値。3 行以上そろったときだけ使い、±maxBias に収める
 *    (単に最も近い候補だと、本当の出だしのすぐ隣にある弱い候補 (伴奏) を拾ってしまう)
 * 2. 各行を「叩いた時刻 + くせ」を中心に ±window の中から、近さ (ガウス) × 候補の強さ が最大の候補へ寄せる。
 *    候補が無ければビート、それも無ければ「叩いた時刻 + くせ」
 * 3. 行の順番は崩さない: 前の行より minGap 以上あと、次の行の中心より前の候補だけを選ぶ
 *
 * lineTimes に無い行 (LRC のタグや見積もりの行) は動かさない。結果は新しいオブジェクトで返す (取り消せるように)。
 */

export interface SnapAllOptions {
  /** 各行で候補を探す範囲 (± 秒) */
  windowSec?: number;
  /** くせを見積もるときに候補を探す範囲 (± 秒) */
  biasRange?: number;
  /** くせとして補正する上限 (± 秒) */
  maxBias?: number;
  /** 行どうしの最短間隔 (秒) */
  minGap?: number;
  /** くせを見積もるのに必要な行数 */
  minLinesForBias?: number;
}

export interface LineSnap {
  line: number;
  from: number;
  to: number;
  kind: SnapKind;
}

export interface SnapAllResult {
  lineTimes: Record<string, number>;
  /** 見積もった叩くタイミングのくせ (秒)。正なら「早く叩いていた」ので後ろへ、負なら「遅く叩いていた」ので前へ寄せた */
  bias: number;
  lines: LineSnap[];
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/** 昇順の候補から、t 以上の最初の添字 */
function lowerBound(c: readonly OnsetCandidate[], t: number): number {
  let lo = 0;
  let hi = c.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const round = (t: number): number => Math.round(t * 10000) / 10000;

export function snapAllLines(
  lineTimes: Readonly<Record<string, number>>,
  onsets: readonly OnsetCandidate[],
  beats: readonly number[],
  opts: SnapAllOptions = {},
): SnapAllResult {
  const w = Math.max(0.001, opts.windowSec ?? 0.15);
  const biasRange = opts.biasRange ?? 0.3;
  const maxBias = opts.maxBias ?? 0.25;
  const minGap = opts.minGap ?? 0.05;
  const minLines = opts.minLinesForBias ?? 3;

  const cands = onsets.filter((c) => Number.isFinite(c.t) && Number.isFinite(c.strength)).sort((a, b) => a.t - b.t);
  const sortedBeats = beats.filter((b) => Number.isFinite(b)).slice().sort((a, b) => a - b);
  const entries = Object.entries(lineTimes)
    .filter(([k, v]) => /^\d+$/.test(k) && Number.isFinite(v))
    .map(([k, v]) => ({ line: +k, t: v }))
    .sort((a, b) => a.line - b.line);

  /** [lo, hi] の中で「center からの近さ (ガウス) × 強さ」が最大の候補 */
  const bestCandidate = (center: number, lo: number, hi: number, sigma: number): OnsetCandidate | null => {
    let best: OnsetCandidate | null = null;
    let bestScore = -1;
    for (let k = lowerBound(cands, lo); k < cands.length && cands[k]!.t <= hi; k++) {
      const d = cands[k]!.t - center;
      const score = cands[k]!.strength * Math.exp(-(d * d) / (2 * sigma * sigma));
      if (score > bestScore) {
        bestScore = score;
        best = cands[k]!;
      }
    }
    return best;
  };

  // 1. 叩くタイミングのくせ
  const deltas: number[] = [];
  for (const e of entries) {
    const c = bestCandidate(e.t, e.t - biasRange, e.t + biasRange, biasRange / 2);
    if (c) deltas.push(c.t - e.t);
  }
  const bias = deltas.length >= minLines ? Math.max(-maxBias, Math.min(maxBias, median(deltas))) : 0;

  // 2, 3. 行ごとに寄せる (順番を崩さない)
  const out: Record<string, number> = { ...lineTimes };
  const lines: LineSnap[] = [];
  const sigma = w / 2;
  let prevTo = -Infinity;
  entries.forEach((e, idx) => {
    const center = e.t + bias;
    const next = entries[idx + 1];
    const lo = Math.max(center - w, prevTo + minGap);
    const hi = Math.min(center + w, next ? next.t + bias : Infinity);
    let to = center;
    let kind: SnapKind = 'none';
    const c = bestCandidate(center, lo, hi, sigma);
    if (c) {
      to = c.t;
      kind = 'candidate';
    }
    if (kind === 'none') {
      const b = nearest(sortedBeats, center);
      if (b != null && b >= lo && b <= hi) {
        to = b;
        kind = 'beat';
      }
    }
    if (kind === 'none') to = Math.max(center, prevTo + minGap);
    to = Math.max(0, round(to));
    out[String(e.line)] = to;
    lines.push({ line: e.line, from: e.t, to, kind });
    prevTo = to;
  });
  return { lineTimes: out, bias: round(bias), lines };
}
