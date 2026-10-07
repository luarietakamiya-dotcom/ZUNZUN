import type { PackJ } from '../../types';
import { clean, type LayoutEnv } from '../../design-kit';

/** 主役の大きさ。まず 1 行で収まるか（上限の 55 % 以上なら折り返さない）。収まらなければ半分に折る */
export function fitHero(J: PackJ, font: string, text: string, maxW: number, maxH: number, maxSize: number): { lines: string[]; size: number } {
  const one = J.fitSize([text], font, maxW, maxH);
  if (one >= maxSize * 0.55) return { lines: [text], size: Math.min(maxSize, one) };
  const split = J.splitLines(text, Math.max(2, Math.ceil([...text].length / 2)));
  const lines = Array.isArray(split) ? split : [split];
  return { lines, size: Math.min(maxSize, J.fitSize(lines, font, maxW, maxH)) };
}
export const firstChar = (s: string): string => [...clean(s)].find((c) => c.trim()) ?? '';
/** 主役の回転した座標系で (dx, dy) の点の画面座標 */
export function frame(cx: number, cy: number, angDeg: number): (dx: number, dy: number) => [number, number] {
  const r = (angDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return (dx, dy) => [cx + dx * c - dy * s, cy + dx * s + dy * c];
}
/** 装飾があるか（装飾 0 では描かない） */
export const on = (env: LayoutEnv): boolean => (env.fx.decor ?? 0.5) > 0.05;
