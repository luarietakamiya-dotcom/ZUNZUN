import { describe, expect, it } from 'vitest';
import { BLANK_FADE_SEC, blankAlpha, blankAt, blankFromPlayhead, normalizeBlanks } from './blanks';

describe('歌詞の空白', () => {
  it('normalizeBlanks: 並べ直し、重なりをまとめ、0.5 秒より短いものと数でないものは捨てる', () => {
    expect(
      normalizeBlanks([
        { start: 10, end: 14, mode: 'none' },
        { start: 2, end: 5, mode: 'interlude' },
        { start: 12, end: 16, mode: 'none' },
        { start: 20, end: 20.2, mode: 'none' },
        { start: NaN, end: 3, mode: 'none' },
      ]),
    ).toEqual([
      { start: 2, end: 5, mode: 'interlude' },
      { start: 10, end: 16, mode: 'none' },
    ]);
  });

  it('blankAlpha: 何も出さない空白の中は 0、端は 0.3 秒かけてなめらかに。間奏の動きの空白は 1 のまま', () => {
    const blanks = [
      { start: 10, end: 20, mode: 'none' as const },
      { start: 30, end: 40, mode: 'interlude' as const },
    ];
    expect(blankAlpha(blanks, 5)).toBe(1);
    expect(blankAlpha(blanks, 15)).toBe(0);
    expect(blankAlpha(blanks, 10)).toBe(1);
    expect(blankAlpha(blanks, 10 + BLANK_FADE_SEC / 2)).toBeCloseTo(0.5, 5);
    expect(blankAlpha(blanks, 10 + BLANK_FADE_SEC)).toBe(0);
    expect(blankAlpha(blanks, 20 - BLANK_FADE_SEC / 2)).toBeCloseTo(0.5, 5);
    expect(blankAlpha(blanks, 35)).toBe(1);
    expect(blankAlpha(undefined, 15)).toBe(1);
    // なめらかに増え減りする (1 コマで大きく跳ばない)
    let prev = 1;
    for (let t = 9.9; t <= 10.5; t += 1 / 60) {
      const a = blankAlpha(blanks, t);
      expect(Math.abs(a - prev)).toBeLessThan(0.12);
      prev = a;
    }
    expect(blankAt(blanks, 15)).toBe(0);
    expect(blankAt(blanks, 25)).toBe(-1);
  });

  it('blankFromPlayhead: 再生位置から次の行の始まりまで。行の途中なら、その行をそこで終わらせる', () => {
    const starts = [2, 6, 20];
    const ends = [6, 12, 25];
    expect(blankFromPlayhead(9, starts, ends, 30)).toEqual({ blank: { start: 9, end: 20, mode: 'none' }, cut: { line: 1, end: 9 } });
    // 行と行の間なら、行は切らない
    expect(blankFromPlayhead(13, starts, ends, 30, 'interlude')).toEqual({ blank: { start: 13, end: 20, mode: 'interlude' }, cut: null });
    // 最後の行のあとは曲の終わりまで
    expect(blankFromPlayhead(26, starts, ends, 30)?.blank.end).toBe(30);
    // 次の行まで 0.5 秒もなければ作らない
    expect(blankFromPlayhead(19.7, starts, ends, 30)).toBeNull();
  });
});
