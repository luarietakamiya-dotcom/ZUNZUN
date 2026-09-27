import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/random';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { MilkyWayPreset } from './preset';

/**
 * WebGL を使わずに (three.js のシーングラフだけで) Milky Way を動かし、
 * 反応設計どおりに数値が動くか・同じ seed なら同じ流れ星になるかを確かめる。
 */

const fakeRenderer = { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer;
type Params = CommonParams & Record<string, unknown>;
const params = (o: Partial<CommonParams> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;

function makePreset(seed = 42, p: Params = params()): MilkyWayPreset {
  const preset = new MilkyWayPreset();
  preset.init({ renderer: fakeRenderer, width: 1280, height: 720, seed, params: p, rng: makeRng(seed) });
  return preset;
}

function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return {
    t,
    dt: 1 / 60,
    bass: 0,
    mid: 0,
    high: 0,
    rms: 0,
    peak: 0,
    beat: 0,
    beatIndex: -1,
    spectralEnergy: 0,
    flux: 0,
    bands: new Float32Array(64),
    ...o,
  };
}

function run(preset: MilkyWayPreset, frames: number, o: (i: number) => Partial<AudioFrame>, p: Params = params()): void {
  for (let i = 0; i < frames; i++) preset.update(frame(i / 60, o(i)), p);
}

/** 120 BPM 相当: 30 フレームごとに新しいビート */
const beats = (i: number): Partial<AudioFrame> => ({ beatIndex: Math.floor(i / 30), beat: Math.exp(-(i % 30) / 10) });

describe('MilkyWayPreset', () => {
  it('mid が強いほど天の川が明るくなる', () => {
    const quiet = makePreset();
    const loud = makePreset();
    run(quiet, 10, () => ({ mid: 0 }));
    run(loud, 10, () => ({ mid: 1 }));
    expect(loud.inspect().galaxyStrength).toBeGreaterThan(quiet.inspect().galaxyStrength + 0.4);
  });

  it('high が強いほど星のまたたきが深くなる', () => {
    const calm = makePreset();
    const bright = makePreset();
    run(calm, 10, () => ({ high: 0 }));
    run(bright, 10, () => ({ high: 1 }));
    expect(bright.inspect().twinkle).toBeGreaterThan(calm.inspect().twinkle + 0.4);
  });

  it('rms が強いほど湖面の波紋が大きくなる', () => {
    const still = makePreset();
    const wavy = makePreset();
    run(still, 10, () => ({ rms: 0 }));
    run(wavy, 10, () => ({ rms: 1 }));
    expect(wavy.inspect().ripple).toBeGreaterThan(still.inspect().ripple + 0.8);
  });

  it('ビートが来ると流れ星が流れ、ビートが無ければ流れない', () => {
    const silent = makePreset();
    const rhythmic = makePreset();
    run(silent, 600, () => ({}));
    run(rhythmic, 600, beats, params({ intensity: 1 }));
    expect(silent.inspect().meteorsSpawned).toBe(0);
    expect(rhythmic.inspect().meteorsSpawned).toBeGreaterThan(3);
  });

  it('流れ星はしばらくすると消える', () => {
    const p = makePreset();
    run(p, 600, beats, params({ intensity: 1 }));
    expect(p.inspect().meteorsSpawned).toBeGreaterThan(0);
    // 以降は新しいビートが来ない (beatIndex が変わらない) → 流れている星は寿命で消える
    run(p, 150, () => ({ beatIndex: 19 }));
    expect(p.inspect().activeMeteors).toBe(0);
  });

  it('Intensity が高いほど流れ星が多い', () => {
    const low = makePreset(3);
    const high = makePreset(3);
    run(low, 1800, beats, params({ intensity: 0.1 }));
    run(high, 1800, beats, params({ intensity: 1 }));
    expect(high.inspect().meteorsSpawned).toBeGreaterThan(low.inspect().meteorsSpawned);
  });

  it('同じ seed・同じ音声なら流れ星の出方まで完全に一致し、seed が違えば変わる (書き出しの再現性)', () => {
    const a = makePreset(7);
    const b = makePreset(7);
    const c = makePreset(8);
    run(a, 200, beats);
    run(b, 200, beats);
    run(c, 200, beats);
    expect(a.meteorSnapshot()).toEqual(b.meteorSnapshot());
    expect(a.meteorSnapshot()).not.toEqual(c.meteorSnapshot());
  });

  it('dt=0 や極端な dt・値でも NaN にならない', () => {
    const p = makePreset();
    p.update(frame(0, { dt: 0, mid: 1, high: 1, rms: 1 }), params());
    p.update(frame(1, { dt: 9, beat: 1, beatIndex: 2 }), params());
    p.update(frame(2, { dt: Number.NaN, beat: 1, beatIndex: 3 }), params());
    const s = p.inspect();
    for (const v of [s.galaxyStrength, s.twinkle, s.ripple]) expect(Number.isFinite(v)).toBe(true);
    expect(p.meteorSnapshot().every((v) => Number.isFinite(v))).toBe(true);
  });

  it('縦長への resize・テーマ切り替え・dispose で落ちない', () => {
    const p = makePreset();
    p.resize(1080, 1920);
    for (const theme of ['gold', 'ice', 'neon', 'mono', 'unknown-theme', 'default']) {
      run(p, 2, beats, params({ colorTheme: theme }));
    }
    expect(() => p.dispose()).not.toThrow();
  });
});
