import { beforeAll, expect, it } from 'vitest';
import { defaultLyrics } from '../../../types';
import { buildJizuraProject, installTimingPatch, type JizuraApi } from '../../jizura-adapter';
import { applyMotionPack, packStyles, registerMotionPacks } from '../index';
import { hyperPack } from '../kinetic-packs';
import type { LayoutEnv } from '../design-kit';
import type { PackJ, PackEnv, PackItem } from '../types';
import { gptHyperPack, GPT_PACKS } from './index';
let J: JizuraApi & PackJ;
beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (text: string) => ({ width: [...text].length * 60 }) })) as unknown as HTMLCanvasElement['getContext'];
  await import('../../../../../vendor/jizura/jizura-engine.js');
  J = (globalThis as unknown as { J: JizuraApi & PackJ }).J;
  installTimingPatch(J); registerMotionPacks(J);
});
it('GPT版と既存版は別々に選べ、登録先と演出キーが衝突しない', () => {
  expect(packStyles(J)).toContainEqual(['vs-hyper.g', 'ハイパー・ビート.g']);
  expect(J.STYLES[hyperPack.styleKey]!.name).toBe('ハイパー・ビート (VisualSync)');
  expect(gptHyperPack.id).toMatch(/\.g$/);
  const oldKeys = new Set(hyperPack.effects(J).map(e => e.key));
  for (const e of gptHyperPack.effects(J)) {
    expect(e.key).toMatch(/^vsg/); expect(oldKeys.has(e.key)).toBe(false);
    expect(J.registry(e.group)[e.key]?.pack).toBe(gptHyperPack.id);
  }
});
it('横長・縦長、短文・長文、動き/装飾0の計画でも自分の演出だけを再現する', () => {
  for (const pack of GPT_PACKS) for (const aspect of ['16:9', '9:16'] as const) for (const text of ['光を追う', '小さな声を集めて夜明けの向こうへ走り出す']) {
    const lyrics = defaultLyrics(); lyrics.text = text;
    lyrics.timing.lineTimes = { '0': 1 }; lyrics.motion.style = pack.styleKey;
    const make = () => {
      const project = buildJizuraProject(lyrics, J.defaultProject(), { seed: 5, aspect, fps: 30 });
      applyMotionPack(project, lyrics.motion, J);
      project.fx = { ...(project.fx as Record<string, unknown>), motion: 0, decor: 0 };
      return J.plan(project, { duration: 5, beats: [], energy: new Float32Array(300), energyRate: 60 });
    };
    const plan = make(); expect(JSON.stringify(make())).toBe(JSON.stringify(plan));
    const cuts = plan.cuts as { line: number; layout: string; enter: string; hold: string; exit: string; cam: string; decor: unknown[] }[];
    expect(cuts.filter(c => c.line >= 0).length).toBeGreaterThan(0);
    for (const cut of cuts.filter(c => c.line >= 0)) {
      for (const group of ['layout', 'enter', 'hold', 'exit', 'cam'] as const) expect(J.registry(group)[cut[group]]?.pack).toBe(pack.id);
      expect(cut.decor).toEqual([]);
    }
  }
});

it('6つのGPTスタイルは名前・保存キー・部品セットが独立し、登録キーを共有しない', () => {
  expect(GPT_PACKS).toHaveLength(6);
  for (const field of ['id', 'styleKey', 'set'] as const) expect(new Set(GPT_PACKS.map(p => p[field])).size).toBe(6);
  const keys = GPT_PACKS.flatMap(p => p.effects(J).map(e => e.key));
  expect(new Set(keys).size).toBe(keys.length);
  for (const p of GPT_PACKS) { expect(p.buildStyle(J).name).toMatch(/\.g$/); expect(p.styleKey).toMatch(/\.g$/); }
});
it('全18構図は横縦・短長文・飾り0でも本文を描き、有限の枠内座標を使う', () => {
  const old = J.mainDraw;
  try {
    for (const pack of GPT_PACKS) for (const e of pack.effects(J).filter(e => e.group === 'layout')) {
      for (const [W, H] of [[1920, 1080], [1080, 1920]]) for (const text of ['夜', '小さな声を集めて夜明けの向こうへ走り出す'.repeat(3)]) for (const decor of [0, .8]) {
        const body: Record<string, unknown>[] = [], decorations: unknown[] = [];
        J.mainDraw = (_env, item) => { body.push(item); return null; };
        const env = { W, H, lt: 1, t: 1, pIn: 1, pOut: 0, pass: 'main', fx: { motion: 0, decor },
          sc: { fg: '#ffffff', accent: '#ff00aa', accent2: '#00ffff' }, cut: { text, line: 0, params: { side: 1 } },
          rect: () => {}, circle: (...a: unknown[]) => decorations.push(a), line: (...a: unknown[]) => decorations.push(a), draw: (...a: unknown[]) => decorations.push(a) } as unknown as LayoutEnv;
        (e.def.render as (e: LayoutEnv) => unknown)(env);
        expect(body.length).toBeGreaterThan(0);
        for (const b of body) for (const key of ['size', 'x', 'y']) expect(Number.isFinite(b[key])).toBe(true);
        for (const b of body) { expect(b.x).toBeGreaterThan(0); expect(b.x).toBeLessThan(W!); expect(b.y).toBeGreaterThan(0); expect(b.y).toBeLessThan(H!); }
        if (decor === 0) expect(decorations).toEqual([]);
      }
    }
  } finally { J.mainDraw = old; }
});
it('動き0で本文の移動・回転・拡大を止め、文字色の拍点滅をしない', () => {
  for (const pack of GPT_PACKS) for (const effect of pack.effects(J).filter(e => ['enter', 'hold', 'exit'].includes(e.group))) {
    const it: PackItem = { size: 100, charFns: [] };
    (effect.def.apply as (env: PackEnv, it: PackItem, p: number) => void)({ lt: 1, fx: { motion: 0 } } as PackEnv, it, .6);
    for (const fn of it.charFns) for (let i = 0; i < 6; i++) {
      const v = fn(i, { i }, 6)!;
      for (const field of ['dx', 'dy', 'rot'] as const) expect(v[field] ?? 0).toBeCloseTo(0);
      expect(v.s ?? 1).toBe(1); expect(v.color).toBeUndefined();
    }
  }
});

it('HyperとRushは1語を複数の主役へ切り分けない', () => {
  const old = J.mainDraw;
  try {
    for (const pack of GPT_PACKS.filter(p => ['vs-hyper.g', 'vs-rush.g'].includes(p.styleKey))) {
      for (const e of pack.effects(J).filter(e => e.group === 'layout' && !e.def.compatibility)) {
        const body: Record<string, unknown>[] = [];
        J.mainDraw = (_env, item) => { body.push(item); return null; };
        const env = { W: 1920, H: 1080, lt: 1, t: 1, pIn: 1, pOut: 0, pass: 'main', fx: { motion: 0, decor: 0 },
          sc: { fg: '#fff', accent: '#f00' }, cut: { text: '止まらない', words: ['止まらない'], line: 0, params: {} },
          rect() {}, circle() {}, line() {}, draw() {} } as unknown as LayoutEnv;
        (e.def.render as (e: LayoutEnv) => unknown)(env);
        expect(body).toHaveLength(1);
        expect(String(body[0]!.text).replace(/\n/g, '')).toBe('止まらない');
      }
    }
  } finally { J.mainDraw = old; }
});
