/**
 * タップ・ドラッグした時刻の吸着 (docs/ARCHITECTURE.md「歌詞同期の方針」):
 * ±window 以内に歌い出し候補があればそこへ、無ければビートへ、それも無ければそのままの時刻を使う。
 * Alt/Option を押している間など、吸着させたくないときは呼び出し側が enabled=false を渡す。
 */

export type SnapKind = 'candidate' | 'beat' | 'none';

export interface SnapTargets {
  /** 歌い出し候補の時刻 (秒、昇順) */
  candidates: readonly number[];
  /** ビートの時刻 (秒、昇順) */
  beats: readonly number[];
}

export interface SnapResult {
  t: number;
  kind: SnapKind;
}

/** 昇順の配列から t に最も近い値。配列が空なら null。 */
export function nearest(sorted: readonly number[], t: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  const a = sorted[lo]!;
  const b = lo > 0 ? sorted[lo - 1]! : a;
  return Math.abs(b - t) <= Math.abs(a - t) ? b : a;
}

export function snapTime(t: number, targets: SnapTargets, windowSec: number, enabled = true): SnapResult {
  if (!Number.isFinite(t)) return { t: 0, kind: 'none' };
  if (!enabled || !(windowSec > 0)) return { t, kind: 'none' };
  const c = nearest(targets.candidates, t);
  if (c != null && Math.abs(c - t) <= windowSec) return { t: c, kind: 'candidate' };
  const b = nearest(targets.beats, t);
  if (b != null && Math.abs(b - t) <= windowSec) return { t: b, kind: 'beat' };
  return { t, kind: 'none' };
}
