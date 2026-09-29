import type { RhythmMeter } from '../types';
import { normalizeBars } from './grid';

/**
 * 小節の頭の編集: タップ、同じ長さの小節で埋める。どれも新しい配列を返す (取り消しの履歴に積めるように)。
 */

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/** 最後の数小節の長さの中央値 (小節の長さの目安)。2 小節分以上の頭が無ければ null */
export function barLengthEstimate(bars: readonly number[], sample = 4): number | null {
  const b = normalizeBars(bars);
  if (b.length < 2) return null;
  const lens: number[] = [];
  for (let i = Math.max(1, b.length - sample); i < b.length; i++) lens.push(b[i]! - b[i - 1]!);
  return median(lens);
}

/** 最後の小節から曲の終わりまで、同じ長さの小節で埋める (「残りを同じ長さで埋める」) */
export function fillToEnd(bars: readonly number[], duration: number, sample = 4): number[] {
  const b = normalizeBars(bars);
  const len = barLengthEstimate(b, sample);
  if (len == null || !(len > 0) || !(duration > 0)) return b;
  const out = [...b];
  let t = out[out.length - 1]! + len;
  // 曲の終わりの手前で、半小節に満たない端数は作らない
  while (t + len * 0.5 <= duration && out.length < 10_000) {
    out.push(Math.round(t * 10000) / 10000);
    t += len;
  }
  return out;
}

/**
 * 最初の小節から曲の頭 (0 秒) まで、同じ長さの小節で埋める (「前を同じ長さで埋める」)。最初の数小節の長さの中央値を使う。
 * 足すのは丸ごとの小節だけで、曲の頭に残る端数 (弱起など) には小節を作らない (端数の小節を作ると、その中でまとまりが
 * 等分されて拍の位置が間違うため。叩いた時刻の誤差として 80ms か 1 割までは 0 秒に切り詰める)。前に小節を足すと小節の番号がずれるので、拍子の区間の番号も同じだけずらす
 * (1 小節目からの指定は 0 のまま = 足した小節にも同じ拍子が付く)。
 */
export function fillToStart(bars: readonly number[], meters: readonly RhythmMeter[], sample = 4): { bars: number[]; meters: RhythmMeter[]; added: number } {
  const b = normalizeBars(bars);
  const len = b.length >= 2 ? median(b.slice(1, sample + 1).map((t, i) => t - b[i]!)) : null;
  if (len == null || !(len > 0)) return { bars: b, meters: meters.map((m) => ({ ...m })), added: 0 };
  const head: number[] = [];
  let t = b[0]! - len;
  const slack = Math.min(0.08, len * 0.1);
  while (t >= -slack && head.length < 10_000) {
    head.unshift(Math.max(0, Math.round(t * 10000) / 10000));
    t -= len;
  }
  const added = head.length;
  return { bars: [...head, ...b], meters: meters.map((m) => ({ ...m, bar: m.bar === 0 ? 0 : m.bar + added })), added };
}

/**
 * 叩いた小節の頭の間が、小節の長さのほぼ整数倍 (2 倍以上) なら、その間を同じ長さの小節で埋める
 * (4 小節ごとに叩いて、あとで間を埋める使い方)。長さの目安は、間の長さの中で最も短いまとまりの中央値。
 */
export function fillGaps(bars: readonly number[], length?: number): number[] {
  const b = normalizeBars(bars);
  if (b.length < 2) return b;
  const gaps = b.slice(1).map((t, i) => t - b[i]!);
  const shortest = Math.min(...gaps);
  const len = length ?? median(gaps.filter((g) => g < shortest * 1.3));
  if (!(len > 0)) return b;
  const out: number[] = [b[0]!];
  for (let i = 1; i < b.length; i++) {
    const gap = b[i]! - b[i - 1]!;
    const k = Math.round(gap / len);
    if (k >= 2 && Math.abs(gap - k * len) <= len * 0.25) {
      for (let j = 1; j < k; j++) out.push(Math.round((b[i - 1]! + (gap * j) / k) * 10000) / 10000);
    }
    out.push(b[i]!);
  }
  return out;
}

/** 叩いてから次を受け付けるまでの最短間隔 (秒)。連打の誤入力を防ぐ */
const MIN_TAP_GAP = 0.15;

/**
 * 小節の頭のタップ。歌詞のタップ (TapSession) と同じ操作感:
 * - 始めた時刻より後ろにあった小節の頭は、叩き直すので消す
 * - 叩くたびに小節の頭を 1 つ足す。Backspace (back) で、このタップで叩いたものを 1 つ取り消す
 */
export class BarTapSession {
  private current: number[];
  private readonly tapped: number[] = [];

  constructor(bars: readonly number[], startTime: number) {
    const from = Number.isFinite(startTime) ? startTime : 0;
    this.current = normalizeBars(bars).filter((t) => t < from - 0.05);
  }

  get bars(): number[] {
    return [...this.current];
  }

  get canBack(): boolean {
    return this.tapped.length > 0;
  }

  get tapCount(): number {
    return this.tapped.length;
  }

  /** 小節の頭を t (吸着済み) に足す。直前の頭に近すぎるときは無視する */
  tap(t: number): number[] {
    if (!Number.isFinite(t) || t < 0) return this.bars;
    const last = this.current[this.current.length - 1];
    if (last != null && t - last < MIN_TAP_GAP) return this.bars;
    const v = Math.round(t * 10000) / 10000;
    this.current.push(v);
    this.tapped.push(v);
    return this.bars;
  }

  /** このタップで叩いた最後の 1 つを取り消す。取り消せなければ null */
  back(): number[] | null {
    const v = this.tapped.pop();
    if (v === undefined) return null;
    const i = this.current.lastIndexOf(v);
    if (i >= 0) this.current.splice(i, 1);
    return this.bars;
  }
}
