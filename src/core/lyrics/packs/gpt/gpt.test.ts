import { beforeAll, expect, it } from 'vitest';
import { defaultLyrics } from '../../../types';
import { buildJizuraProject, installTimingPatch, type JizuraApi } from '../../jizura-adapter';
import { applyMotionPack, packStyles, registerMotionPacks } from '../index';
import { hyperPack } from '../kinetic-packs';
import type { PackJ } from '../types';
import { gptHyperPack } from './index';
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
  for (const aspect of ['16:9', '9:16'] as const) for (const text of ['光を追う', '小さな声を集めて夜明けの向こうへ走り出す']) {
    const lyrics = defaultLyrics(); lyrics.text = text;
    lyrics.timing.lineTimes = { '0': 1 }; lyrics.motion.style = gptHyperPack.styleKey;
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
      for (const group of ['layout', 'enter', 'hold', 'exit', 'cam'] as const) expect(J.registry(group)[cut[group]]?.pack).toBe(gptHyperPack.id);
      expect(cut.decor).toEqual([]);
    }
  }
});
