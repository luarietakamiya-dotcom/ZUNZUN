import { beforeAll, expect, it } from 'vitest';
import { defaultLyrics } from '../../types';
import { buildJizuraProject, installTimingPatch, type JizuraApi } from '../jizura-adapter';
import { applyMotionPack, registerMotionPacks } from './index';
import { simplePack, terminalPack, constellationPack } from './fresh-packs';
import type { PackJ, PackItem, PackEnv } from './types';
import type { LayoutEnv } from './design-kit';
let J: JizuraApi & PackJ;
beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (text: string) => ({ width: [...text].length * 60 }) })) as unknown as HTMLCanvasElement['getContext'];
  await import('../../../../vendor/jizura/jizura-engine.js');
  J = (globalThis as unknown as { J: JizuraApi & PackJ }).J;
  installTimingPatch(J); registerMotionPacks(J);
});
const packs = [simplePack, terminalPack, constellationPack];
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
        const env = { W, H, lt: 0.5, pIn: 0.5, pOut: 0, pass: 'main', sc: { fg: '#ffffff', accent: '#aaccff' }, cut: { params, text: '長い歌詞も折り返して画面の中に収める。'.repeat(4) }, line: () => {}, circle: () => {} } as unknown as LayoutEnv;
        def.render(env);
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) for (const key of ['x', 'y', 'size']) expect(Number.isFinite(item[key])).toBe(true);
        for (const item of items) { expect(item.x).toBeGreaterThan(0); expect(item.x).toBeLessThan(W!); expect(item.y).toBeGreaterThan(0); expect(item.y).toBeLessThan(H!); }
      } finally { J.mainDraw = old; }
    }
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
