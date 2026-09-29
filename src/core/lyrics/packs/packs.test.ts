import { beforeAll, describe, expect, it } from 'vitest';
import { CUSTOM_STYLE_KEY, defaultLyrics, type LyricsSettings } from '../../types';
import { buildJizuraProject, installTimingPatch, type JizuraApi } from '../jizura-adapter';
import { CALM_STYLE_KEY } from './calm';
import { applyMotionPack, packForMotion, PACKS, registerMotionPacks } from './index';
import type { PackJ } from './types';

/**
 * オリジナルの歌詞モーション (演出パック) を、同梱した本物の JIZURA (jsdom) で確かめる。
 * - 登録しても既存のスタイルのカット割りは 1 つも変わらない
 * - パックのスタイルでは、オリジナルの演出が使われ、パックの決まりに合わない JIZURA の演出は使われない
 */

let J: JizuraApi & PackJ;

beforeAll(async () => {
  // JIZURA は読み込み時に文字の幅を測るための canvas を作る。jsdom には canvas が無いので空の getContext にする (jizura-compat.test.ts と同じ)
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  await import('../../../../vendor/jizura/jizura-engine.js');
  J = (globalThis as unknown as { J: JizuraApi & PackJ }).J;
  installTimingPatch(J);
});

const text = Array.from({ length: 10 }, (_, i) => `${i + 1}行目の/静かな/歌詞を/ここに`).join('\n');
const lineTimes = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), 2 + i * 3]));
const lyricsOf = (style: string, custom: LyricsSettings['motion']['custom'] = null): LyricsSettings => ({
  ...defaultLyrics(),
  text,
  motion: { ...defaultLyrics().motion, style, custom, density: 0.7, decor: 1, motion: 0.8 },
  timing: { ...defaultLyrics().timing, lineTimes },
});
const audio = { duration: 34, beats: Array.from({ length: 64 }, (_, i) => i * 0.5), energy: new Float32Array(34 * 60).fill(0.3), energyRate: 60 };

function planOf(lyrics: LyricsSettings): { json: string; cuts: Cut[]; project: Record<string, unknown> } {
  const project = buildJizuraProject(lyrics, J.defaultProject(), { seed: 5, aspect: '16:9', fps: 30 });
  applyMotionPack(project, lyrics.motion, J);
  const plan = J.plan(project, audio);
  return { json: JSON.stringify(plan), cuts: plan.cuts as Cut[], project };
}

type Cut = { line: number; layout?: string; enter?: string; exit?: string; hold?: string; cam?: string; decor?: { id: string }[] };

describe('演出パック (本物の JIZURA)', () => {
  it('登録しても既存のスタイルのカット割りは完全に同じ', () => {
    expect((J as unknown as { __zunzunPacks?: boolean }).__zunzunPacks).toBeFalsy();
    const before = ['noir', 'crimson', 'gold'].map((s) => planOf(lyricsOf(s)).json);
    registerMotionPacks(J);
    expect(['noir', 'crimson', 'gold'].map((s) => planOf(lyricsOf(s)).json)).toEqual(before);
  });

  it('静寂: オリジナルの演出が使われ、「calm」の印のない JIZURA の演出は使われない。グリッチ・フラッシュは 0', () => {
    registerMotionPacks(J);
    const { cuts, project } = planOf(lyricsOf(CALM_STYLE_KEY));
    const lyricCuts = cuts.filter((c) => c.line >= 0);
    expect(lyricCuts.length).toBeGreaterThan(10);
    const ours = (k?: string) => !!k && k.startsWith('zz');
    const count = (f: (c: Cut) => boolean) => lyricCuts.filter(f).length;
    expect(count((c) => ours(c.enter))).toBeGreaterThan(0);
    expect(count((c) => ours(c.exit))).toBeGreaterThan(0);
    expect(count((c) => ours(c.cam))).toBeGreaterThan(0);
    expect(count((c) => !!c.decor?.some((d) => ours(d.id)))).toBeGreaterThan(0);
    // JIZURA の演出は calm の印があるもの (か、カットのつなぎで JIZURA が決める 'cut') だけ
    const calmOk = (g: string, k?: string) => !k || k === 'cut' || ours(k) || !!J.registry(g)[k]?.tags?.includes('calm');
    for (const c of lyricCuts) {
      expect(calmOk('enter', c.enter), `enter ${c.enter}`).toBe(true);
      expect(calmOk('exit', c.exit), `exit ${c.exit}`).toBe(true);
      expect(calmOk('hold', c.hold), `hold ${c.hold}`).toBe(true);
      expect(calmOk('cam', c.cam), `cam ${c.cam}`).toBe(true);
      for (const d of c.decor ?? []) expect(calmOk('decor', d.id), `decor ${d.id}`).toBe(true);
    }
    expect(project.fx).toMatchObject({ glitch: 0, flash: false });
  });

  it('静寂を元にしたマイスタイルでもパックが効く。ほかのスタイルでは何も足さない', () => {
    const custom = { name: 'x', base: CALM_STYLE_KEY } as NonNullable<LyricsSettings['motion']['custom']>;
    expect(packForMotion({ style: CUSTOM_STYLE_KEY, custom })?.styleKey).toBe(CALM_STYLE_KEY);
    expect(packForMotion({ style: 'noir', custom: null })).toBeNull();
    const p: Record<string, unknown> = {};
    expect(applyMotionPack(p, { style: 'noir', custom: null }, J)).toBeNull();
    expect(p).toEqual({});
  });

  it('パックの演出はどれも名前があり、部品セットに入っている', () => {
    for (const pack of PACKS) {
      for (const e of pack.effects(J)) {
        expect(e.def.name.length).toBeGreaterThan(0);
        expect(J.registry(e.group)[e.key]).toBeDefined();
        expect((J.registry(e.group)[e.key] as { set?: string }).set).toBe(pack.set);
      }
    }
  });
});
