import { describe, expect, it } from 'vitest';
import { defaultChromaKey } from '../types';
import { applyChroma, autoChroma, CHOKE_MAX_PX, chromaUniforms, erodeAlpha, hexToRgb01 } from './chroma';

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

  /**
   * 作りものの素材: 背景は明るさにむらのある緑 (左ほど明るく、右下は影で暗い)、真ん中に肌色の人 (四角) と赤い服。
   * 実際のグリーンバックに近いように、緑の鮮やかさも少しばらつかせる
   */
  function fakeGreenScreen(w = 60, h = 40, color: 'green' | 'blue' = 'green'): { data: Uint8ClampedArray; isSubject: (i: number) => boolean } {
    const data = new Uint8ClampedArray(w * h * 4);
    const subject = (x: number, y: number): boolean => x >= 22 && x < 38 && y >= 8 && y < 36;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (subject(x, y)) {
          const [r, g, b] = y < 20 ? [235, 184, 150] : [200, 30, 40];
          data.set([r, g, b, 255], i);
          continue;
        }
        const light = 1 - (x / w) * 0.45 - (y > 28 && x > 40 ? 0.35 : 0);
        const sat = 0.8 + 0.2 * Math.sin(x * 0.7 + y * 1.3);
        const main = 210 * light;
        const other = main * (1 - 0.72 * sat);
        data.set(color === 'green' ? [other, main, other * 1.1, 255] : [other * 0.8, other * 1.2, main, 255], i);
      }
    }
    return { data, isSubject: (i) => subject(i % w, Math.floor(i / w)) };
  }

  const alphaOf = (data: Uint8ClampedArray, i: number, k: ReturnType<typeof defaultChromaKey>): number =>
    applyChroma([data[i * 4]! / 255, data[i * 4 + 1]! / 255, data[i * 4 + 2]! / 255], k)[3];

  it('自動で合わせる: むらや影のある緑の背景がほぼ全部 (98% 以上) 透け、人は残る', () => {
    const { data, isSubject } = fakeGreenScreen();
    const found = autoChroma(data);
    expect(found).not.toBeNull();
    const k = { ...defaultChromaKey(), ...found!, enabled: true };
    const [r, g, b] = hexToRgb01(k.color);
    expect(g).toBeGreaterThan(r + 0.2);
    expect(g).toBeGreaterThan(b + 0.2);
    let bg = 0;
    let bgGone = 0;
    let subj = 0;
    let subjKept = 0;
    for (let i = 0; i < data.length / 4; i++) {
      const a = alphaOf(data, i, k);
      if (isSubject(i)) {
        subj++;
        if (a > 0.95) subjKept++;
      } else {
        bg++;
        if (a < 0.05) bgGone++;
      }
    }
    expect(bgGone / bg).toBeGreaterThan(0.98);
    expect(subjKept / subj).toBe(1);
    // 前の既定値 (範囲 0.25) で、明るい所の 1 点を押して選んだときは、影やむらの緑が残っていた
    const old = { ...defaultChromaKey(), enabled: true, tolerance: 0.25, softness: 0.1, color: '#1ad21a' };
    let oldGone = 0;
    for (let i = 0; i < data.length / 4; i++) if (!isSubject(i) && alphaOf(data, i, old) < 0.05) oldGone++;
    expect(oldGone / bg).toBeLessThan(bgGone / bg);
  });

  it('自動で合わせる: ブルーバックなら青を選ぶ。緑も青も無い絵なら null', () => {
    const { data } = fakeGreenScreen(60, 40, 'blue');
    const found = autoChroma(data)!;
    const [r, g, b] = hexToRgb01(found.color);
    expect(b).toBeGreaterThan(Math.max(r, g) + 0.2);
    const gray = new Uint8ClampedArray(40 * 40 * 4).fill(128);
    expect(autoChroma(gray)).toBeNull();
    expect(autoChroma(new Uint8ClampedArray(0))).toBeNull();
  });

  it('縁を削る: まわりに透ける所があれば、その画素も透ける。0 なら削らない。削る距離は最大 3 画素', () => {
    expect(erodeAlpha(1, [1, 1, 0, 1], 1.5)).toBe(0);
    expect(erodeAlpha(1, [1, 1, 0, 1], 0)).toBe(1);
    expect(erodeAlpha(0.8, [1, 1, 1, 1], 2)).toBe(0.8);
    expect(chromaUniforms({ ...on, choke: 1 }).chokePx).toBe(CHOKE_MAX_PX);
    expect(chromaUniforms({ ...on, choke: Number.NaN }).chokePx).toBe(0);
  });
});
