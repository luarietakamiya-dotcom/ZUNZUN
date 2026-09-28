/**
 * 半自動タップ同期の状態 (UI 非依存)。
 *
 * 操作は 852wa/JIZURA (MIT License, © 2026 hakoniwa) src/12_ui.js の startTap / tapNow / tapBack / stopTap と同じ:
 * - 好きな行から始められる。その行の少し前 (最大 2.5 秒前、前の行より前にはしない) から再生する
 * - 叩くと今の行の開始時刻を決めて次の行へ。後ろの行に前回の時刻が残っていて、今叩いた時刻 + 0.2 秒より前なら消す
 *   (順番が逆転しないように)。間奏の行も 1 行として叩く
 * - 1 つ戻る (Backspace) と、直前に叩いた行の時刻を叩く前の値に戻し、その行からやり直す
 * - 中断 (Esc) しても、それまでに叩いた時刻は残る
 * ZUNZUN では、叩いた時刻を吸着 (snap.ts) してから記録する点だけが違う (吸着は呼び出し側で済ませて渡す)。
 * lineTimes は不変に扱い、操作のたびに新しいオブジェクトを返す (History に積めるように)。
 */

export type LineTimeMap = Readonly<Record<string, number>>;

/** 後ろの行の古い時刻を消す範囲 (秒)。JIZURA と同じ値 */
export const TAP_CONFLICT_MARGIN = 0.2;
/** 途中の行から始めるとき、その行の何秒前から再生するか。JIZURA と同じ値 */
export const TAP_PREROLL = 2.5;

/** from 行からタップを始めるときの再生開始位置。starts は computeLineTimes の starts。 */
export function tapStartTime(starts: readonly number[], from: number): number {
  if (from <= 0 || from >= starts.length) return 0;
  const prev = starts[from - 1]!;
  const cur = starts[from]!;
  return Math.max(0, prev + 0.01, cur - TAP_PREROLL);
}

/** i 行目の開始を t にし、後ろの行で t + 0.2 秒より前にある時刻を消した新しい lineTimes を返す。 */
export function setLineStart(lineTimes: LineTimeMap, i: number, t: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(lineTimes)) {
    if (+k > i && v <= t + TAP_CONFLICT_MARGIN) continue;
    out[k] = v;
  }
  out[String(i)] = t;
  return out;
}

interface TapStep {
  line: number;
  had: number | null;
}

export class TapSession {
  private cursor: number;
  private readonly done: TapStep[] = [];
  private finished = false;

  constructor(
    readonly lineCount: number,
    from = 0,
  ) {
    this.cursor = Math.min(Math.max(0, Math.floor(Number.isFinite(from) ? from : 0)), Math.max(0, lineCount - 1));
    this.finished = lineCount <= 0;
  }

  /** 次に叩く行。すべて叩き終えたら lineCount。 */
  get line(): number {
    return this.cursor;
  }

  get isActive(): boolean {
    return !this.finished;
  }

  get canBack(): boolean {
    return this.done.length > 0;
  }

  /** 今の行の開始を t (吸着済み) に決めて次の行へ進む。最後の行を叩いたら終わる。 */
  tap(lineTimes: LineTimeMap, t: number): Record<string, number> {
    if (this.finished || !Number.isFinite(t)) return { ...lineTimes };
    const had = lineTimes[String(this.cursor)];
    this.done.push({ line: this.cursor, had: typeof had === 'number' ? had : null });
    const next = setLineStart(lineTimes, this.cursor, Math.max(0, t));
    this.cursor++;
    if (this.cursor >= this.lineCount) this.finished = true;
    return next;
  }

  /**
   * 直前の 1 回を取り消し、その行を叩き直せるようにする。取り消せなければ null。
   * JIZURA と同じく、叩いたときに消した後ろの行の時刻までは戻さない (取り消しの履歴 = History で戻す)。
   */
  back(lineTimes: LineTimeMap): Record<string, number> | null {
    const step = this.done.pop();
    if (!step) return null;
    const out: Record<string, number> = { ...lineTimes };
    if (step.had != null) out[String(step.line)] = step.had;
    else delete out[String(step.line)];
    this.cursor = step.line;
    this.finished = false;
    return out;
  }

  /** 中断する。叩いた時刻はそのまま残る。 */
  stop(): void {
    this.finished = true;
  }
}
