import { beforeAll, describe, expect, it } from 'vitest';
import { CUSTOM_STYLE_KEY, defaultLyrics, type LyricsSettings } from '../../types';
import { buildJizuraProject, installTimingPatch, type JizuraApi } from '../jizura-adapter';
import { CALM_STYLE_KEY } from './calm';
import { CINEMA_STYLE_KEY } from './cinema';
import { DESIGN_STYLE_KEY } from './design';
import { INTENSE_STYLE_KEY } from './intense';
import { POP_STYLE_KEY } from './pop';
import { ROCK_STYLE_KEY } from './rock';
import { flashAllowed, MAX_FLASH_HZ } from './util';
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

function planOf(lyrics: LyricsSettings, palette: Parameters<typeof applyMotionPack>[3] = {}): { json: string; used: string; cuts: Cut[]; project: Record<string, unknown>; plan: { style: { schemes: { fg: string; accent: string }[] }; events?: { type: string }[] } } {
  const project = buildJizuraProject(lyrics, J.defaultProject(), { seed: 5, aspect: '16:9', fps: 30 });
  applyMotionPack(project, lyrics.motion, J, palette);
  const plan = J.plan(project, audio);
  // 使われた演出を見るのはカットと出来事 (画面効果) だけ (plan.style にはスタイルの「選ばれやすさ」の表として名前が載る)
  const used = JSON.stringify({ cuts: plan.cuts, events: (plan as { events?: unknown }).events });
  return { json: JSON.stringify(plan), used, cuts: plan.cuts as Cut[], project, plan: plan as unknown as { style: { schemes: { fg: string; accent: string }[] }; events?: { type: string }[] } };
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

  it('衝撃: オリジナルの演出が使われ、pop / glitch / graphic の印のない JIZURA の演出は使われない。点滅・反転の効果は出てこない', () => {
    registerMotionPacks(J);
    const { used, cuts, project } = planOf(lyricsOf(INTENSE_STYLE_KEY));
    const lyricCuts = cuts.filter((c) => c.line >= 0);
    const ours = (k?: string) => !!k && k.startsWith('zz');
    expect(lyricCuts.filter((c) => ours(c.enter)).length).toBeGreaterThan(0);
    expect(lyricCuts.filter((c) => ours(c.exit)).length).toBeGreaterThan(0);
    expect(lyricCuts.filter((c) => ours(c.cam)).length).toBeGreaterThan(0);
    expect(lyricCuts.filter((c) => !!c.decor?.some((d) => ours(d.id))).length).toBeGreaterThan(0);
    const ok = (g: string, k?: string) => !k || k === 'cut' || ours(k) || !!J.registry(g)[k]?.tags?.some((t) => ['pop', 'glitch', 'graphic'].includes(t));
    for (const c of lyricCuts) {
      for (const g of ['enter', 'exit', 'hold', 'cam', 'layout'] as const) expect(ok(g, c[g]), `${g} ${c[g]}`).toBe(true);
      for (const d of c.decor ?? []) expect(ok('decor', d.id), `decor ${d.id}`).toBe(true);
    }
    for (const bad of ['strobe', 'invert', 'whiteFrame', 'bandInvert', 'mirrorFlash', 'negativeRing', 'flashCross', 'bloomFlash']) expect(used).not.toContain(`"${bad}"`);
    expect(project.fx).toMatchObject({ flash: false });
  });

  it('轟音: オリジナルの演出が使われ、graphic / glitch / editorial の印のない JIZURA の演出と可愛い装飾は使われない。点滅・反転の効果は出てこない', () => {
    registerMotionPacks(J);
    const { used, cuts } = planOf(lyricsOf(ROCK_STYLE_KEY));
    const lyricCuts = cuts.filter((c) => c.line >= 0);
    const ours = (k?: string) => !!k && k.startsWith('zz');
    expect(lyricCuts.filter((c) => ours(c.enter)).length).toBeGreaterThan(0);
    expect(lyricCuts.filter((c) => ours(c.exit)).length).toBeGreaterThan(0);
    expect(lyricCuts.filter((c) => ours(c.cam)).length).toBeGreaterThan(0);
    expect(lyricCuts.filter((c) => !!c.decor?.some((d) => ours(d.id))).length).toBeGreaterThan(0);
    const ok = (g: string, k?: string) => !k || k === 'cut' || ours(k) || !!J.registry(g)[k]?.tags?.some((t) => ['graphic', 'glitch', 'editorial'].includes(t));
    for (const c of lyricCuts) {
      for (const g of ['enter', 'exit', 'hold', 'cam', 'layout'] as const) expect(ok(g, c[g]), `${g} ${c[g]}`).toBe(true);
      for (const d of c.decor ?? []) expect(ok('decor', d.id), `decor ${d.id}`).toBe(true);
    }
    for (const bad of ['strobe', 'invert', 'whiteFrame', 'flashCross', 'heartsStars', 'petals']) expect(used).not.toContain(`"${bad}"`);
  });

  it('弾む: オリジナルの演出が使われ、pop の印のない JIZURA の演出は使われない。光る・反転する・白く飛ばす・怖い演出は出てこない', () => {
    registerMotionPacks(J);
    const { used, cuts, project } = planOf(lyricsOf(POP_STYLE_KEY));
    const lyricCuts = cuts.filter((c) => c.line >= 0);
    const ours = (k?: string) => !!k && k.startsWith('zz');
    expect(lyricCuts.filter((c) => ours(c.enter)).length).toBeGreaterThan(0);
    expect(lyricCuts.filter((c) => ours(c.exit)).length).toBeGreaterThan(0);
    expect(lyricCuts.filter((c) => ours(c.hold)).length).toBeGreaterThan(0);
    expect(lyricCuts.filter((c) => ours(c.cam)).length).toBeGreaterThan(0);
    expect(lyricCuts.filter((c) => !!c.decor?.some((d) => ours(d.id))).length).toBeGreaterThan(0);
    const ok = (g: string, k?: string) => !k || k === 'cut' || ours(k) || !!J.registry(g)[k]?.tags?.includes('pop');
    for (const c of lyricCuts) {
      for (const g of ['enter', 'exit', 'hold', 'cam', 'layout'] as const) expect(ok(g, c[g]), `${g} ${c[g]}`).toBe(true);
      for (const d of c.decor ?? []) expect(ok('decor', d.id), `decor ${d.id}`).toBe(true);
    }
    for (const bad of ['strobe', 'invert', 'whiteFrame', 'negativeRing', 'bloomFlash', 'flashCross', 'flashBox', 'hrJumpScare', 'overexpose', 'overexposeOut']) expect(used).not.toContain(`"${bad}"`);
    expect(project.fx).toMatchObject({ glitch: 0, flash: false });
  });

  it('図案: レイアウトはオリジナルだけ (JIZURA のレイアウトは使わない)。ほとんどが使われ、装飾・背景の図形・光る効果は出てこない', () => {
    registerMotionPacks(J);
    const { used, cuts } = planOf(lyricsOf(DESIGN_STYLE_KEY));
    const lyricCuts = cuts.filter((c) => c.line >= 0);
    for (const c of lyricCuts) {
      expect(c.layout?.startsWith('zz'), `layout ${c.layout}`).toBe(true);
      expect(c.decor ?? []).toEqual([]);
      expect([undefined, 'none']).toContain((c as Cut & { bg?: string }).bg);
    }
    // 10 行 40 カットほどなので、12 個のうちほとんどが使われる (全部は保証しない)
    const all = ['zzPeekWindow', 'zzGridFill', 'zzRepeatStack', 'zzPoster', 'zzBandRun', 'zzCrossType', 'zzGiantChar', 'zzCutPieces', 'zzCirclePunch', 'zzSplitInvert', 'zzTimeline', 'zzTelop'];
    const usedLayouts = new Set(lyricCuts.map((c) => c.layout));
    for (const k of usedLayouts) expect(all).toContain(k);
    expect(usedLayouts.size).toBeGreaterThanOrEqual(9);
    for (const bad of ['strobe', 'invert', 'whiteFrame', 'negativeRing', 'bloomFlash', 'flashCross', 'flashBox']) expect(used).not.toContain(`"${bad}"`);
  });

  it('図案: どれにも収まらない長い塊でも、JIZURA のレイアウトに頼らない (ポスター組はどんな長さでも組める)', () => {
    registerMotionPacks(J);
    const long = { ...lyricsOf(DESIGN_STYLE_KEY), text: Array.from({ length: 4 }, () => 'とても長い歌詞の行がひとつのかたまりのまま続いていくときにも組めること').join('\n') };
    const { cuts } = planOf(long);
    for (const c of cuts.filter((k) => k.line >= 0)) expect(c.layout?.startsWith('zz'), `layout ${c.layout}`).toBe(true);
  });

  it('余白: レイアウト・表示中の動きはオリジナルだけ。装飾・画面効果・場面転換・背景の図形は使わない。背景の色で配色が変わる', () => {
    registerMotionPacks(J);
    const { cuts, plan } = planOf(lyricsOf(CINEMA_STYLE_KEY));
    const lyricCuts = cuts.filter((c) => c.line >= 0);
    const ours = (k?: string) => !!k && k.startsWith('zz');
    for (const c of lyricCuts) {
      expect(ours(c.layout), `layout ${c.layout}`).toBe(true);
      expect(ours(c.hold), `hold ${c.hold}`).toBe(true);
      expect(c.decor ?? []).toEqual([]);
      const cc = c as Cut & { bg?: string; trans?: string | null; treat?: string };
      expect([undefined, 'none']).toContain(cc.bg);
      expect([undefined, null]).toContain(cc.trans);
      expect([undefined, 'none']).toContain(cc.treat);
      expect(['cut', 'blur', 'fadeStagger', 'blurStagger', 'trackIn'].includes(c.enter!) || ours(c.enter), `enter ${c.enter}`).toBe(true);
    }
    // 画面効果の出来事は、色ズレの跳ね・揺れ (JIZURA がカットの切れ目に自動で入れるもの) 以外は無い
    for (const ev of plan.events ?? []) expect(['chroma', 'shake']).toContain(ev.type);
    const layouts = new Set(lyricCuts.map((c) => c.layout));
    expect(layouts.has('zzSubtitle')).toBe(true);
    // 背景の色を渡すと、差し色が背景の色み (橙) になる
    const warm = planOf(lyricsOf(CINEMA_STYLE_KEY), { palette: { dark: '#101830', light: '#f4e8d0', accent: '#d06a30', accent2: '#3050a0' } }).plan;
    expect(warm.style.schemes[0]!.accent).not.toBe(plan.style.schemes[0]!.accent);
    const n = parseInt(warm.style.schemes[0]!.accent.slice(1), 16);
    expect((n >> 16) & 255).toBeGreaterThan(n & 255);
  });

  it('静寂: 画面を光らせる効果 (calm の印があるもの) も出てこない', () => {
    registerMotionPacks(J);
    const { used } = planOf(lyricsOf(CALM_STYLE_KEY));
    for (const bad of ['flashCross', 'bloomFlash', 'whiteFrame']) expect(used).not.toContain(`"${bad}"`);
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

describe('flashAllowed (光過敏への配慮: 毎秒 3 回まで)', () => {
  it('光らせる拍の間隔が 1/3 秒より短くならない', () => {
    for (const len of [0.1, 0.15, 0.2, 0.25, 0.3333, 0.4, 0.5, 1]) {
      const lit = Array.from({ length: 200 }, (_, i) => i).filter((i) => flashAllowed(i, len));
      const gaps = lit.slice(1).map((v, k) => (v - lit[k]!) * len);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1 / MAX_FLASH_HZ - 1e-6);
      // 遅い曲では毎拍光る
      if (len >= 1 / MAX_FLASH_HZ) expect(lit.length).toBe(200);
    }
    expect(flashAllowed(0, 0)).toBe(false);
  });
});

