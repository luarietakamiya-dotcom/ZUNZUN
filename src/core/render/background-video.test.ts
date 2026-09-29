import { describe, expect, it } from 'vitest';
import { videoTimeAt } from './background-video';

describe('videoTimeAt', () => {
  it('くり返す: 動画の長さで割った余り', () => {
    expect(videoTimeAt(0.5, 2, true)).toBe(0.5);
    expect(videoTimeAt(2.5, 2, true)).toBeCloseTo(0.5);
    expect(videoTimeAt(7, 2, true)).toBeCloseTo(1);
  });

  it('最後の絵で止める: 終わりのほんの少し手前で止まる', () => {
    expect(videoTimeAt(0.5, 2, false)).toBe(0.5);
    expect(videoTimeAt(9, 2, false)).toBeCloseTo(1.999);
  });

  it('壊れた値は 0', () => {
    expect(videoTimeAt(NaN, 2, true)).toBe(0);
    expect(videoTimeAt(-1, 2, false)).toBe(0);
    expect(videoTimeAt(3, 0, true)).toBe(0);
  });
});
