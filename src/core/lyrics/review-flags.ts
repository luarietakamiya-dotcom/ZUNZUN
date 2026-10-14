/**
 * 要確認の印（LyricSync の結果で自信の低い行）を、時刻の表（lineTimes と lineEnds の組）に結びつけて覚える。
 * プロジェクトには保存しない（姫の決定 2026-10-14）。Codex レビュー（2026-10-14）の P2 への対応:
 *  - 取り消し・やり直しで表が戻ると、その表の印も戻る。
 *  - プロジェクトを開くなど、別の経路で表が替わると印は無くなる（同じ本文の別プロジェクトにも残らない）。
 *  - 手で直すのが成功して、その行の時刻が変わったときだけ、その行の印が消える。
 */
export interface TimingTable { lineTimes: Record<string, number>; lineEnds: Record<string, number> }

export class ReviewFlags {
  private readonly map = new WeakMap<object, WeakMap<object, ReadonlySet<number>>>();

  get(t: TimingTable): ReadonlySet<number> | undefined {
    return this.map.get(t.lineTimes)?.get(t.lineEnds);
  }

  set(t: TimingTable, flags: ReadonlySet<number>): void {
    let inner = this.map.get(t.lineTimes);
    if (!inner) { inner = new WeakMap(); this.map.set(t.lineTimes, inner); }
    inner.set(t.lineEnds, flags);
  }

  /** prev から next に変わるとき、next の表に引き継ぐ印（時刻が変わった行の印は消える。review を渡すとそれに置き換え） */
  carry(prev: TimingTable, next: TimingTable, review?: ReadonlySet<number>): void {
    const before = this.get(prev);
    const same = (i: number) => prev.lineTimes[String(i)] === next.lineTimes[String(i)] && prev.lineEnds[String(i)] === next.lineEnds[String(i)];
    const flags = review ?? (before ? new Set([...before].filter(same)) : null);
    if (flags && flags.size) this.set(next, flags);
  }

  /** タイムラインに渡す形（行ごとの true / false）。印が無ければ undefined */
  rows(t: TimingTable, n: number): boolean[] | undefined {
    const f = this.get(t);
    return f && f.size ? Array.from({ length: n }, (_, i) => f.has(i)) : undefined;
  }
}
