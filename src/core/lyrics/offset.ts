import type { OnsetCandidate } from './candidates';

/**
 * 読み込んだ LRC/SRT の時刻が全体的にずれているときの、全体オフセットの推定
 * (docs/ARCHITECTURE.md「既存の LRC/SRT の自動オフセット補正」)。
 *
 * 行の開始時刻の列と、歌い出し候補 (強さつき) の列の相互相関を取り、最も重なるずらし量を探す。
 * 行の開始をずらした位置の近くに強い候補があるほど点が高い (ガウス窓)。結果は提案として返すだけで、
 * 適用するかどうかはユーザーが決める。
 */

export interface OffsetOptions {
  /** 探す範囲 (± 秒) */
  range?: number;
  /** 探す刻み (秒) */
  step?: number;
  /** 行の開始と候補の「近さ」の幅 (秒) */
  sigma?: number;
  /** 一致とみなす距離 (秒)。matched の計算に使う */
  matchWindow?: number;
}

export interface OffsetEstimate {
  /** 行の時刻に足すと最もよく合う量 (秒) */
  offset: number;
  /** その時の点 */
  score: number;
  /** ずらさない場合 (offset = 0) の点 */
  zeroScore: number;
  /** ずらしたあと、近くに候補がある行の割合 (0..1) */
  matched: number;
  /** ずらさない場合の同じ割合 */
  zeroMatched: number;
}

function sortedByTime(cands: readonly OnsetCandidate[]): OnsetCandidate[] {
  return cands.filter((c) => Number.isFinite(c.t) && Number.isFinite(c.strength)).sort((a, b) => a.t - b.t);
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

function scoreAt(starts: readonly number[], c: readonly OnsetCandidate[], offset: number, sigma: number): number {
  const reach = sigma * 4;
  const inv = 1 / (2 * sigma * sigma);
  let total = 0;
  for (const s0 of starts) {
    const s = s0 + offset;
    let best = 0;
    for (let k = lowerBound(c, s - reach); k < c.length && c[k]!.t <= s + reach; k++) {
      const dt = c[k]!.t - s;
      const v = c[k]!.strength * Math.exp(-dt * dt * inv);
      if (v > best) best = v;
    }
    total += best;
  }
  return total;
}

function matchedAt(starts: readonly number[], c: readonly OnsetCandidate[], offset: number, win: number): number {
  if (starts.length === 0) return 0;
  let hit = 0;
  for (const s0 of starts) {
    const s = s0 + offset;
    const k = lowerBound(c, s - win);
    if (k < c.length && c[k]!.t <= s + win) hit++;
  }
  return hit / starts.length;
}

export function estimateOffset(
  lineStarts: readonly number[],
  candidates: readonly OnsetCandidate[],
  opts: OffsetOptions = {},
): OffsetEstimate | null {
  const starts = lineStarts.filter((t) => Number.isFinite(t));
  const c = sortedByTime(candidates);
  if (starts.length === 0 || c.length === 0) return null;
  const range = Math.max(0, opts.range ?? 5);
  const step = Math.max(0.001, opts.step ?? 0.01);
  const sigma = Math.max(0.005, opts.sigma ?? 0.06);
  const win = opts.matchWindow ?? 0.1;

  const steps = Math.round(range / step);
  let bestOffset = 0;
  let bestScore = -1;
  for (let i = -steps; i <= steps; i++) {
    const o = i * step;
    const sc = scoreAt(starts, c, o, sigma);
    // 同点なら 0 に近い方を選ぶ (不要にずらさない)
    if (sc > bestScore + 1e-9 || (Math.abs(sc - bestScore) <= 1e-9 && Math.abs(o) < Math.abs(bestOffset))) {
      bestScore = sc;
      bestOffset = o;
    }
  }
  const offset = Math.round(bestOffset * 1000) / 1000;
  return {
    offset,
    score: bestScore,
    zeroScore: scoreAt(starts, c, 0, sigma),
    matched: matchedAt(starts, c, offset, win),
    zeroMatched: matchedAt(starts, c, 0, win),
  };
}
