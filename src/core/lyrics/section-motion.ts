import type { LyricsSectionMotion, MotionLevel } from '../types';
import { sectionAt, type Section, type SectionKind } from './sections';

/**
 * 曲の区切りごとに歌詞の動きの強さを変える (2026-10-01 ユーザー承認の計画、docs/ARCHITECTURE.md「区切りで歌詞の動きを変える」)。
 * JIZURA の動きの大きさ・飾りの量・区切りの細かさ (fx) は曲全体で 1 つなので、JIZURA の本体は変えずに:
 * - 段取り: 強さごとに J.plan を作り、区切りごとに、その強さの段取りからカットと効果を取り出してつなぐ (mergeSectionPlans)
 * - 描くとき: 今いる区切りの強さの fx を渡す (LyricMotion.render が plan.fx を差し替える)
 */

export const SECTION_KINDS: readonly SectionKind[] = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'interlude', 'outro', 'other'];

/** 区切りの種類ごとの最初の強さ */
export const DEFAULT_LEVELS: Record<SectionKind, MotionLevel> = {
  intro: 'calm',
  verse: 'normal',
  prechorus: 'normal',
  chorus: 'intense',
  bridge: 'calm',
  interlude: 'calm',
  outro: 'calm',
  other: 'normal',
};

export const defaultSectionMotion = (): LyricsSectionMotion => ({ enabled: true, levels: {} });

export function levelOf(settings: LyricsSectionMotion | undefined, kind: SectionKind): MotionLevel {
  const v = settings?.levels[kind];
  return v === 'calm' || v === 'normal' || v === 'intense' ? v : DEFAULT_LEVELS[kind];
}

export interface MotionFx {
  motion: number;
  decor: number;
  density: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** 強さごとの fx。ふつう = つまみのまま、静か = 半分ほど、激しい = 3 割ほど上げる */
export function levelFx(base: MotionFx, level: MotionLevel): MotionFx {
  if (level === 'calm') return { motion: clamp01(base.motion * 0.45), decor: clamp01(base.decor * 0.4), density: clamp01(base.density * 0.6) };
  if (level === 'intense') return { motion: clamp01(base.motion + 0.3), decor: clamp01(base.decor + 0.3), density: clamp01(base.density + 0.3) };
  return { motion: clamp01(base.motion), decor: clamp01(base.decor), density: clamp01(base.density) };
}

/** 区切りごとの強さ。区切りが無い・変えない設定・強さが 1 種類だけなら null (今までどおり 1 つの段取り) */
export function sectionLevels(sections: readonly Section[], settings: LyricsSectionMotion | undefined): { start: number; end: number; level: MotionLevel }[] | null {
  if (settings && !settings.enabled) return null;
  if (sections.length === 0) return null;
  const spans = sections.map((s) => ({ start: s.start, end: s.end, level: levelOf(settings, s.kind) }));
  return new Set(spans.map((s) => s.level)).size > 1 ? spans : null;
}

/** 時刻 t の強さ (区切りの外は ふつう) */
export function levelAt(spans: readonly { start: number; end: number; level: MotionLevel }[], t: number): MotionLevel {
  const k = sectionAt(spans as unknown as Section[], t);
  return k >= 0 ? spans[k]!.level : 'normal';
}

interface PlanLike {
  cuts: { start: number; line?: number }[];
  events: { t: number }[];
}

/**
 * 強さごとの段取り (plans) から、区切りごとにその強さのカットと効果を取り出して 1 本にする。
 * 曲名のカット (line -1) と、区切りの外は ふつう の段取りから。元の段取り (plans.normal) を書き換えて返す
 */
export function mergeSectionPlans<P extends PlanLike>(plans: Record<MotionLevel, P>, spans: readonly { start: number; end: number; level: MotionLevel }[]): P {
  const base = plans.normal;
  const pick = (t: number): MotionLevel => levelAt(spans, t);
  base.cuts = (['calm', 'normal', 'intense'] as const)
    .flatMap((lv) => plans[lv].cuts.filter((c) => (c.line === -1 ? lv === 'normal' : pick(c.start) === lv)))
    .sort((a, b) => a.start - b.start) as P['cuts'];
  base.events = (['calm', 'normal', 'intense'] as const).flatMap((lv) => plans[lv].events.filter((e) => pick(e.t) === lv)).sort((a, b) => a.t - b.t) as P['events'];
  return base;
}
