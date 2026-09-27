import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/random';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { SolarGatePreset } from './preset';

/**
 * WebGL を使わずに (three.js のシーングラフだけで) Solar Gate を動かし、
 * 反応設計どおりに数値が動くか・同じ seed なら同じ結果になるかを確かめる。
 * Reflector はレンダーターゲットを作るだけで GPU には触らないので、ここでも生成できる。
 */

const fakeRenderer = { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer;
type Params = CommonParams & Record<string, unknown>;
/** Visualizer パネルと同じく、共通パラメータを preset.update() が受け取る型にして渡す */
const params = (o: Partial<CommonParams> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;

function makePreset(seed = 42, p: Params = params()): SolarGatePreset {
  const preset = new SolarGatePreset();
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

function run(preset: SolarGatePreset, frames: number, o: (i: number) => Partial<AudioFrame>, p: Params = params()): void {
  for (let i = 0; i < frames; i++) preset.update(frame(i / 60, o(i)), p);
}

describe('SolarGatePreset', () => {
  it('bass が強いほど光線が長く伸びる', () => {
    const quiet = makePreset();
    const loud = makePreset();
    run(quiet, 60, () => ({ bass: 0 }));
    run(loud, 60, () => ({ bass: 1, bands: new Float32Array(64).fill(0.8) }));
    expect(loud.inspect().meanRayLength).toBeGreaterThan(quiet.inspect().meanRayLength * 3);
  });

  it('円環そのものは音に合わせて拡大縮小しない', () => {
    const p = makePreset();
    run(p, 120, (i) => ({ bass: i % 2, beat: (i % 30) / 30, mid: 1, high: 1 }));
    expect(p.inspect().ringScale).toBe(1);
  });

  it('high が強いほど粒子が多く放出される', () => {
    const calm = makePreset();
    const bright = makePreset();
    run(calm, 90, () => ({ high: 0 }));
    run(bright, 90, () => ({ high: 1 }));
    expect(bright.inspect().activeParticles).toBeGreaterThan(calm.inspect().activeParticles + 100);
  });

  it('beat で光柱がフラッシュする', () => {
    const p = makePreset();
    run(p, 5, () => ({ beat: 0 }));
    const idle = p.inspect().pillarStrength;
    run(p, 1, () => ({ beat: 1, beatIndex: 0 }));
    expect(p.inspect().pillarStrength).toBeGreaterThan(idle + 0.5);
  });

  it('同じ seed・同じ音声なら粒子の配置まで完全に一致し、seed が違えば変わる (書き出しの再現性)', () => {
    const audio = (i: number): Partial<AudioFrame> => ({ high: 0.5 + 0.5 * Math.sin(i / 7), beat: i % 30 === 0 ? 1 : 0, beatIndex: Math.floor(i / 30) });
    const a = makePreset(7);
    const b = makePreset(7);
    const c = makePreset(8);
    run(a, 150, audio);
    run(b, 150, audio);
    run(c, 150, audio);
    expect(Array.from(a.particlePositionsSnapshot())).toEqual(Array.from(b.particlePositionsSnapshot()));
    expect(Array.from(a.particlePositionsSnapshot())).not.toEqual(Array.from(c.particlePositionsSnapshot()));
  });

  it('dt=0 や極端な dt・値でも NaN にならない', () => {
    const p = makePreset();
    p.update(frame(0, { dt: 0, bass: 1, high: 1 }), params());
    p.update(frame(1, { dt: 5, bass: 1, high: 1, beat: 1, beatIndex: 3 }), params());
    p.update(frame(2, { dt: Number.NaN, high: 1 }), params());
    const positions = p.particlePositionsSnapshot();
    expect(positions.every((v) => Number.isFinite(v))).toBe(true);
    expect(Number.isFinite(p.inspect().meanRayLength)).toBe(true);
  });

  it('縦長の画面ではカメラを引いて円環が左右で切れないようにする', () => {
    const p = makePreset();
    p.resize(1920, 1080);
    const landscape = p.inspect().cameraDistance;
    p.resize(1080, 1920);
    expect(p.inspect().cameraDistance).toBeGreaterThan(landscape);
  });

  it('テーマを切り替えても落ちず、dispose できる', () => {
    const p = makePreset();
    for (const theme of ['gold', 'ice', 'neon', 'mono', 'unknown-theme', 'default']) {
      run(p, 2, () => ({ bass: 0.5 }), params({ colorTheme: theme }));
    }
    expect(() => p.dispose()).not.toThrow();
  });
});
