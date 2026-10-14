import { expect, it } from 'vitest';
import { ReviewFlags } from './review-flags';

it('要確認の印: 取り込みで付き、手で直した行だけ消え、取り消しで戻り、別の表（プロジェクトを開く）では無い', () => {
  const f = new ReviewFlags();
  const t0 = { lineTimes: { '0': 1 }, lineEnds: {} };
  const t1 = { lineTimes: { '0': 1.2, '1': 3, '2': 5 }, lineEnds: { '0': 2.8 } };
  f.carry(t0, t1, new Set([1, 2]));                    // LyricSync の結果を取り込む
  expect(f.rows(t1, 3)).toEqual([false, true, true]);
  const t2 = { lineTimes: { ...t1.lineTimes, '1': 3.3 }, lineEnds: t1.lineEnds };
  f.carry(t1, t2);                                     // 1 行目を手で直す（成功）
  expect(f.rows(t2, 3)).toEqual([false, false, true]);
  expect(f.rows(t1, 3)).toEqual([false, true, true]);  // 取り消して t1 に戻ると印も戻る
  const t3 = { lineTimes: t2.lineTimes, lineEnds: { ...t2.lineEnds, '2': 6 } };
  f.carry(t2, t3);                                     // 終わりだけ直しても、その行の印は消える（lineTimes は同じ物）
  expect(f.rows(t3, 3)).toBeUndefined();
  expect(f.rows(t2, 3)).toEqual([false, false, true]);  // 同じ lineTimes を持つ前の表の印は壊れない
  const opened = { lineTimes: { ...t1.lineTimes }, lineEnds: { ...t1.lineEnds } };
  expect(f.rows(opened, 3)).toBeUndefined();            // 同じ中身でも、別に開いた表には印が無い
  expect(f.rows(t0, 3)).toBeUndefined();
});
