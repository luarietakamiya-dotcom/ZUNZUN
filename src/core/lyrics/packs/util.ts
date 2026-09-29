import type { PackBox, PackEnv, PackJ } from './types';

/** パックの演出どうしで使う小さな関数 */

/** 0..1 を少しずつずらした進み具合 (文字 i が spread の割合だけ遅れて始まる) */
export function staggered(p: number, i: number, n: number, spread: number): number {
  const d = n > 1 ? (i / (n - 1)) * spread : 0;
  return Math.min(1, Math.max(0, (p - d) / Math.max(0.01, 1 - spread)));
}

export const easeOut = (x: number): number => 1 - (1 - x) ** 3;
export const easeIn = (x: number): number => x * x * x;
export const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** 少し行き過ぎて戻る */
export const easeOutBack = (x: number, k = 1.7): number => 1 + (k + 1) * (x - 1) ** 3 + k * (x - 1) ** 2;

/** 装飾の基準の枠 (文字の枠が無ければ画面の中央) */
export function centerBox(env: Pick<PackEnv, 'W' | 'H'>, bb: PackBox | null): PackBox {
  if (bb && Number.isFinite(bb.x0) && bb.x1 > bb.x0 && bb.y1 > bb.y0) return bb;
  return { x0: env.W * 0.3, x1: env.W * 0.7, y0: env.H * 0.44, y1: env.H * 0.56 };
}

/**
 * JIZURA の演出のうち、tags のどれかの印があるものだけを使う (groups の種類について)。
 * このパック (packId) のオリジナルの演出は触らない。無効にするだけで、有効にはしない (ほかの決まりで無効のものはそのまま)
 */
export function allowOnlyTagged(project: Record<string, unknown>, J: PackJ, packId: string, tags: readonly string[], groups: readonly string[]): void {
  const enabled = (project.enabled ?? {}) as Record<string, Record<string, boolean>>;
  for (const g of groups) {
    const reg = J.registry(g);
    const map = { ...(enabled[g] ?? {}) };
    for (const k of J.order(g)) {
      const d = reg[k];
      if (!d || d.pack === packId) continue;
      if (!d.tags?.some((t) => tags.includes(t))) map[k] = false;
    }
    enabled[g] = map;
  }
  project.enabled = enabled;
}

/** 指定の演出を無効にする */
export function disable(project: Record<string, unknown>, group: string, keys: readonly string[]): void {
  const enabled = (project.enabled ?? {}) as Record<string, Record<string, boolean>>;
  const map = { ...(enabled[group] ?? {}) };
  for (const k of keys) map[k] = false;
  enabled[group] = map;
  project.enabled = enabled;
}

/**
 * 光過敏への配慮: 明るさが急に変わる演出は毎秒 3 回まで (Live Stage と同じ)。
 * 拍の番号と拍の長さから「この拍で光らせてよいか」を決める (速い曲では数拍おきにする)
 */
export const MAX_FLASH_HZ = 3;
export function flashAllowed(beatIndex: number, beatLen: number): boolean {
  if (!(beatLen > 0) || !Number.isFinite(beatIndex)) return false;
  const every = Math.max(1, Math.ceil(1 / (MAX_FLASH_HZ * beatLen) - 1e-9));
  return beatIndex % every === 0;
}

/** 拍からの経過 (拍が無ければ、カットの中の時刻を per 秒ごとに区切った仮の拍) */
export function beatOf(env: Pick<PackEnv, 'beat' | 'lt'>, per = 0.5): { index: number; since: number; len: number } {
  if (env.beat && env.beat.len > 0) return env.beat;
  const index = Math.floor(env.lt / per);
  return { index, since: env.lt - index * per, len: per };
}

export type { PackJ };
