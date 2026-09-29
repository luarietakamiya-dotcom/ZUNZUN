import { describe, expect, it } from 'vitest';
import { backgroundUvScale } from './background';

describe('backgroundUvScale', () => {
  it('cover: 画面いっぱい (はみ出す側の uv を縮めて切り取る)', () => {
    // 4:3 の絵を 16:9 の画面に → 上下を切る
    const [x, y] = backgroundUvScale(4 / 3, 16 / 9, 'cover');
    expect(x).toBe(1);
    expect(y).toBeCloseTo((4 / 3) / (16 / 9));
    // 21:9 の絵を 16:9 の画面に → 左右を切る
    const [x2, y2] = backgroundUvScale(21 / 9, 16 / 9, 'cover');
    expect(x2).toBeCloseTo((16 / 9) / (21 / 9));
    expect(y2).toBe(1);
  });

  it('contain: 全体を収める (足りない側の uv を広げて、はみ出た分は黒)', () => {
    const [x, y] = backgroundUvScale(4 / 3, 16 / 9, 'contain');
    expect(x).toBeCloseTo((16 / 9) / (4 / 3));
    expect(y).toBe(1);
    const [x2, y2] = backgroundUvScale(21 / 9, 16 / 9, 'contain');
    expect(x2).toBe(1);
    expect(y2).toBeCloseTo((21 / 9) / (16 / 9));
  });

  it('同じ比率なら 1、壊れた値でも 1', () => {
    expect(backgroundUvScale(16 / 9, 16 / 9, 'cover')).toEqual([1, 1]);
    expect(backgroundUvScale(0, 16 / 9, 'cover')).toEqual([1, 1]);
    expect(backgroundUvScale(NaN, 1, 'contain')).toEqual([1, 1]);
  });
});
