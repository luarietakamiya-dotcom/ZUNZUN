import { beforeAll, expect, it } from 'vitest';
import { installTimingPatch, type JizuraApi } from '../../jizura-adapter';
import { registerMotionPacks } from '../index';
import type { LayoutEnv } from '../design-kit';
import type { PackJ } from '../types';
import { prepareShuPlan, shuClaudePack, toneOf } from './shu';
import { snapIn } from './mv/kit';

let J: JizuraApi & PackJ;
beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (text: string) => ({ width: [...text].length * 60 }) })) as unknown as HTMLCanvasElement['getContext'];
  await import('../../../../../vendor/jizura/jizura-engine.js');
  J = (globalThis as unknown as { J: JizuraApi & PackJ }).J;
  installTimingPatch(J); registerMotionPacks(J);
});

type Call = [string, unknown[]];
function fakeCtx(log: Call[]): CanvasRenderingContext2D {
  return new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : k === 'measureText' ? (s: string) => ({ width: [...s].length * 50 }) : (...a: unknown[]) => { log.push([k, a]); }),
    set: (t, k: string, v) => { log.push([`set:${k}`, [v]]); t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}
const layouts = () => shuClaudePack.effects(J).filter((e) => e.group === 'layout').map((e) => e.def as unknown as { render(env: LayoutEnv): unknown });
function run(v: number, text: string, lt: number, o: { W?: number; H?: number; motion?: number; decor?: number; tail?: boolean; line?: number } = {}) {
  const log: Call[] = [], W = o.W ?? 1920, H = o.H ?? 1080;
  const env = { W, H, lt, t: lt, pIn: 1, pOut: 0, pass: 'main', fx: { motion: o.motion ?? 0.7, decor: o.decor ?? 0.5 }, sc: { fg: '#fff', accent: '#f00' }, ctx: fakeCtx(log),
    cut: { start: 0, dur: 4, inDur: 0.3, outDur: 0.2, line: o.line ?? 1, seed: 9, text, words: text.split(' '), params: { tail: o.tail ?? false } } } as unknown as LayoutEnv;
  const box = layouts()[v]!.render(env);
  return { log, box };
}

it('色は 3 色だけで、隣り合う行の地は必ず違う', () => {
  for (let i = 0; i < 30; i++) expect(toneOf(i)).not.toBe(toneOf(i + 1));
  expect(new Set(Array.from({ length: 9 }, (_, i) => toneOf(i))).size).toBe(3);
});

it('速い入り: 0 で 0、1 で 1、途中で少し行き過ぎても 1.05 を超えない', () => {
  expect(snapIn(0)).toBe(0); expect(snapIn(1)).toBe(1);
  for (let q = 0; q <= 1; q += 0.01) expect(snapIn(q)).toBeLessThan(1.05);
});

it('段取り: 短いすき間は詰めてハードカット、長い間の前と最後だけ帯のワイプ。曲名のカードは自分の構図へ', () => {
  const plan = { cuts: [
    { layout: 'title', start: 0, end: 1, dur: 1, line: -1, text: '曲名', params: {} },
    { layout: 'x', start: 1.2, end: 4, dur: 2.8, line: 0, text: 'a', params: {} },
    { layout: 'x', start: 4.15, end: 8, dur: 3.85, line: 1, text: 'b', params: {} },
    { layout: 'x', start: 12, end: 15, dur: 3, line: 2, text: 'c', params: {} },
  ] };
  prepareShuPlan(plan);
  const c = plan.cuts as unknown as { layout: string; end: number; start: number; params: { tail: boolean }; cam: string }[];
  expect(c[0]!.layout).toBe('vscShuRow'); expect(c[0]!.end).toBe(1.2); expect(c[1]!.end).toBe(4.15);
  expect(c.map((x) => x.params.tail)).toEqual([false, false, true, true]);
  expect(c.every((x) => x.cam === 'vscShuCam')).toBe(true);
});

it('3 構図とも、横長・縦長・短文・長文・英字で有限の座標、同じ入力で同じ描画、影・光を使わない', () => {
  for (const [W, H] of [[1920, 1080], [1080, 1920]] as const) for (const text of ['夜', '月明かりの 下で', 'ほどけた声が 遠くで 鳴った 夜明けの 色を 覚えてる', 'Midnight 光の 向こうへ'])
    for (const lt of [0.02, 0.1, 0.6, 1.5, 3.9]) for (const v of [0, 1, 2]) {
      const a = run(v, text, lt, { W, H, tail: true }), b = run(v, text, lt, { W, H, tail: true });
      expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
      for (const [, args] of a.log) for (const x of args) if (typeof x === 'number') expect(Number.isFinite(x), `${v} ${text} ${lt}`).toBe(true);
      expect(a.log.some(([n, args]) => n === 'set:shadowBlur' && (args[0] as number) > 0)).toBe(false);
    }
});

it('動き 0 は最初から全部が定位置で、残像を描かない。装飾 0 は地を塗らない。主パス以外は描かない', () => {
  const still = run(0, '月明かりの 下で', 0.02, { motion: 0 }), moving = run(0, '月明かりの 下で', 0.02);
  expect(still.log.filter(([n]) => n === 'fillText').length).toBe(7);
  expect(moving.log.filter(([n]) => n === 'fillText').length).toBeLessThan(7);
  const noBg = run(0, '月明かりの 下で', 1, { decor: 0 });
  expect(noBg.log.some(([n]) => n === 'drawImage')).toBe(false);
  const log: Call[] = [];
  layouts()[0]!.render({ W: 1920, H: 1080, lt: 1, pIn: 1, pOut: 0, pass: 'ghost', fx: {}, sc: {}, ctx: fakeCtx(log), cut: { dur: 3, text: '夜', params: {}, line: 0 } } as unknown as LayoutEnv);
  expect(log.length).toBe(0);
});
