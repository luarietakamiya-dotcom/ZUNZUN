import { describe, expect, it } from 'vitest';
import { MIN_GAP, moveLine, moveLineEnd, moveLineStart, shiftLines, startBounds, type EditContext } from './edit';
import { MIN_LINE_DURATION } from './timing';

// 行 0: 2〜5 (同期済み)、行 1: 5〜8 (未同期 = 仮の時刻)、行 2: 8〜11 (同期済み)
const ctx: EditContext = { starts: [2, 5, 8], ends: [5, 8, 11], synced: [true, false, true] };
const timing = { lineTimes: { '0': 2, '2': 8 }, lineEnds: {} };

describe('moveLineStart', () => {
  it('前後の同期済みの行の間に収める (未同期の行の仮の時刻には縛られない)', () => {
    expect(moveLineStart(ctx, timing, 2, 1).lineTimes['2']).toBe(2 + MIN_GAP);
    expect(moveLineStart(ctx, timing, 0, 50).lineTimes['0']).toBe(8 - MIN_GAP);
    expect(moveLineStart(ctx, timing, 0, -3).lineTimes['0']).toBe(0);
    // 未同期の行 1 は、行 0 と行 2 の間ならどこでも
    expect(moveLineStart(ctx, timing, 1, 3).lineTimes['1']).toBe(3);
  });

  it('手動の終了があれば、終了 − 最短の長さより後ろにはしない', () => {
    const t = { lineTimes: { '0': 2, '2': 8 }, lineEnds: { '0': 4 } };
    expect(moveLineStart(ctx, t, 0, 3.9).lineTimes['0']).toBeCloseTo(4 - MIN_LINE_DURATION);
  });

  it('元のオブジェクトは書き換えない。NaN や範囲外の行は何もしない', () => {
    const frozen = Object.freeze({ lineTimes: Object.freeze({ '0': 2 }), lineEnds: Object.freeze({}) });
    expect(() => moveLineStart(ctx, frozen, 0, 3)).not.toThrow();
    expect(moveLineStart(ctx, timing, 0, Number.NaN)).toBe(timing);
    expect(moveLineStart(ctx, timing, 9, 1)).toBe(timing);
  });
});

describe('moveLineEnd', () => {
  it('開始 + 最短の長さ 〜 次の行の開始 に収める (次の行が未同期でも、その仮の開始が上限)', () => {
    expect(moveLineEnd(ctx, timing, 0, 2.1).lineEnds['0']).toBeCloseTo(2 + MIN_LINE_DURATION);
    // 行 0 の次は未同期の行 1 (仮の開始 5 秒)。それより後ろの終了は computeLineTimes が切り詰めるので同じ上限にする
    expect(moveLineEnd(ctx, timing, 0, 9).lineEnds['0']).toBe(5);
    expect(moveLineEnd(ctx, timing, 0, 4.5).lineEnds['0']).toBe(4.5);
    // 最後の行は上限なし
    expect(moveLineEnd(ctx, timing, 2, 30).lineEnds['2']).toBe(30);
  });

  it('未同期の行の終了を決めると、開始も今の位置で手動になる', () => {
    const r = moveLineEnd(ctx, timing, 1, 7);
    expect(r.lineTimes['1']).toBe(5);
    expect(r.lineEnds['1']).toBe(7);
  });
});

describe('moveLine', () => {
  it('開始と手動の終了を同じだけ動かす', () => {
    const t = { lineTimes: { '0': 2, '2': 8 }, lineEnds: { '0': 4 } };
    const r = moveLine(ctx, t, 0, 1);
    expect(r.lineTimes['0']).toBe(3);
    expect(r.lineEnds['0']).toBe(5);
  });

  it('手動の終了が次の行を越えないところで止める', () => {
    const t = { lineTimes: { '0': 2, '2': 8 }, lineEnds: { '0': 4 } };
    const r = moveLine(ctx, t, 0, 10);
    expect(r.lineEnds['0']).toBe(8);
    expect(r.lineTimes['0']).toBe(6);
  });

  it('手動の終了が無ければ開始だけ (次の同期済みの行の手前まで)', () => {
    const r = moveLine(ctx, timing, 0, 100);
    expect(r.lineTimes['0']).toBe(8 - MIN_GAP);
    expect(r.lineEnds).toEqual({});
  });
});

describe('shiftLines', () => {
  it('対象の行を今の開始 + dt にし、手動の終了もずらす。0 秒より前にはしない', () => {
    const t = { lineTimes: { '0': 2 }, lineEnds: { '2': 11 } };
    const r = shiftLines(ctx, t, [0, 1, 2], -2.5);
    expect(r.lineTimes).toEqual({ '0': 0, '1': 2.5, '2': 5.5 });
    expect(r.lineEnds).toEqual({ '2': 8.5 });
  });

  it('対象外の行は変えない', () => {
    const r = shiftLines(ctx, timing, [2], 0.8);
    expect(r.lineTimes).toEqual({ '0': 2, '2': 8.8 });
  });
});

describe('startBounds', () => {
  it('先頭の行は 0 から', () => {
    expect(startBounds(ctx, timing, 0)).toEqual([0, 8 - MIN_GAP]);
  });
});
