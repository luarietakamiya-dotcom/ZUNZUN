import { describe, expect, it } from 'vitest';
import { defaultCommonParams, type AudioFrame } from '../types';
import { BASS_BAND_END, MID_BAND_END, sensitivityGain, shapeAudio, shapeBands } from './response';

function frame(overrides: Partial<AudioFrame> = {}): AudioFrame {
  return {
    t: 0,
    dt: 1 / 60,
    bass: 0.5,
    mid: 0.5,
    high: 0.5,
    rms: 0.5,
    peak: 0.5,
    beat: 0.5,
    beatIndex: 0,
    spectralEnergy: 0.5,
    flux: 0.5,
    bands: new Float32Array(64).fill(0.5),
    ...overrides,
  };
}

describe('sensitivityGain', () => {
  it('感度が高いほど倍率が上がる', () => {
    expect(sensitivityGain(0)).toBeLessThan(sensitivityGain(0.6));
    expect(sensitivityGain(0.6)).toBeLessThan(sensitivityGain(1));
  });

  it('範囲外・不正な値でも有限の倍率を返す', () => {
    expect(sensitivityGain(-5)).toBe(sensitivityGain(0));
    expect(sensitivityGain(9)).toBe(sensitivityGain(1));
    expect(Number.isFinite(sensitivityGain(Number.NaN))).toBe(true);
  });
});

describe('shapeAudio', () => {
  it('結果は常に 0..1 に収まる', () => {
    const p = { ...defaultCommonParams(), sensitivity: 1, bass: 2, mid: 2, high: 2 };
    const s = shapeAudio(frame({ bass: 1, mid: 1, high: 1, rms: 1 }), p);
    for (const v of Object.values(s)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('Bass 倍率 0 なら低域は 0 になるが、他の帯域には影響しない', () => {
    const p = { ...defaultCommonParams(), bass: 0 };
    const s = shapeAudio(frame(), p);
    expect(s.bass).toBe(0);
    expect(s.mid).toBeGreaterThan(0);
  });

  it('ビートパルスは感度で増幅しない', () => {
    const lo = shapeAudio(frame({ beat: 0.3 }), { ...defaultCommonParams(), sensitivity: 0 });
    const hi = shapeAudio(frame({ beat: 0.3 }), { ...defaultCommonParams(), sensitivity: 1 });
    expect(lo.beat).toBe(0.3);
    expect(hi.beat).toBe(0.3);
  });
});

describe('shapeBands', () => {
  it('低域/中域/高域それぞれに対応する倍率を掛ける', () => {
    const p = { ...defaultCommonParams(), bass: 0, mid: 1, high: 2 };
    const out = shapeBands(new Float32Array(64).fill(0.2), p, new Float32Array(64));
    expect(out[0]).toBe(0);
    expect(out[BASS_BAND_END - 1]).toBe(0);
    expect(out[BASS_BAND_END]).toBeGreaterThan(0);
    expect(out[MID_BAND_END]).toBeGreaterThan(out[BASS_BAND_END] ?? 0);
  });

  it('渡した out 配列を再利用し、0..1 に収める', () => {
    const out = new Float32Array(64);
    const ret = shapeBands(new Float32Array(64).fill(5), { ...defaultCommonParams(), sensitivity: 1 }, out);
    expect(ret).toBe(out);
    expect(Math.max(...out)).toBeLessThanOrEqual(1);
  });
});
