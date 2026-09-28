import { describe, expect, it } from 'vitest';
import { nearest, snapTime } from './snap';

const targets = { candidates: [1.0, 2.04, 5.5], beats: [0, 0.5, 1.5, 2.0, 3.0, 3.5] };

describe('snapTime', () => {
  it('±窓の中に歌い出し候補があれば、ビートより候補を優先する', () => {
    // 2.1 秒: ビート 2.0 (0.1 秒) より候補 2.04 (0.06 秒) が近い → 候補。候補が少し遠くても窓内なら候補
    expect(snapTime(2.1, targets, 0.15)).toEqual({ t: 2.04, kind: 'candidate' });
    expect(snapTime(1.9, targets, 0.15)).toEqual({ t: 2.04, kind: 'candidate' });
  });

  it('候補が無ければビート、どちらも無ければそのまま', () => {
    expect(snapTime(3.1, targets, 0.15)).toEqual({ t: 3.0, kind: 'beat' });
    expect(snapTime(4.2, targets, 0.15)).toEqual({ t: 4.2, kind: 'none' });
  });

  it('吸着しない設定 (Alt 押下など)・窓 0 では常にそのまま', () => {
    expect(snapTime(2.1, targets, 0.15, false)).toEqual({ t: 2.1, kind: 'none' });
    expect(snapTime(2.1, targets, 0)).toEqual({ t: 2.1, kind: 'none' });
  });

  it('候補やビートが無い曲・NaN でも落ちない', () => {
    expect(snapTime(1, { candidates: [], beats: [] }, 0.15)).toEqual({ t: 1, kind: 'none' });
    expect(snapTime(Number.NaN, targets, 0.15)).toEqual({ t: 0, kind: 'none' });
  });
});

describe('nearest', () => {
  it('昇順の配列から最も近い値 (等距離なら小さい方)', () => {
    expect(nearest([], 1)).toBeNull();
    expect(nearest([1, 3], 2)).toBe(1);
    expect(nearest([1, 3], -5)).toBe(1);
    expect(nearest([1, 3], 99)).toBe(3);
    expect(nearest([1, 2, 3, 4], 2.6)).toBe(3);
  });
});
