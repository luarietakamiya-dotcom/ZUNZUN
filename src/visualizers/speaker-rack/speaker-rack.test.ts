import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/random';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { bandsToBars, PeakMeter, stepSpring, vuTarget } from './parts';
import { SpeakerRackPreset } from './preset';

/**
 * WebGL を使わずに (three.js のシーングラフだけで) Speaker Rack を動かし、
 * 反応設計どおりに動くか・同じ seed なら同じ見た目になるか・壊れた値で NaN にならないか・片づけられるかを確かめる。
 */

const fakeRenderer = { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer;
type Params = CommonParams & Record<string, unknown>;
const params = (o: Partial<CommonParams> & Record<string, unknown> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;

function makePreset(seed = 42, p: Params = params(), w = 1280, h = 720): SpeakerRackPreset {
  const preset = new SpeakerRackPreset();
  preset.init({ renderer: fakeRenderer, width: w, height: h, seed, params: p, rng: makeRng(seed) });
  return preset;
}

function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return { t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64), ...o };
}

function run(p: SpeakerRackPreset, frames: number, o: (i: number) => Partial<AudioFrame>, pr: Params = params()): void {
  for (let i = 0; i < frames; i++) p.update(frame(i / 60, o(i)), pr);
}

const fullBands = (v: number): Float32Array => new Float32Array(64).fill(v);

/** シーンの中のすべての物の位置と向き (seed の再現性を比べる) */
function snapshot(p: SpeakerRackPreset): number[] {
  const out: number[] = [];
  p.scene.traverse((o) => out.push(o.position.x, o.position.y, o.position.z, o.rotation.z));
  return out;
}

describe('動きの計算 (parts)', () => {
  it('ばねは目標へ近づき、行き過ぎて戻る。大きな dt や NaN でも暴れない', () => {
    const s = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 60; i++) {
      stepSpring(s, 1, 1 / 60, 700, 30);
      max = Math.max(max, s.x);
    }
    expect(max).toBeGreaterThan(1);
    expect(s.x).toBeCloseTo(1, 1);
    stepSpring(s, 0, 5, 700, 30);
    expect(Math.abs(s.x)).toBeLessThan(0.05);
    stepSpring(s, Number.NaN, Number.NaN, 700, 30);
    expect(Number.isFinite(s.x)).toBe(true);
  });

  it('帯域をバーにまとめる: 低い音の帯域はそのまま左のバー、高い音は右のバー', () => {
    const bands = new Float32Array(64);
    bands[0] = 1;
    const out = bandsToBars(bands, 32, new Float32Array(32));
    expect(out[0]).toBeGreaterThan(0.9);
    expect(Math.max(...out.slice(8))).toBe(0);
    const hi = new Float32Array(64);
    hi.fill(0.5, 40);
    const out2 = bandsToBars(hi, 32, new Float32Array(32));
    expect(out2[31]).toBeGreaterThan(0.5);
    expect(out2[0]).toBe(0);
  });

  it('ピークの点はしばらく残ってから落ちる', () => {
    const m = new PeakMeter(1, 0.6, 1.1);
    for (let i = 0; i < 30; i++) m.update([1], 1 / 60);
    for (let i = 0; i < 18; i++) m.update([0], 1 / 60);
    expect(m.level[0]).toBeLessThan(0.3);
    expect(m.peak[0]).toBeGreaterThan(0.9);
    for (let i = 0; i < 120; i++) m.update([0], 1 / 60);
    expect(m.peak[0]).toBeLessThan(0.05);
  });

  it('VU メーターの目標は 0..1 (平方根で振る)', () => {
    expect(vuTarget(0)).toBe(0);
    expect(vuTarget(0.25)).toBeCloseTo(0.5, 9);
    expect(vuTarget(4)).toBe(1);
    expect(vuTarget(Number.NaN)).toBe(0);
  });
});

describe('SpeakerRackPreset', () => {
  it('bass でウーファーが前へ動き、音が止むと戻る。Intensity 0 なら動かない', () => {
    const p = makePreset();
    run(p, 30, () => ({}));
    expect(Math.abs(p.inspect().woofer)).toBeLessThan(1e-6);
    run(p, 12, () => ({ bass: 1 }));
    expect(p.inspect().woofer).toBeGreaterThan(0.4);
    run(p, 120, () => ({}));
    expect(Math.abs(p.inspect().woofer)).toBeLessThan(0.02);
    run(p, 30, () => ({ bass: 1 }), params({ intensity: 0 }));
    expect(Math.abs(p.inspect().woofer)).toBeLessThan(0.02);
    p.dispose();
  });

  it('high でツイーターが震え、帯域でスペクトラムの LED が点き、音が止むと消える', () => {
    const p = makePreset();
    run(p, 30, () => ({}));
    expect(p.inspect().spectrumLit).toBe(0);
    run(p, 20, () => ({ high: 1, bands: fullBands(0.8) }));
    expect(p.inspect().tweeter).toBeGreaterThan(0.3);
    expect(p.inspect().spectrumLit).toBeGreaterThan(100);
    run(p, 240, () => ({}));
    expect(p.inspect().spectrumLit).toBe(0);
    expect(p.inspect().tweeter).toBeLessThan(0.01);
    p.dispose();
  });

  it('音量で VU メーターの針が慣性を持って振れ、大きいと赤いランプが点く。静かになると戻って消える', () => {
    const p = makePreset();
    run(p, 3, () => ({ rms: 1, peak: 1 }), params({ sensitivity: 1 }));
    // 急には振り切れない (慣性)
    expect(p.inspect().vu).toBeLessThan(0.5);
    run(p, 40, () => ({ rms: 1, peak: 1 }), params({ sensitivity: 1 }));
    expect(p.inspect().vu).toBeGreaterThan(0.85);
    expect(p.inspect().vuLamp).toBe(true);
    expect(p.inspect().levelLit).toBeGreaterThan(10);
    run(p, 180, () => ({}), params({ sensitivity: 1 }));
    expect(p.inspect().vu).toBeLessThan(0.05);
    expect(p.inspect().vuLamp).toBe(false);
    p.dispose();
  });

  it('強い拍の頭で箱が少し震え、すぐ収まる', () => {
    const p = makePreset();
    run(p, 1, () => ({ beat: 1, beatIndex: 0 }));
    expect(p.inspect().shake).toBeGreaterThan(0.5);
    run(p, 60, () => ({ beatIndex: 0 }));
    expect(p.inspect().shake).toBeLessThan(0.01);
    p.dispose();
  });

  it('真空管は音量で少し明るくなる (0..1)', () => {
    const p = makePreset();
    run(p, 60, () => ({}));
    const quiet = p.inspect().tubeGlow;
    run(p, 60, () => ({ rms: 1 }), params({ sensitivity: 1 }));
    const loud = p.inspect().tubeGlow;
    expect(loud).toBeGreaterThan(quiet + 0.2);
    expect(loud).toBeLessThanOrEqual(1);
    p.dispose();
  });

  it('同じ seed・同じ音なら同じ見た目 (つまみの角度なども)、seed が違えば変わる', () => {
    const a = makePreset(7);
    const b = makePreset(7);
    const c = makePreset(8);
    const beat = (i: number): Partial<AudioFrame> => ({ bass: (i % 30) / 30, high: 0.5, rms: 0.4, bands: fullBands(0.3), beat: i % 30 === 0 ? 1 : 0, beatIndex: Math.floor(i / 30) });
    run(a, 200, beat);
    run(b, 200, beat);
    run(c, 200, beat);
    expect(snapshot(b)).toEqual(snapshot(a));
    expect(snapshot(c)).not.toEqual(snapshot(a));
    for (const p of [a, b, c]) p.dispose();
  });

  it('縦長の画面では離れて全体を収め、「ラックのアップ」では寄る', () => {
    const wide = makePreset();
    const tall = makePreset(42, params(), 720, 1280);
    wide.update(frame(0), params({ cameraMotion: 0 }));
    tall.update(frame(0), params({ cameraMotion: 0 }));
    expect(tall.camera.position.z).toBeGreaterThan(wide.camera.position.z * 1.5);
    const full = wide.camera.position.z;
    wide.update(frame(0), params({ cameraMotion: 0, framing: 'closeup' }));
    expect(wide.camera.position.z).toBeLessThan(full * 0.95);
    wide.update(frame(0), params({ cameraMotion: 0, framing: 'nonsense' }));
    expect(wide.camera.position.z).toBeCloseTo(full, 6);
    wide.dispose();
    tall.dispose();
  });

  it('dt=0 や極端な dt・値でも NaN にならない', () => {
    const p = makePreset();
    p.update(frame(0, { dt: 0, bass: 1, high: 1 }), params());
    p.update(frame(1, { dt: 5, bass: 1, high: 1, beat: 1, beatIndex: 3, rms: 1 }), params());
    p.update(frame(2, { dt: Number.NaN, high: Number.NaN, bass: Number.NaN, rms: Number.NaN, bands: fullBands(Number.NaN) }), params({ intensity: Number.NaN }));
    const i = p.inspect();
    for (const v of [i.woofer, i.tweeter, i.vu, i.tubeGlow, i.shake]) expect(Number.isFinite(v)).toBe(true);
    for (const v of snapshot(p)) expect(Number.isFinite(v)).toBe(true);
    p.dispose();
  });

  it('テーマを切り替えても落ちず、dispose で作ったものを片づける', () => {
    const p = makePreset();
    for (const theme of ['default', 'gold', 'ice', 'neon', 'unknown']) run(p, 2, () => ({ bass: 0.5, bands: fullBands(0.4) }), params({ colorTheme: theme }));
    // dispose で、シーンの中の材質・形が 1 つ残らず片づけられる
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    p.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        geos.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
      }
    });
    const disposed = new Set<object>();
    const watch = (e: { dispose: () => void }): void => {
      const orig = e.dispose.bind(e);
      e.dispose = () => {
        disposed.add(e);
        orig();
      };
    };
    // Sprite の形は three.js が全部の Sprite で共有するもの (片づけない) なので除く
    const spriteGeo = new THREE.Sprite().geometry;
    const all = [...[...geos].filter((g) => g !== spriteGeo), ...mats];
    for (const e of all) watch(e);
    expect(() => p.dispose()).not.toThrow();
    const left = all.filter((e) => !disposed.has(e)).map((e) => (e as { type?: string; name?: string }).type + ':' + ((e as { name?: string }).name ?? ''));
    expect(left).toEqual([]);
    expect(p.scene.children.length).toBe(0);
  });
});
