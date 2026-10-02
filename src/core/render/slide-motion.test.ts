import { describe, expect, it } from 'vitest';
import { beatEnvelope, defaultSlideMotion, slideTransform, STILL, type SlideMotionInput } from './slide-motion';

const input = (o: Partial<SlideMotionInput> = {}): SlideMotionInput => ({ cue: 0, start: 10, end: 18, fade: 0.6, kind: 'verse', t: 10, ...o });

describe('slideTransform (スライドショーの画像の動き)', () => {
  it('動かさない設定・設定が無い (前のプロジェクト) ときは、そのまま', () => {
    expect(slideTransform(undefined, input({ t: 14 }))).toEqual(STILL);
    expect(slideTransform({ ...defaultSlideMotion(), enabled: false }, input({ t: 14 }))).toEqual(STILL);
  });

  it('1 回目は寄る: 出た直後は少しだけ、替わる頃にいちばん。2 回目は引く。3 回目は横へ流れる', () => {
    const m = { ...defaultSlideMotion(), beatPush: 0 };
    const a0 = slideTransform(m, input({ cue: 0, t: 10 }));
    const a1 = slideTransform(m, input({ cue: 0, t: 18.6 }));
    expect(a1.zoom).toBeGreaterThan(a0.zoom);
    const b0 = slideTransform(m, input({ cue: 1, t: 10 }));
    const b1 = slideTransform(m, input({ cue: 1, t: 18.6 }));
    expect(b1.zoom).toBeLessThan(b0.zoom);
    const c0 = slideTransform(m, input({ cue: 2, t: 10 }));
    const c1 = slideTransform(m, input({ cue: 2, t: 18.6 }));
    expect(c0.x).toBeLessThan(0);
    expect(c1.x).toBeGreaterThan(0);
    // いつも 1 倍より大きい (はみ出した分の中で動かす)、拡大は大きすぎない
    for (const v of [a0, a1, b0, b1, c0, c1]) {
      expect(v.zoom).toBeGreaterThan(1);
      expect(v.zoom).toBeLessThan(1.21);
      expect(Math.abs(v.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(v.y)).toBeLessThanOrEqual(1);
    }
  });

  it('なめらか: 少しずつ時刻を進めても、拡大と位置は少しずつしか変わらない', () => {
    const m = { ...defaultSlideMotion(), beatPush: 0 };
    for (let cue = 0; cue < 6; cue++) {
      let prev = slideTransform(m, input({ cue, t: 10 }));
      for (let t = 10; t <= 19; t += 1 / 30) {
        const v = slideTransform(m, input({ cue, t }));
        expect(Math.abs(v.zoom - prev.zoom)).toBeLessThan(0.005);
        expect(Math.abs(v.x - prev.x)).toBeLessThan(0.02);
        prev = v;
      }
    }
  });

  it('動きの大きさで拡大が変わる。区切りで強さを変えると、サビは大きくイントロは小さい (切れば同じ)', () => {
    const big = { ...defaultSlideMotion(), amount: 1, beatPush: 0 };
    const small = { ...defaultSlideMotion(), amount: 0, beatPush: 0 };
    const at = input({ cue: 0, t: 18.6 });
    expect(slideTransform(big, at).zoom).toBeGreaterThan(slideTransform(small, at).zoom);
    const chorus = slideTransform(big, { ...at, kind: 'chorus' }).zoom;
    const intro = slideTransform(big, { ...at, kind: 'intro' }).zoom;
    const verse = slideTransform(big, { ...at, kind: 'verse' }).zoom;
    expect(chorus).toBeGreaterThan(verse);
    expect(intro).toBeLessThan(verse);
    const flat = { ...big, bySection: false };
    expect(slideTransform(flat, { ...at, kind: 'chorus' }).zoom).toBeCloseTo(slideTransform(flat, { ...at, kind: 'intro' }).zoom, 9);
  });

  it('拍で寄る: 拍の直後に少し大きく (最大 2%)、すぐ戻る。0 なら寄らない', () => {
    const beats = [10, 10.5, 11, 11.5, 12];
    const m = { ...defaultSlideMotion(), beatPush: 1 };
    const off = { ...m, beatPush: 0 };
    const on = slideTransform(m, input({ t: 11.0 }), beats).zoom / slideTransform(off, input({ t: 11.0 }), beats).zoom;
    const later = slideTransform(m, input({ t: 11.4 }), beats).zoom / slideTransform(off, input({ t: 11.4 }), beats).zoom;
    expect(on).toBeCloseTo(1.02, 5);
    expect(later).toBeLessThan(1.002);
    expect(beatEnvelope(beats, 9)).toBe(0);
    expect(beatEnvelope(beats, 13)).toBe(0);
    expect(beatEnvelope([], 11)).toBe(0);
  });

  it('壊れた値でも NaN にならない', () => {
    const v = slideTransform({ enabled: true, amount: Number.NaN, bySection: true, beatPush: Infinity }, { cue: -3, start: Number.NaN, end: 5, fade: -1, kind: undefined, t: Number.NaN }, [Number.NaN]);
    for (const x of [v.zoom, v.x, v.y]) expect(Number.isFinite(x)).toBe(true);
  });
});
