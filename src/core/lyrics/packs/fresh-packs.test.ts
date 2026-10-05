import { beforeAll, expect, it } from 'vitest';
import { defaultLyrics } from '../../types';
import { buildJizuraProject, installTimingPatch, type JizuraApi } from '../jizura-adapter';
import { applyMotionPack, registerMotionPacks } from './index';
import { simplePack, terminalPack, constellationPack } from './fresh-packs';
import { KINETIC_PACKS, smallFlowPack, bigTypePack, gothicPack } from './kinetic-packs';
import { artDirectedLayouts, directedCamera } from './art-directed-layouts';
import type { PackJ, PackItem, PackEnv } from './types';
import type { LayoutEnv } from './design-kit';
let J: JizuraApi & PackJ;
beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (text: string) => ({ width: [...text].length * 60 }) })) as unknown as HTMLCanvasElement['getContext'];
  await import('../../../../vendor/jizura/jizura-engine.js');
  J = (globalThis as unknown as { J: JizuraApi & PackJ }).J;
  installTimingPatch(J); registerMotionPacks(J);
});
const packs = [simplePack, terminalPack, constellationPack, ...KINETIC_PACKS];
it('6テーマに3つずつ異なる構図があり、強さ0ではカメラも固定される', () => {
  for (const theme of ['Hyper', 'Summer', 'Winter', 'Gothic', 'Terminal', 'Constellation'] as const) {
    const layouts = artDirectedLayouts(J, theme);
    expect(new Set(layouts.map(e => e.key)).size).toBe(3);
    const get = directedCamera(theme).def.get as (env: PackEnv) => { s: number; x: number; y: number; rot: number };
    const env = { W: 1920, H: 1080, lt: 1, cut: { dur: 4 }, fx: { motion: 0 } } as PackEnv;
    const atRest = get(env);
    expect(atRest.s).toBe(1); expect(atRest.x).toBeCloseTo(0); expect(atRest.y).toBe(0); expect(atRest.rot).toBe(0);
    for (const t of [0, 0.1, 1, 3.9]) for (const v of Object.values(get({ ...env, lt: t, fx: { motion: 1 } }))) expect(Number.isFinite(v)).toBe(true);
  }
});
it('各系統が独立した部品セットを持ち、同じseedで同じ演出を生成する', () => {
  for (const pack of packs) {
    const lyrics = defaultLyrics();
    lyrics.text = 'この歌を君に届けよう\n星の光をたどって\n夜明けまで歩こう';
    lyrics.timing.lineTimes = { '0': 1, '1': 5, '2': 9 };
    lyrics.motion.style = pack.styleKey;
    const make = () => {
      const project = buildJizuraProject(lyrics, J.defaultProject(), { seed: 5, aspect: '16:9', fps: 30 });
      applyMotionPack(project, lyrics.motion, J);
      return J.plan(project, { duration: 13, beats: [], energy: new Float32Array(780), energyRate: 60 });
    };
    const plan = make(); expect(JSON.stringify(make())).toBe(JSON.stringify(plan));
    const cuts = plan.cuts as { line: number; layout: string; enter: string; hold: string; exit: string; cam: string; decor: unknown[] }[];
    for (const cut of cuts.filter(c => c.line >= 0)) {
      for (const group of ['layout', 'enter', 'hold', 'exit', 'cam'] as const) {
        expect(J.registry(group)[cut[group]]?.pack, `${pack.id}/${group}/${cut[group]}`).toBe(pack.id);
      }
      expect(cut.decor).toEqual([]);
    }
  }
});
it('全レイアウトが横長・縦長と長い歌詞で有限の座標とサイズを描く', () => {
  for (const pack of packs) for (const effect of pack.effects(J).filter(e => e.group === 'layout')) {
    const def = effect.def as unknown as { plan: (...args: unknown[]) => Record<string, unknown>; render: (env: LayoutEnv) => unknown };
    const rng = { pick: (a: unknown[]) => a[0], range: (a: number, b: number) => (a + b) / 2 };
    const params = def.plan(rng, {}, { fonts: { body: ['gothic_med'] } });
    for (const [W, H] of [[1920, 1080], [1080, 1920]]) {
      const items: Record<string, unknown>[] = [];
      const old = J.mainDraw;
      J.mainDraw = (_env, item) => { items.push(item); return { x0: 100, x1: 200, y0: 100, y1: 180 }; };
      try {
        const env = { W, H, lt: 0.5, pIn: 0.5, pOut: 0, pass: 'main', fx: { motion: 0.7, decor: 0.5 }, sc: { fg: '#ffffff', accent: '#aaccff' }, t: 0.5, ctx: {}, draw: (item: Record<string, unknown>) => item.color === '#FFFFFF' ? J.mainDraw({}, item) : null, cut: { start: 0, dur: 4, params, text: '長い歌詞も折り返して画面の中に収める。'.repeat(4) }, line: () => {}, circle: () => {} } as unknown as LayoutEnv;
        def.render(env);
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) for (const key of ['x', 'y', 'size']) expect(Number.isFinite(item[key])).toBe(true);
        for (const item of items) { expect(item.x).toBeGreaterThan(0); expect(item.x).toBeLessThan(W!); expect(item.y).toBeGreaterThan(0); expect(item.y).toBeLessThan(H!); }
      } finally { J.mainDraw = old; }
    }
  }
});
it('小さく流れる文字と大きく動く文字のサイズ差が明確で、ゴシックは無彩色', () => {
  const sizes: number[] = [], old = J.mainDraw;
  J.mainDraw = (_env, item) => { sizes.push(Number(item.size)); return null; };
  try {
    for (const pack of [smallFlowPack, bigTypePack]) {
      const def = pack.effects(J).find(e => e.group === 'layout')!.def;
      (def.render as (env: LayoutEnv) => unknown)({ W: 1920, H: 1080, cut: { text: '歌え', params: { side: 1 } }, sc: { fg: '#ffffff' } } as unknown as LayoutEnv);
    }
    expect(sizes[1]!).toBeGreaterThan(sizes[0]! * 3);
  } finally { J.mainDraw = old; }
  const schemes = gothicPack.buildStyle(J).schemes as Record<string, string>[];
  for (const color of Object.values(schemes[0]!)) expect(color.slice(1, 3)).toBe(color.slice(3, 5));
});
it('6系統の動きは進行の両端で閉じ、強さ0で移動・回転・拡大を止められる', () => {
  for (const pack of KINETIC_PACKS) for (const e of pack.effects(J).filter(e => ['enter', 'hold', 'exit'].includes(e.group))) {
    const apply = e.def.apply as (env: PackEnv, it: PackItem, p: number) => void;
    for (const motion of [0, 1]) for (const p of [0, 0.25, 0.5, 1]) {
      const it: PackItem = { size: 100, alpha: 1, charFns: [] };
      apply({ lt: 0.5, fx: { motion }, sc: { fg: '#ffffff', accent: '#ff00aa' } } as PackEnv, it, p);
      for (let i = 0; i < 7; i++) for (const fn of it.charFns) {
        const mod = fn(i, { i }, 7);
        for (const val of Object.values(mod ?? {})) if (typeof val === 'number') expect(Number.isFinite(val), e.key).toBe(true);
        if (motion === 0) {
          expect(mod?.dx ?? 0, e.key).toBeCloseTo(0); expect(mod?.dy ?? 0, e.key).toBeCloseTo(0); expect(mod?.rot ?? 0, e.key).toBeCloseTo(0); expect(mod?.s ?? 1, e.key).toBe(1);
        }
        if (e.group === 'enter' && p === 1) expect(mod?.a ?? 1, e.key).toBe(1);
        if (e.group === 'exit' && p === 1) expect(mod?.a ?? 1, e.key).toBe(0);
      }
    }
  }
});
it('夏・冬・ゴシックの飾りは同じseedで同じ形を描き、装飾0で消せる', () => {
  for (const pack of KINETIC_PACKS.filter(p => ['vs-summer', 'vs-winter'].includes(p.styleKey))) {
    const def = pack.effects(J).find(e => e.group === 'layout')!.def;
    const render = def.render as (env: LayoutEnv) => unknown;
    const make = (decor: number) => {
      const marks: unknown[][] = [], old = J.mainDraw;
      J.mainDraw = () => null;
      try {
        render({ W: 1920, H: 1080, lt: 0.4, pIn: 1, pOut: 0, pass: 'main', fx: { motion: 0.7, decor }, sc: { fg: '#ffffff', accent: '#aabbff' }, cut: { seed: 8, text: '歌え', params: { side: 1 } }, line: (...args: unknown[]) => marks.push(['line', ...args]), circle: (...args: unknown[]) => marks.push(['circle', ...args]) } as unknown as LayoutEnv);
      } finally { J.mainDraw = old; }
      return marks;
    };
    const marks = make(1); expect(marks.length).toBeGreaterThan(0); expect(make(1)).toEqual(marks);
    for (const mark of make(0)) expect(mark[mark[0] === 'line' ? 4 : 7], pack.id).toBe(0);
  }
});
it('入力・削除が文字数に従い、フェードが先頭と末尾で正しく閉じる', () => {
  const effects = terminalPack.effects(J);
  const env = { fx: { motion: 1 } } as PackEnv;
  const item = (): PackItem => ({ size: 30, alpha: 1, charFns: [] });
  const apply = (key: string, p: number) => {
    const it = item();
    (effects.find(e => e.key === key)!.def.apply as (env: PackEnv, it: PackItem, p: number) => void)(env, it, p);
    return it;
  };
  expect(apply('vsConsoleType', 0).charFns[0]!(0, { i: 0 }, 5)).toMatchObject({ hide: true });
  expect(apply('vsConsoleType', 1).charFns[0]!(4, { i: 4 }, 5)).toMatchObject({ hide: false });
  expect(apply('vsConsoleErase', 1).charFns[0]!(0, { i: 0 }, 5)).toMatchObject({ hide: true });
  expect(apply('vsCleanOutTerminal', 1).alpha).toBe(0);
});
