import { describe, expect, it } from 'vitest';
import { defaultChromaKey } from '../types';
import { applyChroma, hexToRgb01 } from './chroma';

describe('クロマキー', () => {
  const on = { ...defaultChromaKey(), enabled: true };

  it('グリーンバックの緑は透け、影で暗くなった緑も透ける。肌・白・黒・赤は残る', () => {
    expect(applyChroma([0, 1, 0], on)[3]).toBe(0);
    expect(applyChroma([0.1, 0.55, 0.12], on)[3]).toBeLessThan(0.05);
    for (const c of [[0.92, 0.72, 0.6], [1, 1, 1], [0, 0, 0], [0.9, 0.1, 0.1], [0.2, 0.3, 0.9]] as [number, number, number][]) {
      expect(applyChroma(c, on)[3], String(c)).toBeGreaterThan(0.95);
    }
  });

  it('境目はなめらか (許容の外側で少しずつ不透明になる)。オフなら何もしない', () => {
    const a = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((k) => applyChroma([k, 1 - k * 0.5, k], { ...on, softness: 0.6 })[3]);
    for (let i = 1; i < a.length; i++) expect(a[i]!).toBeGreaterThanOrEqual(a[i - 1]!);
    expect(applyChroma([0, 1, 0], defaultChromaKey())).toEqual([0, 1, 0, 1]);
  });

  it('にじみ取り: 緑がかった縁は色みが抜ける (緑が減る)。量 0 ならそのまま', () => {
    const edge: [number, number, number] = [0.5, 0.75, 0.45];
    const [, g] = applyChroma(edge, { ...on, tolerance: 0.1, spill: 1 });
    expect(g).toBeLessThan(0.75);
    expect(applyChroma(edge, { ...on, tolerance: 0.1, spill: 0 }).slice(0, 3)).toEqual(edge);
  });

  it('ブルーバックも選べる。色の書き方が壊れていれば緑', () => {
    expect(applyChroma([0, 0.2, 1], { ...on, color: '#0033ff' })[3]).toBeLessThan(0.05);
    expect(hexToRgb01('nope')).toEqual([0, 1, 0]);
  });
});
