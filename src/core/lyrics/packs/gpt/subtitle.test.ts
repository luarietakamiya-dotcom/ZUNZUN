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
