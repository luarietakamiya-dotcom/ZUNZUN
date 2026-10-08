import { expect, it } from 'vitest';
import { insertionClock, insertionDirections, insertionMod, moonPhase, prepareMoonPlan, moonFeatherPack } from './moon-feather';
import type { PackEnv, PackItem, PackJ } from '../types';

it('次の文字は前の文字の着地前に動き始め、最後の文字まで挿入時間内に着地する', () => {
  const duration = 1.8, count = 12;
  const first = insertionClock(0, 0, count, duration);
  const next = insertionClock(first.landedAt / 2, 1, count, duration);
  expect(next.progress).toBeGreaterThan(0);
  expect(insertionClock(first.landedAt / 2, 0, count, duration).progress).toBeLessThan(1);
  expect(insertionClock(duration, count - 1, count, duration).progress).toBeCloseTo(1);
});

it('漢字と英字は別方向から挿入し、かなは語の方向を引き継ぐ', () => {
  expect(insertionDirections([... '月の Light が舞う'])).toEqual([1, 1, -1, -1, -1, -1, -1, -1, 1, 1, 1, 1]);
});

it('挿入マスクは文字の移動を打ち消して定位置に留まり、漢字は16%大きい', () => {
  for (const direction of [-1, 1]) for (const q of [.1, .4, .7]) {
    const mod = insertionMod(q, direction, 40, true, .3);
    expect(mod.s).toBe(1.16);
    expect(mod.clipY![0] * 40 * mod.s! + mod.dy!).toBeCloseTo(-.6 * 40 * 1.16);
    expect(mod.clipY![1] * 40 * mod.s! + mod.dy!).toBeCloseTo(.6 * 40 * 1.16);
  }
  expect(insertionMod(1, 1, 40, false, 1).clipY).toBeUndefined();
  expect(insertionMod(.2, 1, 40, true, 0).dy).toBe(0);
});

it('400ms早い表示時刻でも歌唱時刻の区切りを使い、イントロ三日月・サビ満月にする', () => {
  const plan = { cuts: [{ line: 0, start: 1.6, params: {} }, { line: 1, start: 4.6, params: {} }] };
  prepareMoonPlan(plan, [{ kind: 'intro', label: 'Intro', start: 0, end: 5 }, { kind: 'chorus', label: 'Chorus', start: 5, end: 10 }], [2, 5]);
  expect(plan.cuts.map(c => (c.params as { moonPhase: number }).moonPhase)).toEqual([.18, 1]);
  expect(moonPhase('verse')).toBeGreaterThan(moonPhase('intro'));
});

it('挿入と表示中の演出が重なる時も漢字を二重拡大しない', () => {
  const effects = moonFeatherPack.effects({} as PackJ);
  for (const lt of [.9, 1, 1.1]) {
    const env = { lt, cut: { inDur: 1 }, fx: { motion: 1 } } as PackEnv;
    const item = { size: 40, moonChars: ['月'], charFns: [] } as PackItem;
    for (const e of effects.filter(e => e.group === 'hold' || (e.group === 'enter' && lt < 1))) {
      (e.def.apply as (env: PackEnv, item: PackItem) => void)(env, item);
    }
    expect(item.charFns.reduce((scale, fn) => scale * (fn(0, { i: 0 }, 1)?.s ?? 1), 1)).toBeCloseTo(1.16);
  }
});
