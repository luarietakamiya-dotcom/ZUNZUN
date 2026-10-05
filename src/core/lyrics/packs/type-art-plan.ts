import type { LyricsMotion } from '../../types';

type Cut = { line: number; text: string; lineText?: string; start: number; end: number; layout: string; params: Record<string, unknown>; seed?: number; trans?: string; morph?: unknown };
const KEYS = new Set(['vsHyperHero', 'vsHyperOffset', 'vsArtHyper2', 'vsGothicCross', 'vsArtGothic1', 'vsArtGothic2']);
/** 行内で構図と時計を共有する。手指定・ロック済みの行は変更しない。 */
export function directTypeArtPlan<T extends { cuts: unknown[] }>(plan: T, motion: LyricsMotion): T {
  if (!['vs-hyper', 'vs-gothic'].includes(motion.style)) return plan;
  const groups = new Map<number, Cut[]>();
  for (const raw of plan.cuts) {
    const c = raw as Cut;
    if (c.line < 0 || !KEYS.has(c.layout)) continue;
    const override = motion.lines?.[String(c.line)];
    if (override && override.text === c.lineText && Object.keys(override).some(k => k !== 'text')) continue;
    const group = groups.get(c.line) ?? []; group.push(c); groups.set(c.line, group);
  }
  for (const cuts of groups.values()) {
    cuts.sort((a, b) => a.start - b.start);
    const first = cuts[0]!, full = (first.lineText || cuts.map(c => c.text).join('')).replace(/\s/g, '');
    const end = Math.max(...cuts.map(c => c.end)), times = Array.from(full, () => first.start);
    let cursor = 0;
    for (const c of cuts) {
      const part = c.text.replace(/\s/g, '');
      if (!part || part === full) continue;
      const at = full.indexOf(part, cursor);
      if (at < 0) continue;
      const start = [...full.slice(0, at)].length;
      for (let i = 0; i < [...part].length; i++) times[start + i] = c.start;
      cursor = at + part.length;
    }
    for (const c of cuts) {
      c.layout = first.layout; c.seed = first.seed; c.trans = 'none'; c.morph = null;
      c.params = { ...first.params, artText: full, artStart: first.start, artEnd: end, artTimes: times };
    }
  }
  return plan;
}
