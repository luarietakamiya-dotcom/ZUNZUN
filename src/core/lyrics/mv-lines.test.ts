import { expect, it } from 'vitest';
import { oneCutPerLine } from './mv-lines';

it('MV 用: かけらと「まとめ直し」をやめ、1 行を頭から行の終わりまで 1 カットで見せる', () => {
  const cut = (line: number, start: number, end: number, text: string, extra: Record<string, unknown> = {}) => ({ line, start, end, dur: end - start, text, lineText: line === 0 ? '名前を呼んだ' : '夜を越えて', words: [text], ...extra });
  const plan = {
    cuts: [
      { line: -1, start: 0, end: 0.4, dur: 0.4, text: '曲名', lineText: '曲名' },
      cut(0, 0.5, 1.6, '名前を'), cut(0, 1.6, 2.7, '呼んだ', { emph: true }), cut(0, 2.7, 3.6, '名前を呼んだ', { recap: true, words: ['名前を', '呼んだ'], outDur: 0.3 }),
      cut(1, 4.5, 6, '夜を越えて'),
    ],
    lines: [{ index: 0, start: 0.5, end: 4.35 }, { index: 1, start: 4.5, end: 8.35 }],
  };
  oneCutPerLine(plan);
  const cuts = plan.cuts as unknown as { line: number; start: number; end: number; dur: number; text: string; words: string[]; recap: boolean; emph: boolean; outDur: number }[];
  expect(cuts.map((c) => c.text)).toEqual(['曲名', '名前を呼んだ', '夜を越えて']);
  expect(cuts[1]).toMatchObject({ start: 0.5, end: 4.35, recap: false, emph: true, outDur: 0.3, words: ['名前を', '呼んだ'] });
  expect(cuts[1]!.dur).toBeCloseTo(3.85);
  expect(cuts[2]).toMatchObject({ start: 4.5, end: 8.35 });
});
