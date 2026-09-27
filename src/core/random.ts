/**
 * 決定論的な乱数生成 (mulberry32) とハッシュ。
 * アルゴリズムの選定は 852wa/JIZURA (MIT License, https://github.com/852wa/JIZURA) の
 * src/01_util.js (J.rng, J.h) を参考にしている。実装はゼロから書き起こし。
 *
 * ZUNZUN では描画中に Math.random() を使わない。project.seed からプリセットごとに
 * 派生させた rng だけを使うことで、同じ project.json は常に同じ絵になる。
 */

export type Rng = (() => number) & {
  range(lo: number, hi: number): number;
  int(lo: number, hi: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
};

/** 32bit 整数シードから決定論的な乱数ストリームを作る。 */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = next as Rng;
  rng.range = (lo, hi) => lo + (hi - lo) * next();
  rng.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next());
  rng.pick = (arr) => arr[Math.floor(next() * arr.length) % arr.length] as (typeof arr)[number];
  rng.chance = (p) => next() < p;
  return rng;
}

/** 文字列 -> uint32 の FNV-1a ハッシュ。プリセット id から派生シードを作るのに使う。 */
export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** ベースの seed とプリセット id から、プリセット専用の派生 seed を作る。 */
export function deriveSeed(baseSeed: number, salt: string): number {
  return (baseSeed ^ hashString(salt)) >>> 0;
}
