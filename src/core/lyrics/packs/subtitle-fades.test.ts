import { describe, expect, it } from 'vitest';
import { fadePacks, PLAIN_FADE, prepareFade } from './subtitle-fades';

const plan = () => ({
  cuts: [
    { line: 0, start: 1, end: 4, layout: 'center', enter: 'inkBleed', hold: 'trackBreathe', exit: 'wipe', treat: 'glow', cam: 'push', params: { a: 1 } },
    { line: 0, start: 4, end: 5, layout: 'interlude', text: '曲名', enter: 'blur', hold: 'still', exit: 'blur' },
  ] as Record<string, unknown>[],
  events: [{ t: 1.5, type: 'chroma' }, { t: 2, type: 'shake' }] as unknown[],
});

/** 文字を描いたときの濃さ (globalAlpha) を覚える、まねの canvas */
function fakeCtx() {
  const alphas: number[] = [];
  const ctx = {
    globalAlpha: 1, font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '', shadowColor: '', shadowBlur: 0, shadowOffsetY: 0, filter: '', lineWidth: 0,
    save() {}, restore() {}, fillRect() {}, strokeText() {},
    measureText: (s: string) => ({ width: [...s].length * 10 }),
    fillText() { alphas.push(ctx.globalAlpha); },
  };
  return { ctx, alphas };
}

describe('MV字幕・動きなし (vs-fade-plain)', () => {
  const pack = fadePacks.find((p) => p.styleKey === 'vs-fade-plain')!;

  it('スタイルとして登録され、名前は「MV字幕・動きなし」', () => {
    expect(pack).toBeTruthy();
    const [effect] = (pack.effects as unknown as (j: unknown) => { key: string; def: { name: string } }[])({ splitLines: (s: string) => s });
    expect(effect).toMatchObject({ key: 'vsFadeLayoutplain', def: { name: 'MV字幕・動きなし' } });
  });

  it('演出のきっかけ（色ずれ・揺れ）を外し、登場・表示中・退場の動きを「カット」「静止」に固定する', () => {
    const p = plan();
    prepareFade(p, 'vs-fade-plain');
    expect(p.events).toEqual([]);
    expect(p.cuts[0]).toMatchObject({ layout: 'vsFadeLayoutplain', enter: 'cut', hold: 'still', exit: 'cut', treat: 'none', cam: 'none', params: {} });
    expect(p.cuts[1]!.text).toBe(''); // 間奏には何も出さない
  });

  it('ほかの字幕フェードは演出のきっかけを残す（今までどおり）', () => {
    const p = plan();
    prepareFade(p, 'vs-fade-soft');
    expect(p.events.length).toBe(2);
    expect(p.cuts[0]!.enter).toBe('inkBleed');
  });

  it(`フェードは ${PLAIN_FADE} 秒。表示中は濃さ 1 のまま変わらない`, () => {
    const layout = (pack.effects as unknown as (j: unknown) => { def: { render: (env: unknown) => unknown } }[])({ splitLines: (s: string) => s })[0]!.def;
    const at = (lt: number) => {
      const { ctx, alphas } = fakeCtx();
      layout.render({ pass: 'main', W: 640, H: 360, ctx, lt, cut: { text: '赤いライトが鼓動を撃った', dur: 3 }, sc: { fg: '#fff' } });
      return alphas.length ? alphas[0]! : 0;
    };
    expect(at(0)).toBe(0);
    expect(at(PLAIN_FADE / 2)).toBeCloseTo(0.5, 5);
    for (const lt of [PLAIN_FADE, 0.5, 1.5, 2.5, 3 - PLAIN_FADE]) expect(at(lt)).toBeCloseTo(1, 5);
    expect(at(3 - PLAIN_FADE / 2)).toBeCloseTo(0.5, 5);
  });
});
