import { expect, it } from 'vitest';
import { subtitleLines, subtitlePack } from './subtitle';
import type { PackEnv, PackItem, PackJ } from '../types';

it('下部二段組は絵文字を壊さず、長文の全ての文字を最大2行で保つ', () => {
  for (const text of ['夜🌙を越えて君の声を待つ', '君の声が、ここに届く', '未来へ向かって歩いていく'.repeat(10)]) {
    const lines = subtitleLines(text, true);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
    expect(lines.join('')).not.toContain('\uFFFD');
  }
});

it('静かな浮上は先頭から順に現れ、組み替えは一段の位置から二段へ収束する', () => {
  const effects = subtitlePack.effects({} as PackJ);
  const enter = effects.find(e => e.key === 'vsgSubtitleKineticIn')!;
  const item: PackItem & { subtitleMode: string } = { size: 60, subtitleMode: 'float', charFns: [] };
  (enter.def.apply as (e: PackEnv, i: PackItem, p: number) => void)({ fx: { motion: 1 } } as PackEnv, item, .4);
  expect(item.charFns[0]!(0, { i: 0 }, 8)!.a).toBe(1);
  expect(item.charFns[0]!(7, { i: 7 }, 8)!.a).toBe(0);
  const geometry = effects.find(e => e.key === 'vsgSubtitleGeometry')!;
  const run = (lt: number) => {
    const it = { size: 60, charFns: [], subtitleMode: 'reflow', subtitleOffsets: [{ dx: -40, dy: 30 }] } as PackItem;
    (geometry.def.apply as (e: PackEnv, i: PackItem) => void)({ lt, cut: { dur: 5 }, fx: { motion: 1 } } as PackEnv, it);
    return it.charFns[0]!(0, { i: 0 }, 1)!;
  };
  expect(run(.5)).toEqual({ dx: -40, dy: 30 });
  expect(run(4)).toEqual({ dx: -0, dy: 0 });
});
it('字幕の動き0は出入りと表示中の位置を固定し、視点も動かさない', () => {
  const J = {} as PackJ;
  for (const effect of subtitlePack.effects(J)) {
    if (!['enter', 'hold', 'exit'].includes(effect.group)) continue;
    const item: PackItem = { size: 60, charFns: [] };
    (effect.def.apply as (e: PackEnv, i: PackItem, p: number) => void)({ lt: 1.2, fx: { motion: 0 } } as PackEnv, item, .5);
    for (const fn of item.charFns) {
      const mod = fn(2, { i: 2 }, 6)!;
      expect(mod.dx ?? 0).toBeCloseTo(0); expect(mod.dy ?? 0).toBeCloseTo(0);
    }
  }
});
