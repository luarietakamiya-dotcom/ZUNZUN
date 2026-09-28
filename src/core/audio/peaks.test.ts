import { describe, expect, it } from 'vitest';
import { computePeaks, peakBetween } from './peaks';

describe('computePeaks', () => {
  it('区間ごとの最大振幅 (複数チャンネルは大きい方)', () => {
    const sr = 1000;
    const l = new Float32Array(1000);
    const r = new Float32Array(1000);
    l[10] = -0.5; // 0〜0.1 秒の区間
    r[150] = 0.8; // 0.1〜0.2 秒の区間
    const p = computePeaks([l, r], sr, 10);
    expect(p.max.length).toBe(10);
    expect(p.max[0]).toBeCloseTo(0.5);
    expect(p.max[1]).toBeCloseTo(0.8);
    expect(p.max[2]).toBe(0);
    expect(peakBetween(p, 0, 0.2)).toBeCloseTo(0.8);
    expect(peakBetween(p, 0.25, 0.26)).toBe(0);
  });

  it('空の入力・範囲外でも落ちない', () => {
    expect(computePeaks([], 44100).max.length).toBe(0);
    const p = computePeaks([new Float32Array(10).fill(2)], 10, 1);
    expect(p.max[0]).toBe(1);
    expect(peakBetween(p, 50, 60)).toBe(0);
  });
});
