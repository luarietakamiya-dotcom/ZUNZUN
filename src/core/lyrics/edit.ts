import type { LyricsTiming } from '../types';
import { MIN_LINE_DURATION } from './timing';

/**
 * タイムライン編集 (L4) の書き換え規則。どれも UI 非依存の純粋関数で、新しい TimingSnapshot を返す (履歴に積めるように)。
 *
 * - 隣の行との制約は「同期済み」(タップ・入力・LRC のタグで時刻が決まっている) の行とだけ取る。
 *   未同期の行の仮の時刻 (文字数からの見積もり) はどこにあるか当てにならないので、動きを縛らない
 * - 開始は、前の同期済みの行の開始 + MIN_GAP より後、次の同期済みの行の開始 − MIN_GAP より前
 * - 終了は、開始 + MIN_LINE_DURATION 以上、次の行の開始以下 (最後の行は上限なし)。次の行が未同期でも、その仮の開始より
 *   後ろの終了は computeLineTimes が切り詰める (JIZURA のカット割りは行が重ならない前提) ので、ここでも同じ上限にする
 * - LRC のタグで決まっていた行も、動かしたら手動の時刻 (lineTimes) になる
 */

export type TimingSnapshot = Pick<LyricsTiming, 'lineTimes' | 'lineEnds'>;

/** 編集の制約に使う、今の各行の時刻 (computeLineTimes の結果) と、同期済みかどうか */
export interface EditContext {
  starts: readonly number[];
  ends: readonly number[];
  /** 同期済み (開始の由来が見積もりでない) か */
  synced: readonly boolean[];
}

/** 隣り合う行の開始どうしの最短間隔 (秒) */
export const MIN_GAP = 0.05;

const round = (t: number): number => Math.round(t * 10000) / 10000;
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

function prevSyncedStart(ctx: EditContext, i: number): number | null {
  for (let k = i - 1; k >= 0; k--) if (ctx.synced[k]) return ctx.starts[k]!;
  return null;
}

function nextSyncedStart(ctx: EditContext, i: number): number | null {
  for (let k = i + 1; k < ctx.starts.length; k++) if (ctx.synced[k]) return ctx.starts[k]!;
  return null;
}

/** i 行目の開始を動かせる範囲 */
export function startBounds(ctx: EditContext, timing: TimingSnapshot, i: number): [number, number] {
  const prev = prevSyncedStart(ctx, i);
  const next = nextSyncedStart(ctx, i);
  let lo = prev != null ? prev + MIN_GAP : 0;
  let hi = next != null ? next - MIN_GAP : Infinity;
  const manualEnd = timing.lineEnds[String(i)];
  if (typeof manualEnd === 'number') hi = Math.min(hi, manualEnd - MIN_LINE_DURATION);
  if (hi < lo) hi = lo;
  lo = Math.max(0, lo);
  return [lo, Math.max(lo, hi)];
}

/** i 行目の開始を t にする (範囲に収める)。 */
export function moveLineStart(ctx: EditContext, timing: TimingSnapshot, i: number, t: number): TimingSnapshot {
  if (!Number.isFinite(t) || i < 0 || i >= ctx.starts.length) return timing;
  const [lo, hi] = startBounds(ctx, timing, i);
  return { lineTimes: { ...timing.lineTimes, [String(i)]: round(clamp(t, lo, hi)) }, lineEnds: timing.lineEnds };
}

/** i 行目の終了を t にする (開始 + 最短の長さ 〜 次の行の開始)。 */
export function moveLineEnd(ctx: EditContext, timing: TimingSnapshot, i: number, t: number): TimingSnapshot {
  if (!Number.isFinite(t) || i < 0 || i >= ctx.starts.length) return timing;
  const start = ctx.starts[i]!;
  const hi = i < ctx.starts.length - 1 ? ctx.starts[i + 1]! : Infinity;
  const end = clamp(t, start + MIN_LINE_DURATION, Math.max(start + MIN_LINE_DURATION, hi));
  // 開始も未同期なら、終了だけ決めても意味が薄いので、開始も今の位置で手動にする
  const lineTimes = ctx.synced[i] ? timing.lineTimes : { ...timing.lineTimes, [String(i)]: round(start) };
  return { lineTimes, lineEnds: { ...timing.lineEnds, [String(i)]: round(end) } };
}

/** i 行目をまるごと dt 秒動かす (開始は範囲に収め、手動の終了があれば同じだけ動かす)。 */
export function moveLine(ctx: EditContext, timing: TimingSnapshot, i: number, dt: number): TimingSnapshot {
  if (!Number.isFinite(dt) || i < 0 || i >= ctx.starts.length) return timing;
  const start = ctx.starts[i]!;
  const manualEnd = timing.lineEnds[String(i)];
  // 終了も一緒に動くので、開始の上限は「終了による制約」を外して計算する
  const loose: TimingSnapshot = { lineTimes: timing.lineTimes, lineEnds: { ...timing.lineEnds } };
  delete (loose.lineEnds as Record<string, number>)[String(i)];
  const [lo, hi0] = startBounds(ctx, loose, i);
  // 手動の終了がある場合、終了が次の同期済みの行を越えないようにする
  const next = nextSyncedStart(ctx, i);
  const hi = typeof manualEnd === 'number' && next != null ? Math.min(hi0, next - (manualEnd - start)) : hi0;
  const newStart = round(clamp(start + dt, lo, Math.max(lo, hi)));
  const moved = newStart - start;
  const lineEnds = typeof manualEnd === 'number' ? { ...timing.lineEnds, [String(i)]: round(manualEnd + moved) } : timing.lineEnds;
  return { lineTimes: { ...timing.lineTimes, [String(i)]: newStart }, lineEnds };
}

/**
 * 複数の行をまとめて dt 秒ずらす (全体のオフセット)。対象の行は今の開始 + dt を手動の時刻にし、手動の終了も同じだけずらす。
 * 0 秒より前にはしない。対象どうしの順番は変わらない。
 */
export function shiftLines(ctx: EditContext, timing: TimingSnapshot, indices: readonly number[], dt: number): TimingSnapshot {
  if (!Number.isFinite(dt)) return timing;
  const lineTimes: Record<string, number> = { ...timing.lineTimes };
  const lineEnds: Record<string, number> = { ...timing.lineEnds };
  for (const i of indices) {
    if (i < 0 || i >= ctx.starts.length) continue;
    const s = Math.max(0, round(ctx.starts[i]! + dt));
    lineTimes[String(i)] = s;
    const e = timing.lineEnds[String(i)];
    if (typeof e === 'number') lineEnds[String(i)] = Math.max(round(s + MIN_LINE_DURATION), round(e + dt));
  }
  return { lineTimes, lineEnds };
}
