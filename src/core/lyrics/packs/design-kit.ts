import type { PackBox, PackEnv, PackJ } from './types';
import { easeIn, easeOut } from './util';

/** オリジナルのレイアウト (図案 など) で使う型と小さな関数 */

/** 図案 (ZUNZUN) の部品セットの名前 */
export const DESIGN_SET = 'zzDesign';

export interface Rng {
  pick<T>(a: T[]): T;
  range(a: number, b: number): number;
  chance(p: number): boolean;
  int(a: number, b: number): number;
}

export interface DrawItem extends Record<string, unknown> {
  text: string;
  font: string;
  size: number;
  x: number;
  y: number;
}

export interface LayoutEnv extends PackEnv {
  ctx: CanvasRenderingContext2D;
  ltb?: number;
  cut: PackEnv['cut'] & { params: Record<string, unknown>; text: string; lineText?: string; line: number; start: number; words?: string[] };
  st: { fonts: Record<string, string[] | undefined> };
  draw(item: DrawItem): PackBox | null;
  rect(x: number, y: number, w: number, h: number, c: string, a?: number, ghost?: boolean): void;
  rrect(x: number, y: number, w: number, h: number, r: number, fill: string | null, a?: number, ghost?: boolean, stroke?: string, lw?: number): void;
  poly(pts: [number, number][], c: string, a?: number, ghost?: boolean): void;
}

export const fontsOf = (st: LayoutEnv['st'], roles: string[]): string[] =>
  roles.flatMap((r) => st.fonts[r] ?? []).filter(Boolean).concat(['gothic_bold']).slice(0, 4);

/** カットの文字 (空白をまとめ、前後の空白を除く) */
export const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** 空白を除いた文字の数 */
export const glyphs = (s: string): number => [...s.replace(/\s/g, '')].length;

/** 飾りの出方: 登場の始めに tin 秒で現れ、退場で消える (0..1) */
export function shown(env: LayoutEnv, J: PackJ, tin = 0.3, delay = 0): number {
  return easeOut(J.clamp((env.lt - delay) / tin)) * (1 - easeIn(J.clamp(env.pOut)));
}

export const union = (a: PackBox | null, b: PackBox | null): PackBox | null =>
  !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };

export const pad = (n: number, k: number): string => String(Math.max(0, Math.floor(n))).padStart(k, '0');
/** 秒 → 00:12.40 */
export const timecode = (t: number): string => `${pad(t / 60, 2)}:${pad(t % 60, 2)}.${pad((t % 1) * 100, 2)}`;

/** カットの語 (JIZURA が区切ったもの。無ければ空白で区切る) */
export function wordsOf(cut: { words?: unknown; text: string }): string[] {
  const w = Array.isArray(cut.words) ? (cut.words as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
  return w.length ? w : clean(cut.text).split(' ').filter(Boolean);
}

export const isMain = (env: { pass: string }): boolean => env.pass === 'main';
