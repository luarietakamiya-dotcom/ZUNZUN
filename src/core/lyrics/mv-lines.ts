/**
 * MV 用（字幕の帯を使うスタイル）の段取りの整え方。
 * 2026-10-08 姫「1 の歌詞が出た後に 2 の歌詞が出て、そのあとで 1+2 の歌詞が出るのはやめよう。最初から 1+2 の歌詞をじっくり見せよう！MV だし」。
 * エンジンは 1 行を細かさ（density）に応じて「かけら」に分け、最後に行全体をもう一度出す（recap）。
 * また、長い行は歌い終わる前に消える（visEnd）。MV 用では、行の頭から行の終わりまで、1 行を丸ごと 1 カットで見せる。
 */
interface CutLike {
  line: number;
  start: number;
  end: number;
  dur: number;
  text: string;
  lineText?: string;
  utext?: string;
  words?: string[];
  recap?: boolean;
  emph?: boolean;
  outDur?: number;
}

export function oneCutPerLine(plan: { cuts: unknown[]; lines?: unknown[] }): void {
  const cuts = plan.cuts as CutLike[];
  const lineEnd = new Map<number, number>();
  for (const l of (plan.lines ?? []) as { index?: number; end?: number }[]) if (typeof l.index === 'number' && Number.isFinite(l.end)) lineEnd.set(l.index, l.end as number);
  const byLine = new Map<number, CutLike[]>();
  for (const c of cuts) if (c.line >= 0 && c.lineText) (byLine.get(c.line) ?? byLine.set(c.line, []).get(c.line)!).push(c);
  const drop = new Set<CutLike>();
  for (const [li, list] of byLine) {
    list.sort((a, b) => a.start - b.start);
    const first = list[0]!, last = list[list.length - 1]!;
    const recap = list.find((c) => c.recap);
    const words = recap?.words ?? list.filter((c) => !c.recap).flatMap((c) => c.words ?? []);
    const end = Math.max(last.end, lineEnd.get(li) ?? last.end);
    Object.assign(first, { text: first.lineText, utext: first.lineText, words, recap: false, emph: list.some((c) => c.emph), end, dur: end - first.start, outDur: last.outDur ?? first.outDur });
    for (const c of list.slice(1)) drop.add(c);
  }
  if (drop.size) plan.cuts = cuts.filter((c) => !drop.has(c));
}
