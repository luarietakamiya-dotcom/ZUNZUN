import type { RhythmMeter } from '../types';
import { normalizeBars } from './grid';
import { formatGrouping, parseGrouping } from './grouping';

/**
 * 拍子の区間の編集 (Lyrics タブの「リズム（変拍子）」欄)。どれも新しい配列を返す (取り消しの履歴に積めるように)。
 * 区間は bar の昇順に並べ、同じ小節には 1 つだけ置く。1 小節目 (bar 0) の区間は常に残す。
 */

/** bar 番目の小節から pattern の拍子にする (同じ小節の指定は置き換える)。読めない拍子なら null */
export function setMeter(meters: readonly RhythmMeter[], bar: number, pattern: string): RhythmMeter[] | null {
  const groups = parseGrouping(pattern);
  if (!groups || !Number.isInteger(bar) || bar < 0) return null;
  const next = meters.filter((m) => m.bar !== bar);
  next.push({ bar, pattern: formatGrouping(groups) });
  if (!next.some((m) => m.bar === 0)) next.push({ bar: 0, pattern: '4' });
  return next.sort((a, b) => a.bar - b.bar);
}

/** bar 番目の小節からの指定を消す (1 小節目の指定は消さない) */
export function removeMeter(meters: readonly RhythmMeter[], bar: number): RhythmMeter[] {
  if (bar === 0) return [...meters];
  return meters.filter((m) => m.bar !== bar);
}

/** 時刻 t を含む小節の番号 (0 始まり)。最初の小節の頭より前なら -1 */
export function barIndexAt(bars: readonly number[], t: number): number {
  const b = normalizeBars(bars);
  let lo = 0;
  let hi = b.length - 1;
  let i = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (b[m]! <= t) {
      i = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return i;
}

/** 拍子の説明 (画面用): "2+2+3" → "7 等分を 2・2・3 にまとめる"、"4" → "4 等分" */
export function describeGrouping(pattern: string): string | null {
  const g = parseGrouping(pattern);
  if (!g) return null;
  const units = g.reduce((a, b) => a + b, 0);
  return g.every((x) => x === 1) ? `${units} 等分` : `${units} 等分を ${g.join('・')} にまとめる`;
}

/** 小節の頭どうしの最短間隔 (秒)。grid.ts の MIN_BAR と同じ (これより短い小節は捨てられる) */
const MIN_BAR_GAP = 0.2;

/**
 * index 番目の小節の頭を t へ動かす (タイムラインのドラッグ)。前後の小節の頭を越えないよう、間を MIN_BAR_GAP 秒あける。
 * 動かせなければ (番号が範囲外・t が数でない) 元の並びの複製を返す。
 */
export function moveBarHead(bars: readonly number[], index: number, t: number): number[] {
  const b = normalizeBars(bars);
  if (!Number.isInteger(index) || index < 0 || index >= b.length || !Number.isFinite(t)) return b;
  const lo = index > 0 ? b[index - 1]! + MIN_BAR_GAP : 0;
  const hi = index + 1 < b.length ? b[index + 1]! - MIN_BAR_GAP : Infinity;
  if (lo > hi) return b;
  b[index] = Math.round(Math.min(hi, Math.max(lo, t)) * 10000) / 10000;
  return b;
}
