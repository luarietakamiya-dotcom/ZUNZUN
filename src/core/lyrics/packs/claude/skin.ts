import type { PackBox, PackJ } from '../types';
import { clean, mergeWords, union, wordsOf, type LayoutEnv } from '../design-kit';
import { beatOf, easeOut, easeInOut, flashAllowed } from '../util';

/** Claude 版の共通の「肌」の部品。小さな文字の土台・巨大な薄い字・罫・反復の帯・拍（docs/LYRIC_MOTION_RESEARCH.md 第 2・5 章）。 */
export const cap = (x: number): number => Math.max(0, Math.min(1, x));
export const motionOf = (env: LayoutEnv): number => cap(env.fx.motion ?? 0.7);
export const decorOf = (env: LayoutEnv): number => cap(env.fx.decor ?? 0.5);
/** 登場して退場するまでの見え方 (0..1)。装飾の出入りに使う */
export const visible = (env: LayoutEnv): number => easeOut(cap(env.pIn)) * (1 - easeInOut(cap(env.pOut)));
export const sideOf = (env: LayoutEnv): 1 | -1 => (Number(env.cut.params.side ?? 1) < 0 ? -1 : 1);

/** 拍の脈動（形だけを動かす。明るさは動かさない）。拍の回数が毎秒 3 回を超えないようにする */
export function beatHit(env: LayoutEnv): { index: number; hit: number } {
  const b = beatOf(env);
  return { index: b.index, hit: flashAllowed(b.index, b.len) ? Math.exp(-b.since * 11) * motionOf(env) : 0 };
}

const rot = (cx: number, cy: number, ang: number, dx: number, dy: number): [number, number] => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
};
/** 中心 (cx, cy)・角度 ang(度) の座標系で (dx, dy) の点の画面座標 */
export const local = (cx: number, cy: number, angDeg: number, dx: number, dy: number): [number, number] => rot(cx, cy, (angDeg * Math.PI) / 180, dx, dy);

/** 描かれた枠の大きさ（文字を描かずに測る） */
export function sizeOf(J: PackJ, text: string[] | string, font: string, size: number, track = 0): { w: number; h: number } {
  const m = J.measure({ text: Array.isArray(text) ? text.join('\n') : text, font, size, x: 0, y: 0, track });
  return { w: m.w, h: m.h };
}

/** 装飾の小さな文字（番号・ラベル・歌詞の細かい野）。主役の動きは受けない */
export function micro(env: LayoutEnv, text: string, x: number, y: number, size: number, color: string, alpha: number, opt: Record<string, unknown> = {}): void {
  if (env.pass !== 'main' || alpha <= 0.01) return;
  env.draw({ text, font: 'dot', size, x, y, color, alpha, align: 'left', ...opt });
}

/** 巨大な薄い字（質感）。読ませる文字ではない。画面からはみ出してよい */
export function ghostGlyph(env: LayoutEnv, ch: string, x: number, y: number, size: number, font: string, color: string, alpha: number): PackBox | null {
  if (env.pass !== 'main' || alpha <= 0.004 || !ch.trim()) return null;
  return env.draw({ text: ch, font, size, x, y, color, alpha });
}

/** 細い罫（長さ w、中心 x, y。アルファは decor で調整済みを渡す） */
export function rule(env: LayoutEnv, x0: number, y0: number, x1: number, y1: number, color: string, width: number, alpha: number): void {
  if (env.pass !== 'main' || alpha <= 0.01) return;
  env.line([[x0, y0], [x1, y1]], color, Math.max(0.7, width), alpha);
}

/** 文字の枠 (union の別名) */
export const merge = union;

/**
 * カットの語（読む順序を保つ）。語が 2 つ以上あるときだけ分け、1 語（例: 「止まらない」）は分けない。
 * hero = いちばん長い語、pre = hero より前の語、post = 後の語。pre は主役の左上、post は右下の縁に置く（読む順序が壊れない）
 */
export function phrases(env: LayoutEnv): { hero: string; pre: string[]; post: string[] } {
  const w = wordsOf(env.cut);
  const words = w.length >= 2 ? mergeWords(w, 3) : [clean(env.cut.text)];
  const hi = words.reduce((best, s, i) => ([...s].length > [...words[best]!].length ? i : best), 0);
  return { hero: words[hi]!, pre: words.slice(0, hi), post: words.slice(hi + 1) };
}
