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
