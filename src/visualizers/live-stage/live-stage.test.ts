import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/random';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { LiveStagePreset, MAX_STROBE_HZ, PHRASE_BEATS } from './preset';

/**
 * WebGL を使わずに (three.js のシーングラフだけで) Live Stage を動かし、
 * 反応設計どおりに数値が動くか・ストロボが上限を超えないか・同じ seed なら同じ演出になるかを確かめる。
 */

const fakeRenderer = { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer;
type Params = CommonParams & Record<string, unknown>;
const params = (o: Partial<CommonParams> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;

function makePreset(seed = 42, p: Params = params()): LiveStagePreset {
  const preset = new LiveStagePreset();
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

function run(preset: LiveStagePreset, frames: number, o: (i: number) => Partial<AudioFrame>, p: Params = params()): void {
  for (let i = 0; i < frames; i++) preset.update(frame(i / 60, o(i)), p);
}

/** 120 BPM 相当: 30 フレームごとに新しいビート */
const beats = (i: number): Partial<AudioFrame> => ({ beatIndex: Math.floor(i / 30), beat: Math.exp(-(i % 30) / 10) });

/** ライトの向き (leanX × 8, leanZ × 8) だけを取り出す */
const aim = (p: LiveStagePreset): number[] => p.stageSnapshot().slice(0, 16);
const distance = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0);

describe('LiveStagePreset', () => {
  it('bass が強いほどスモークが濃くなる', () => {
    const dry = makePreset();
    const smoky = makePreset();
    run(dry, 60, () => ({ bass: 0 }));
    run(smoky, 60, () => ({ bass: 1 }));
    expect(smoky.inspect().smoke).toBeGreaterThan(0.8);
    expect(smoky.inspect().beamDensity).toBeGreaterThan(dry.inspect().beamDensity + 0.6);
  });

  it('スモークは bass が止むとゆっくり薄くなる', () => {
    const p = makePreset();
    run(p, 60, () => ({ bass: 1 }));
    const peak = p.inspect().smoke;
    run(p, 10, () => ({ bass: 0 }));
    const soon = p.inspect().smoke;
    expect(soon).toBeLessThan(peak);
    expect(soon).toBeGreaterThan(peak * 0.7);
  });

  it('high が無ければレーザーは出ず、high が強いと点滅する', () => {
    const calm = makePreset();
    const bright = makePreset();
    let calmMax = 0;
    let brightMax = 0;
    for (let i = 0; i < 300; i++) {
      calm.update(frame(i / 60, { high: 0 }), params());
      bright.update(frame(i / 60, { high: 1 }), params());
      calmMax = Math.max(calmMax, calm.inspect().lasersVisible);
      brightMax = Math.max(brightMax, bright.inspect().lasersVisible);
    }
    expect(calmMax).toBe(0);
    expect(brightMax).toBeGreaterThan(0);
    expect(bright.inspect().laserFlashes).toBeGreaterThan(5);
  });

  it(`レーザーの点灯は high が激しく揺れても毎秒 ${MAX_STROBE_HZ} 回を超えない`, () => {
    const p = makePreset();
    let onsets = 0;
    let wasOn = false;
    const seconds = 10;
    for (let i = 0; i < seconds * 60; i++) {
      // しきい値をまたいで毎フレーム揺れる high
      p.update(frame(i / 60, { high: i % 2 === 0 ? 1 : 0 }), params({ sensitivity: 1 }));
      const on = p.inspect().lasersVisible > 0;
      if (on && !wasOn) onsets++;
      wasOn = on;
    }
    expect(onsets).toBeGreaterThan(0);
    expect(onsets).toBeLessThanOrEqual(MAX_STROBE_HZ * seconds);
  });

  it('ビートでライトが振られ、ビートが無ければゆっくり動くだけ', () => {
    const rhythmic = makePreset();
    const idle = makePreset();
    const moves: number[] = [];
    const idleMoves: number[] = [];
    for (let beat = 0; beat < 6; beat++) {
      const before = aim(rhythmic);
      const idleBefore = aim(idle);
      for (let f = 0; f < 30; f++) {
        const i = beat * 30 + f;
        rhythmic.update(frame(i / 60, beats(i)), params());
        idle.update(frame(i / 60, {}), params());
      }
      moves.push(distance(before, aim(rhythmic)));
      idleMoves.push(distance(idleBefore, aim(idle)));
    }
    const avg = (v: number[]): number => v.slice(1).reduce((s, x) => s + x, 0) / (v.length - 1);
    expect(avg(moves)).toBeGreaterThan(avg(idleMoves) * 3);
  });

  it(`パターンは ${PHRASE_BEATS} ビートごとに切り替わり、直前と同じにはならない`, () => {
    const p = makePreset(5);
    const seen: string[] = [p.inspect().pattern];
    for (let i = 0; i < 30 * PHRASE_BEATS * 4; i++) {
      p.update(frame(i / 60, beats(i)), params());
      const now = p.inspect().pattern;
      if (now !== seen[seen.length - 1]) seen.push(now);
    }
    // 0..31 ビート → 8, 16, 24 ビート目で 3 回切り替わる
    expect(p.inspect().patternChanges).toBe(3);
    expect(seen.length).toBe(4);
  });

  it('Intensity が高いほど光の筋が明るく、スモークも濃い', () => {
    const low = makePreset();
    const high = makePreset();
    run(low, 60, (i) => ({ ...beats(i), bass: 0.8 }), params({ intensity: 0.1 }));
    run(high, 60, (i) => ({ ...beats(i), bass: 0.8 }), params({ intensity: 1 }));
    expect(high.inspect().beamStrength).toBeGreaterThan(low.inspect().beamStrength * 1.5);
    expect(high.inspect().beamDensity).toBeGreaterThan(low.inspect().beamDensity);
  });

  it('同じ seed・同じ音声なら照明の動きが完全に一致し、seed が違えば変わる (書き出しの再現性)', () => {
    const drive = (i: number): Partial<AudioFrame> => ({ ...beats(i), high: (i % 90) / 90, bass: 0.5 });
    const a = makePreset(7);
    const b = makePreset(7);
    const c = makePreset(8);
    run(a, 1000, drive);
    run(b, 1000, drive);
    run(c, 1000, drive);
    expect(a.stageSnapshot()).toEqual(b.stageSnapshot());
    expect(a.stageSnapshot()).not.toEqual(c.stageSnapshot());
  });

  it('dt=0 や極端な dt・値でも NaN にならない', () => {
    const p = makePreset();
    p.update(frame(0, { dt: 0, bass: 1, high: 1 }), params());
    p.update(frame(1, { dt: 9, beat: 1, beatIndex: 2, high: 1 }), params());
    p.update(frame(2, { dt: Number.NaN, beat: 1, beatIndex: Number.NaN }), params());
    p.update(frame(3, { beatIndex: 1e9, bass: Number.NaN }), params({ intensity: Number.NaN }));
    const s = p.inspect();
    for (const v of [s.smoke, s.beamDensity, s.beamStrength]) expect(Number.isFinite(v)).toBe(true);
    expect(p.stageSnapshot().every((v) => Number.isFinite(v))).toBe(true);
  });

  it('縦長への resize・テーマ切り替え・dispose で落ちない', () => {
    const p = makePreset();
    p.resize(1080, 1920);
    for (const theme of ['gold', 'ice', 'neon', 'mono', 'unknown-theme', 'default']) {
      run(p, 2, (i) => ({ ...beats(i), high: 1 }), params({ colorTheme: theme }));
    }
    expect(p.stageSnapshot().every((v) => Number.isFinite(v))).toBe(true);
    expect(() => p.dispose()).not.toThrow();
  });
});
