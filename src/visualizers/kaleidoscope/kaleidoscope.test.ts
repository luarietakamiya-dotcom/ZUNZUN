import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { manifest } from './index';
import { KaleidoscopePreset } from './preset';
import { KALEIDO_BANDS } from './shaders';

/** WebGL を使わずに (three.js のシーングラフだけで) Kaleidoscope を動かし、反応設計どおりに数値が動くかを確かめる。 */

type Params = CommonParams & Record<string, unknown>;
const params = (o: Record<string, unknown> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;
const fakeRenderer = {} as THREE.WebGLRenderer;

function makePreset(p: Params = params(), rng: () => number = () => 0.5): KaleidoscopePreset {
  const preset = new KaleidoscopePreset();
  preset.init({ renderer: fakeRenderer, width: 1280, height: 720, seed: 1, params: p, rng });
  return preset;
}

function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return { t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64), ...o };
}

function run(p: KaleidoscopePreset, frames: number, o: (i: number) => Partial<AudioFrame>, pr: Params = params()): void {
  for (let i = 0; i < frames; i++) p.update(frame(i / 60, o(i)), pr);
}

const LOUD = { rms: 0.5, spectralEnergy: 0.5, flux: 0.5, bass: 0.6, mid: 0.4, high: 0.3 };

describe('KaleidoscopePreset', () => {
  it('定義: 設定は 鏡の枚数・模様の細かさ・回転の速さ', () => {
    expect(manifest.id).toBe('kaleidoscope');
    expect(manifest.controls!.map((c) => c.key)).toEqual(['segments', 'detail', 'spin']);
    const p = makePreset();
    p.dispose();
  });

  it('静かなときも、ゆっくり回って形は残る (中心の宝石・帯は 0)', () => {
    const p = makePreset();
    const r0 = p.inspect().rot;
    run(p, 120, () => ({}));
    const s = p.inspect();
    expect(s.rot).toBeGreaterThan(r0);
    expect(s.bass).toBeLessThan(0.01);
    expect(Math.max(...s.bands)).toBeLessThan(0.01);
    expect(s.mood).toBeLessThan(0.01);
    p.dispose();
  });

  it('帯の強さで、その半径の帯が明るくなる (低音は中心、高音は外)', () => {
    const p = makePreset();
    const bands = new Float32Array(64);
    bands[0] = 1;
    bands[63] = 1;
    run(p, 30, () => ({ bands }), params({ sensitivity: 1 }));
    const s = p.inspect();
    expect(s.bands).toHaveLength(KALEIDO_BANDS);
    expect(s.bands[0]!).toBeGreaterThan(0.1);
    expect(s.bands[KALEIDO_BANDS - 1]!).toBeGreaterThan(0.1);
    expect(s.bands[KALEIDO_BANDS / 2]!).toBeLessThan(0.01);
    p.dispose();
  });

  it('低音で中心の宝石がふくらみ、全体が少し拡大する。戻りはゆっくり', () => {
    const p = makePreset();
    run(p, 30, () => ({ bass: 0.9 }), params({ sensitivity: 1 }));
    const loud = p.inspect();
    expect(loud.bass).toBeGreaterThan(0.5);
    expect(loud.zoom).toBeGreaterThan(1.03);
    expect(loud.zoom).toBeLessThanOrEqual(1.08);
    run(p, 6, () => ({}));
    expect(p.inspect().bass).toBeGreaterThan(0.2); // 6 フレームではまだ戻りきらない
    p.dispose();
  });

  it('曲調: 激しい曲が続くと mood が数秒かけて上がり、静かになるとゆっくり戻る。急には変わらない', () => {
    const p = makePreset();
    run(p, 6, () => LOUD);
    expect(p.inspect().mood).toBeLessThan(0.1); // 0.1 秒では動かない
    run(p, 60 * 12, () => LOUD);
    const high = p.inspect().mood;
    expect(high).toBeGreaterThan(0.6);
    run(p, 60 * 1, () => ({}));
    expect(p.inspect().mood).toBeGreaterThan(high * 0.7); // 1 秒ではほとんど戻らない
    run(p, 60 * 30, () => ({}));
    expect(p.inspect().mood).toBeLessThan(0.1);
    p.dispose();
  });

  it('曲調で色が変わる: 静かな曲と激しい曲で配色が違い、変わる途中はなめらか', () => {
    const p = makePreset();
    const col = (): number[] => {
      const u = (p as unknown as { material: THREE.ShaderMaterial }).material.uniforms;
      return (u.colA!.value as THREE.Color).toArray();
    };
    run(p, 10, () => ({}));
    const calm = col();
    let prev = calm;
    let maxStep = 0;
    for (let i = 0; i < 60 * 14; i++) {
      p.update(frame(i / 60, LOUD), params());
      const now = col();
      maxStep = Math.max(maxStep, Math.abs(now[0]! - prev[0]!), Math.abs(now[1]! - prev[1]!), Math.abs(now[2]! - prev[2]!));
      prev = now;
    }
    const lively = prev;
    expect(Math.abs(lively[0]! - calm[0]!) + Math.abs(lively[2]! - calm[2]!)).toBeGreaterThan(0.5);
    expect(maxStep).toBeLessThan(0.01); // 1 フレームの色の変化はごく小さい (急に変わらない)
    p.dispose();
  });

  it('音の明るさ (tone): 高い帯が中心なら上がり、低い帯が中心なら下がる (ゆっくり)', () => {
    const p = makePreset();
    const hi = new Float32Array(64).fill(0);
    for (let i = 48; i < 64; i++) hi[i] = 1;
    run(p, 60 * 15, () => ({ bands: hi }), params({ sensitivity: 1 }));
    const bright = p.inspect().tone;
    const lo = new Float32Array(64).fill(0);
    for (let i = 0; i < 8; i++) lo[i] = 1;
    run(p, 60 * 15, () => ({ bands: lo }), params({ sensitivity: 1 }));
    expect(bright).toBeGreaterThan(0.8);
    expect(p.inspect().tone).toBeLessThan(0.3);
    p.dispose();
  });

  it('拍で回転が一瞬だけ速くなる', () => {
    const base = makePreset();
    const kick = makePreset();
    run(base, 30, () => ({}));
    run(kick, 30, () => ({ beat: 1 }));
    expect(kick.inspect().rot).toBeGreaterThan(base.inspect().rot);
    base.dispose();
    kick.dispose();
  });

  it('鏡の枚数は 3〜12 の整数に丸める。壊れた値は既定 (6)', () => {
    const p = makePreset();
    p.update(frame(0), params({ segments: 99 }));
    expect(p.inspect().segments).toBe(12);
    p.update(frame(0), params({ segments: 0 }));
    expect(p.inspect().segments).toBe(3);
    p.update(frame(0), params({ segments: 5.4 }));
    expect(p.inspect().segments).toBe(5);
    p.update(frame(0), params({ segments: Number.NaN }));
    expect(p.inspect().segments).toBe(6);
    p.dispose();
  });

  it('回転の速さの設定が効く', () => {
    const slow = makePreset();
    const fast = makePreset();
    const s0 = slow.inspect().rot;
    const f0 = fast.inspect().rot;
    run(slow, 60, () => ({}), params({ spin: 0 }));
    run(fast, 60, () => ({}), params({ spin: 1 }));
    // 初期の位相 (seed から) を除いた、回った量で比べる
    expect(fast.inspect().rot - f0).toBeGreaterThan((slow.inspect().rot - s0) * 3);
    slow.dispose();
    fast.dispose();
  });

  it('同じ seed・同じ入力なら同じ結果 (乱数を使わない)', () => {
    const spy = (): number => 0.37;
    const a = makePreset(params(), spy);
    const b = makePreset(params(), spy);
    const bands = new Float32Array(64).map((_, i) => (i % 5) / 5);
    run(a, 200, (i) => ({ ...LOUD, bands, beat: i % 30 === 0 ? 1 : 0 }));
    run(b, 200, (i) => ({ ...LOUD, bands, beat: i % 30 === 0 ? 1 : 0 }));
    expect(a.inspect()).toEqual(b.inspect());
    const c = makePreset(params(), () => 0.9);
    run(c, 200, (i) => ({ ...LOUD, bands, beat: i % 30 === 0 ? 1 : 0 }));
    expect(c.inspect().rot).not.toBe(a.inspect().rot); // seed が違えば初期の位相が違う
    a.dispose();
    b.dispose();
    c.dispose();
  });

  it('update の中で Math.random を使わない', () => {
    const p = makePreset();
    const orig = Math.random;
    let called = 0;
    Math.random = () => {
      called++;
      return 0.5;
    };
    try {
      run(p, 60, () => LOUD);
    } finally {
      Math.random = orig;
    }
    expect(called).toBe(0);
    p.dispose();
  });

  it('壊れた値 (NaN など) が来ても、動きに残らない', () => {
    const p = makePreset();
    const bad = frame(0, { bass: Number.NaN, mid: Number.NaN, high: Number.NaN, rms: Number.NaN, flux: Number.NaN, spectralEnergy: Number.NaN, beat: Number.NaN, dt: Number.NaN, bands: new Float32Array(64).fill(Number.NaN) });
    expect(() => p.update(bad, params({ intensity: Number.NaN, motion: Number.NaN, detail: Number.NaN, spin: Number.NaN }))).not.toThrow();
    run(p, 30, () => LOUD);
    const s = p.inspect();
    for (const v of [s.rot, s.zoom, s.warp, s.bass, s.mood, s.tone, ...s.bands]) expect(Number.isFinite(v)).toBe(true);
    p.dispose();
  });

  it('配色: どの Color Theme でも、静かな色と激しい色が決まっていて、知らない名前は既定', () => {
    for (const theme of ['default', 'gold', 'ice', 'neon', 'mono', 'unknown']) {
      const p = makePreset(params({ colorTheme: theme }));
      run(p, 30, () => LOUD, params({ colorTheme: theme }));
      const u = (p as unknown as { material: THREE.ShaderMaterial }).material.uniforms;
      for (const k of ['colA', 'colB', 'colC']) {
        const rgb = (u[k]!.value as THREE.Color).toArray();
        expect(rgb.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
      }
      p.dispose();
    }
  });

  it('dispose できる (ジオメトリ・マテリアルを解放し、シーンを空にする)', () => {
    const p = makePreset();
    p.dispose();
    expect(p.scene.children).toHaveLength(0);
  });
});
