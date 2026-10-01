import { describe, expect, it } from 'vitest';
import { levelAt, levelFx, levelOf, mergeSectionPlans, sectionLevels } from './section-motion';
import type { Section } from './sections';

const sec = (kind: Section['kind'], start: number, end: number): Section => ({ kind, label: kind, start, end });

describe('区切りで歌詞の動きを変える', () => {
  it('levelFx: ふつう = つまみのまま、静か = 小さく、激しい = 大きく (0..1 に収める)', () => {
    const base = { motion: 0.7, decor: 0.5, density: 0.55 };
    expect(levelFx(base, 'normal')).toEqual(base);
    const calm = levelFx(base, 'calm');
    const hot = levelFx(base, 'intense');
    for (const k of ['motion', 'decor', 'density'] as const) {
      expect(calm[k]).toBeLessThan(base[k]);
      expect(hot[k]).toBeGreaterThan(base[k]);
      expect(hot[k]).toBeLessThanOrEqual(1);
    }
    expect(levelFx({ motion: 0.95, decor: 1, density: 0.9 }, 'intense')).toEqual({ motion: 1, decor: 1, density: 1 });
  });

  it('sectionLevels: 既定はサビが激しい・イントロが静か。区切りが無い・切ってある・強さが 1 種類なら null', () => {
    const sections = [sec('intro', 0, 10), sec('verse', 10, 30), sec('chorus', 30, 50)];
    expect(sectionLevels(sections, undefined)?.map((s) => s.level)).toEqual(['calm', 'normal', 'intense']);
    expect(sectionLevels([], undefined)).toBeNull();
    expect(sectionLevels(sections, { enabled: false, levels: {} })).toBeNull();
    expect(sectionLevels([sec('verse', 0, 10), sec('other', 10, 20)], undefined)).toBeNull();
    // 種類ごとに選び直せる
    expect(sectionLevels(sections, { enabled: true, levels: { chorus: 'calm', intro: 'intense' } })?.map((s) => s.level)).toEqual(['intense', 'normal', 'calm']);
    expect(levelOf({ enabled: true, levels: { verse: 'bogus' as never } }, 'verse')).toBe('normal');
  });

  it('mergeSectionPlans: 区切りごとにその強さの段取りからカットと効果を取り出す。曲名のカットはふつうから', () => {
    const plan = (tag: string) => ({
      cuts: [
        { start: 0.1, line: -1, tag },
        { start: 2, line: 0, tag },
        { start: 12, line: 1, tag },
        { start: 31, line: 2, tag },
        { start: 35, line: 2, tag },
      ],
      events: [
        { t: 3, tag },
        { t: 32, tag },
      ],
    });
    const spans = [
      { start: 0, end: 10, level: 'calm' as const },
      { start: 10, end: 30, level: 'normal' as const },
      { start: 30, end: 50, level: 'intense' as const },
    ];
    const merged = mergeSectionPlans({ calm: plan('calm'), normal: plan('normal'), intense: plan('intense') }, spans);
    expect(merged.cuts.map((c) => [c.start, (c as { tag: string }).tag])).toEqual([
      [0.1, 'normal'],
      [2, 'calm'],
      [12, 'normal'],
      [31, 'intense'],
      [35, 'intense'],
    ]);
    expect(merged.events.map((e) => (e as { tag: string }).tag)).toEqual(['calm', 'intense']);
    expect(levelAt(spans, 40)).toBe('intense');
    expect(levelAt(spans, 60)).toBe('normal');
  });
});
