import { beforeAll, expect, it } from 'vitest';
import { buildJizuraProject, installTimingPatch, type JizuraApi } from '../../jizura-adapter';
import { registerMotionPacks } from '../index';
import type { LayoutEnv } from '../design-kit';
import type { PackJ } from '../types';
import { layGlyphs, lines, moonFeatherClaudePack, prepareMoonPlan } from './moonfeather';

let J: JizuraApi & PackJ;
beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (text: string) => ({ width: [...text].length * 60 }) })) as unknown as HTMLCanvasElement['getContext'];
  await import('../../../../../vendor/jizura/jizura-engine.js');
  J = (globalThis as unknown as { J: JizuraApi & PackJ }).J;
  installTimingPatch(J); registerMotionPacks(J);
  void buildJizuraProject;
});

type Call = [string, unknown[]];
/** 呼び出しを記録するだけの描画面。clip の四角と、描いた座標を調べる */
function fakeCtx(log: Call[]): CanvasRenderingContext2D {
  const grad = { addColorStop() {} };
  return new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : k.startsWith('create') ? () => grad : (...a: unknown[]) => { log.push([k, a]); }),
    set: (t, k: string, v) => { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}
const def = () => moonFeatherClaudePack.effects(J).filter((e) => e.group === 'layout').map((e) => e.def as unknown as { render(env: LayoutEnv): unknown; plan(r: unknown): Record<string, unknown> });

function run(text: string, lt: number, opt: { motion?: number; decor?: number; W?: number; H?: number; moon?: number; layout?: number } = {}) {
  const log: Call[] = [], W = opt.W ?? 1920, H = opt.H ?? 1080, d = def()[opt.layout ?? 0]!;
  const env = { W, H, lt, t: lt, pIn: 1, pOut: 0, pass: 'main', fx: { motion: opt.motion ?? 0.7, decor: opt.decor ?? 0.5 }, sc: { fg: '#fff', accent: '#f3e4b0', accent2: '#efe6d2' }, ctx: fakeCtx(log),
    cut: { start: 0, dur: 3, inDur: 0.4, outDur: 0.4, line: 0, seed: 7, text, params: { ...d.plan({}), moon: opt.moon ?? 1, waxing: true } } } as unknown as LayoutEnv;
  const box = d.render(env);
  return { log, box, W, H };
}

it('区切りの種類で月が変わる: イントロは三日月、サビは満月、見出しが無ければ曲の進みで満ちて欠ける', () => {
  const plan = { cuts: [{ start: 1, layout: 'x', params: {} }, { start: 30, layout: 'x', params: {} }, { start: 90, layout: 'x', params: {} }] };
  prepareMoonPlan(plan, [{ kind: 'intro', label: '', start: 0, end: 10 }, { kind: 'chorus', label: '', start: 20, end: 60 }], 100);
  const [a, b, c] = plan.cuts as unknown as { params: { moon: number; waxing: boolean }; cam: string; bg: string }[];
  expect(a!.params.moon).toBeLessThan(0.2); expect(b!.params.moon).toBe(1); expect(c!.params.moon).toBeGreaterThan(0); expect(a!.cam).toBe('vscMfCam'); expect(a!.bg).toBe('none');
  const ramp = { cuts: [{ start: 1 }, { start: 60 }, { start: 99 }] };
  prepareMoonPlan(ramp, [], 100);
  const m = (ramp.cuts as unknown as { params: { moon: number; waxing: boolean } }[]).map((x) => x.params);
  expect(m[1]!.moon).toBeGreaterThan(m[0]!.moon); expect(m[1]!.moon).toBeGreaterThan(m[2]!.moon); expect(m[2]!.waxing).toBe(false);
});

it('文字は字幕の帯の中に並び、語ごとに上下が替わる（かなの語は前と逆）', () => {
  for (const text of ['止まらない鼓動が夜を切り裂いてもっと高く叫べ', 'Hello 世界 あおぞら']) {
    const rows = lines(text), size = 60, gl = layGlyphs(J, rows, size, 1920, 1080, 5);
    expect(gl.length).toBe([...text.replace(/ /g, '')].length);
    for (const g of gl) { expect(g.x).toBeGreaterThan(1920 * 0.06); expect(g.x).toBeLessThan(1920 * 0.94); expect(g.y).toBeGreaterThan(1080 * 0.77); expect(g.y).toBeLessThan(1080 * 0.93); }
  }
  const g = layGlyphs(J, ['夜をこえて空へ'], 60, 1920, 1080, 3), kana = g.filter((x) => 'をこえてへ'.includes(x.ch));
  expect(new Set(g.map((x) => x.dir)).size).toBe(2);
  expect(kana.length).toBeGreaterThan(0);
});

it('描画は帯で clip され、座標は有限。同じ入力なら同じ呼び出し（決定論）', () => {
  for (const [W, H] of [[1920, 1080], [1080, 1920], [1280, 400]] as const) for (const text of ['夜', '止まらない鼓動が夜を切り裂いてもっと高く叫べ光の向こうへ今すぐここで', 'Moonlight 羽根の夜'])
    for (const lt of [0.05, 0.5, 1.4, 2.6]) for (const layout of [0, 1]) {
      const a = run(text, lt, { W, H, layout }), b = run(text, lt, { W, H, layout });
      expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
      const clip = a.log.find(([n]) => n === 'rect')!;
      expect(clip[1]).toEqual([W * 0.06, H * 0.77, W * 0.88, H * 0.16]);
      for (const [, args] of a.log) for (const v of args) if (typeof v === 'number') expect(Number.isFinite(v), `${text} ${lt}`).toBe(true);
    }
});

it('動き 0 は文字が定位置で止まり羽根を出さない。装飾 0 は羽根を出さない。主パス以外は何も描かない', () => {
  const still = run('止まらない夜', 0.05, { motion: 0 }), moving = run('止まらない夜', 0.05, {}), noDecor = run('止まらない夜', 2, { decor: 0 }), withDecor = run('止まらない夜', 2, { decor: 1 });
  expect(still.log.some(([n]) => n === 'bezierCurveTo')).toBe(false);
  expect(still.log.filter(([n]) => n === 'fillText').length).toBe(6);
  const ys = (r: { log: Call[] }) => r.log.filter(([n]) => n === 'fillText').map(([, a]) => a[2]);
  expect(JSON.stringify(ys(moving))).not.toBe(JSON.stringify(ys(still)));
  expect(noDecor.log.some(([n]) => n === 'bezierCurveTo')).toBe(false);
  expect(withDecor.log.some(([n]) => n === 'bezierCurveTo')).toBe(true);
  const d = def()[0]!, log: Call[] = [];
  d.render({ W: 1920, H: 1080, lt: 1, pIn: 1, pOut: 0, pass: 'ghost', fx: {}, sc: { fg: '#fff', accent: '#fff' }, ctx: fakeCtx(log), cut: { dur: 3, text: '夜', params: {} } } as unknown as LayoutEnv);
  expect(log.length).toBe(0);
});
