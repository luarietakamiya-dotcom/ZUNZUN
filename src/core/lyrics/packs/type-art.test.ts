import { beforeAll, expect, it } from 'vitest';
import { defaultLyrics } from '../../types';
import { buildJizuraProject, installTimingPatch, type JizuraApi } from '../jizura-adapter';
import { applyMotionPack, registerMotionPacks } from './index';
import { directTypeArtPlan } from './type-art-plan';
import { typeArtLayouts } from './layouts/type-art';
import type { LayoutEnv } from './design-kit';
import type { PackBox, PackJ } from './types';
let J: JizuraApi & PackJ;
beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (text: string) => ({ width: [...text].length * 60 }) })) as unknown as HTMLCanvasElement['getContext'];
  await import('../../../../vendor/jizura/jizura-engine.js');
  J = (globalThis as unknown as { J: JizuraApi & PackJ }).J;
  installTimingPatch(J); registerMotionPacks(J);
});
it('実エンジンの分割を保ち、同じ行の組版・時計・文字の出現時刻を共有する', () => {
  for (const style of ['vs-hyper', 'vs-gothic']) {
    const lyrics = defaultLyrics(); lyrics.motion.style = style;
    lyrics.text = '光を追いかけて\n夜空に描いた言葉を君の明日まで届けたい';
    lyrics.timing.lineTimes = { '0': 0.4, '1': 4.4 }; lyrics.timing.lineEnds = { '0': 4.3, '1': 8.3 };
    const make = () => {
      const project = buildJizuraProject(lyrics, J.defaultProject(), { seed: 41, aspect: '16:9', fps: 30 });
      applyMotionPack(project, lyrics.motion, J);
      return directTypeArtPlan(J.plan(project, { duration: 9, beats: [], energy: new Float32Array(540), energyRate: 60 }), lyrics.motion);
    };
    const cuts = make().cuts as { line: number; start: number; end: number; params: Record<string, unknown>; layout: string; trans: string; morph: unknown }[];
    expect(cuts.length).toBeGreaterThan(2); expect(make().cuts).toEqual(cuts);
    for (const line of [0, 1]) {
      const group = cuts.filter(c => c.line === line);
      expect(new Set(group.map(c => c.layout)).size).toBe(1);
      for (const c of group) {
        expect(c.params.artStart).toBe(group[0]!.start); expect(c.params.artEnd).toBe(group.at(-1)!.end);
        expect(c.params.artText).toBe(lyrics.text.split('\n')[line]); expect(c.params.artTimes).toEqual(group[0]!.params.artTimes);
        expect(c.trans).toBe('none'); expect(c.morph).toBeNull();
      }
    }
  }
});
it('手編集・固定した行と他のスタイルを変更しない。本文変更後の古い指定は除外する', () => {
  const lyrics = defaultLyrics(); lyrics.motion.style = 'vs-hyper';
  const original = { line: 0, lineText: '歌え', text: '歌え', start: 1, end: 3, layout: 'vsHyperHero', params: {} };
  for (const override of [{ text: '歌え', lock: true }, { text: '歌え', enter: 'cut' }]) {
    lyrics.motion.lines = { '0': override }; const plan = { cuts: [structuredClone(original)] };
    directTypeArtPlan(plan, lyrics.motion); expect(plan.cuts[0]).toEqual(original);
  }
  lyrics.motion.lines = { '0': { text: '古い本文', lock: true } };
  expect(directTypeArtPlan({ cuts: [structuredClone(original)] }, lyrics.motion).cuts[0]!.params).toHaveProperty('artText', '歌え');
  lyrics.motion.style = 'vs-summer';
  expect(directTypeArtPlan({ cuts: [structuredClone(original)] }, lyrics.motion).cuts[0]).toEqual(original);
});

function render(theme: 'Hyper' | 'Gothic', variant: number, text: string, W: number, H: number, t: number, motion: number, decor: number) {
  const items: Record<string, unknown>[] = [], marks: unknown[] = [];
  const draw = (item: Record<string, unknown>): PackBox => {
    items.push(item); const m = J.measure(item);
    return { x0: Number(item.x) - m.w / 2, x1: Number(item.x) + m.w / 2, y0: Number(item.y) - m.h / 2, y1: Number(item.y) + m.h / 2 };
  };
  const ctx = { save() {}, restore() {}, fillRect: (...args: unknown[]) => marks.push(args), createLinearGradient: () => ({ addColorStop() {} }) };
  const env = { W, H, t, lt: t, pass: 'main', ctx, draw, fx: { motion, decor }, cut: { start: 0, dur: 4, text, params: { artText: text, artStart: 0, artEnd: 4 } } } as unknown as LayoutEnv;
  (typeArtLayouts(J, theme)[variant]!.def.render as (env: LayoutEnv) => unknown)(env);
  return { items, marks };
}
it('全6構図の本文は短文・長文・縦横で枠内。影の後に白い本文を描く', () => {
  for (const theme of ['Hyper', 'Gothic'] as const) for (let variant = 0; variant < 3; variant++) {
    for (const text of ['光', '歌え', '夜空に描いた言葉を君の明日まで届けたい']) for (const [W, H] of [[1920, 1080], [1080, 1920]]) {
      for (const t of [0.1, 0.5, 1.8, 3.9]) {
        const r = render(theme, variant, text, W!, H!, t, 1, 1), bodies = r.items.filter(i => i.color === '#FFFFFF');
        expect(bodies.length).toBe([...text].length); expect(r.items.slice(-bodies.length)).toEqual(bodies);
        for (const body of bodies) {
          const m = J.measure(body);
          expect(Number(body.x) - m.w / 2).toBeGreaterThanOrEqual(-0.001);
          expect(Number(body.x) + m.w / 2).toBeLessThanOrEqual(W! + 0.001);
          expect(Number(body.y) - m.h / 2).toBeGreaterThanOrEqual(-0.001);
          expect(Number(body.y) + m.h / 2).toBeLessThanOrEqual(H! + 0.001);
          for (const key of ['x', 'y', 'sx', 'sy', 'alpha']) expect(Number.isFinite(body[key])).toBe(true);
        }
      }
    }
  }
});
it('動き0は幾何を固定し、装飾0は影と光柱を消す。同時刻の描画は決定論的', () => {
  for (const theme of ['Hyper', 'Gothic'] as const) for (let variant = 0; variant < 3; variant++) {
    const a = render(theme, variant, '歌え', 640, 360, 0.5, 0, 1), b = render(theme, variant, '歌え', 640, 360, 1.8, 0, 1);
    const geometry = (r: typeof a) => r.items.map(({ x, y, sx, sy }) => ({ x, y, sx, sy }));
    expect(geometry(a)).toEqual(geometry(b)); expect(a).toEqual(render(theme, variant, '歌え', 640, 360, 0.5, 0, 1));
    const plain = render(theme, variant, '歌え', 640, 360, 0.5, 1, 0);
    expect(plain.items.length).toBe(2); expect(plain.marks.length).toBe(0);
  }
});

it('新しい行アートを固定した後も、登場/表示中/退場の手指定を描画経路へ渡す', () => {
  const lyrics = defaultLyrics(); lyrics.motion.style = 'vs-hyper';
  lyrics.motion.lines = { '0': { text: '歌え', lock: true, enter: 'cut' } };
  const cut = { line: 0, lineText: '歌え', text: '歌え', start: 1, end: 3, layout: 'vsHyperHero', params: { artText: '歌え', artStart: 1, artEnd: 3 } };
  directTypeArtPlan({ cuts: [cut] }, lyrics.motion);
  expect(cut.params).toHaveProperty('artManual', true);
  expect(cut.params.artText).toBe('歌え');
  const old = J.mainDraw, drawn: string[] = [];
  J.mainDraw = (env, item) => { expect((env as LayoutEnv).cut).toBe(cut); drawn.push(String(item.text)); return null; };
  try {
    const env = { W: 640, H: 360, t: 2, lt: 1, pass: 'main', fx: { motion: 1, decor: 0 }, cut, draw: () => { throw new Error('手編集はmainDrawへ'); } } as unknown as LayoutEnv;
    (typeArtLayouts(J, 'Hyper')[0]!.def.render as (env: LayoutEnv) => unknown)(env);
    expect(drawn).toEqual(['歌', 'え']);
  } finally { J.mainDraw = old; }
});
