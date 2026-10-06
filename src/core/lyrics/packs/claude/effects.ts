import type { CharMod, PackEffect, PackEnv, PackItem } from '../types';
import { staggered } from '../util';
import { cap } from './skin';

/** Claude 版の動き（登場・退場・表示中）を作る小さな工場。強さ（fx.motion）0 で動かない。 */
const strength = (env: PackEnv): number => cap(env.fx.motion ?? 0.7);
type Fn = (q: number, i: number, n: number, it: PackItem, k: number) => CharMod;

/** 登場: 文字 i が spread の割合だけ遅れて始まる。q は 0..1（イージングは fn の中で） */
export function enterFx(key: string, name: string, seconds: number, spread: number, fn: Fn): PackEffect {
  return { group: 'enter', key, def: { name, inDur: (dur: number) => Math.min(seconds, dur * 0.4), apply(env: PackEnv, it: PackItem, p: number) {
    const k = strength(env);
    it.charFns.push((i, _g, n) => fn(staggered(cap(p), i, n, spread), i, n, it, k));
  } } };
}

export function exitFx(key: string, name: string, seconds: number, spread: number, fn: Fn): PackEffect {
  return { group: 'exit', key, def: { name, outDur: (dur: number) => Math.min(seconds, dur * 0.3), apply(env: PackEnv, it: PackItem, p: number) {
    const k = strength(env);
    it.charFns.push((i, _g, n) => fn(staggered(cap(p), i, n, spread), i, n, it, k));
  } } };
}

/** 表示中: amt は 0..1（登場が終わるまでの立ち上がり）。t はカットの中の秒 */
export function holdFx(key: string, name: string, fn: (t: number, amt: number, i: number, n: number, it: PackItem, k: number, env: PackEnv) => CharMod): PackEffect {
  return { group: 'hold', key, def: { name, apply(env: PackEnv, it: PackItem, amt: number) {
    const k = strength(env);
    it.charFns.push((i, _g, n) => fn(env.lt, amt, i, n, it, k, env));
  } } };
}

export const easeOutBackQ = (x: number, k = 1.6): number => 1 + (k + 1) * (x - 1) ** 3 + k * (x - 1) ** 2;
