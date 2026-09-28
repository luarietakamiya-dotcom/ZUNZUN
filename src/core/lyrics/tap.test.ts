import { describe, expect, it } from 'vitest';
import { History } from './history';
import { setLineStart, tapStartTime, TapSession } from './tap';

describe('TapSession (JIZURA のタップ操作と同じ)', () => {
  it('叩くたびに今の行の開始が決まって次の行へ進み、最後の行で終わる', () => {
    const s = new TapSession(3);
    let lt: Record<string, number> = {};
    lt = s.tap(lt, 1.2);
    lt = s.tap(lt, 3.4);
    expect(s.line).toBe(2);
    expect(s.isActive).toBe(true);
    lt = s.tap(lt, 5.6);
    expect(lt).toEqual({ '0': 1.2, '1': 3.4, '2': 5.6 });
    expect(s.isActive).toBe(false);
    // 終わったあとに叩いても何も変わらない
    expect(s.tap(lt, 9)).toEqual(lt);
  });

  it('後ろの行に残っている古い時刻が、叩いた時刻 + 0.2 秒より前なら消す', () => {
    const s = new TapSession(4);
    const lt = s.tap({ '1': 2.1, '2': 2.3, '3': 9 }, 2.0);
    // 行 1 (2.1) は 2.0 + 0.2 以内なので消える、行 2 (2.3) と行 3 (9) は残る
    expect(lt).toEqual({ '0': 2.0, '2': 2.3, '3': 9 });
  });

  it('1 つ戻ると、直前の行を叩く前の値に戻してその行から叩き直せる', () => {
    const s = new TapSession(3);
    let lt: Record<string, number> = { '1': 7 };
    lt = s.tap(lt, 1);
    lt = s.tap(lt, 2);
    expect(lt).toEqual({ '0': 1, '1': 2 });
    lt = s.back(lt)!;
    expect(lt).toEqual({ '0': 1, '1': 7 });
    expect(s.line).toBe(1);
    lt = s.back(lt)!;
    expect(lt).toEqual({ '1': 7 });
    expect(s.line).toBe(0);
    expect(s.canBack).toBe(false);
    expect(s.back(lt)).toBeNull();
  });

  it('最後の行を叩いて終わったあとでも、1 つ戻れば再開できる', () => {
    const s = new TapSession(1);
    const lt = s.tap({}, 3);
    expect(s.isActive).toBe(false);
    expect(s.back(lt)).toEqual({});
    expect(s.isActive).toBe(true);
  });

  it('途中の行から始められ、中断しても叩いた時刻は残る', () => {
    const s = new TapSession(5, 2);
    expect(s.line).toBe(2);
    const lt = s.tap({ '0': 1, '1': 3 }, 6);
    s.stop();
    expect(s.isActive).toBe(false);
    expect(lt).toEqual({ '0': 1, '1': 3, '2': 6 });
    expect(new TapSession(3, 99).line).toBe(2);
    expect(new TapSession(0).isActive).toBe(false);
  });

  it('渡した lineTimes は書き換えない (履歴に積めるように)', () => {
    const s = new TapSession(2);
    const before = Object.freeze({ '1': 0.5 });
    const after = s.tap(before, 0.4);
    expect(before).toEqual({ '1': 0.5 });
    expect(after).toEqual({ '0': 0.4 });
  });

  it('取り消し・やり直しの履歴と組み合わせられる', () => {
    const s = new TapSession(2);
    const h = new History<Record<string, number>>({});
    h.push(s.tap(h.current, 1));
    h.push(s.tap(h.current, 2));
    expect(h.undo()).toEqual({ '0': 1 });
    expect(h.redo()).toEqual({ '0': 1, '1': 2 });
  });
});

describe('tapStartTime', () => {
  const starts = [0.4, 2, 10, 11];
  it('1 行目からは 0 秒、途中の行はその 2.5 秒前 (前の行より前にはしない)', () => {
    expect(tapStartTime(starts, 0)).toBe(0);
    expect(tapStartTime(starts, 2)).toBe(7.5);
    expect(tapStartTime(starts, 3)).toBeCloseTo(10.01);
    expect(tapStartTime(starts, 1)).toBeCloseTo(0.41);
    expect(tapStartTime(starts, 99)).toBe(0);
  });
});

describe('setLineStart', () => {
  it('前の行の時刻は消さない', () => {
    expect(setLineStart({ '0': 5, '2': 1 }, 1, 3)).toEqual({ '0': 5, '1': 3 });
  });
});
