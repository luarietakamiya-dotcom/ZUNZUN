import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { manifest } from './index';
import { LedMatrixPreset } from './preset';
import { LED_BANDS } from './shaders';

/** WebGL を使わずに (three.js のシーングラフだけで) LED Matrix を動かし、反応設計どおりに数値が動くかを確かめる。 */

type Params = CommonParams & Record<string, unknown>;
const params = (o: Record<string, unknown> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;
const fakeRenderer = {} as THREE.WebGLRenderer;

function makePreset(p: Params = params()): LedMatrixPreset {
  const preset = new LedMatrixPreset();
  preset.init({ renderer: fakeRenderer, width: 1280, height: 720, seed: 1, params: p, rng: () => 0.5 });
  return preset;
}

function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return { t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64), ...o };
}

function run(p: LedMatrixPreset, frames: number, o: (i: number) => Partial<AudioFrame>, pr: Params = params()): void {
  for (let i = 0; i < frames; i++) p.update(frame(i / 60, o(i)), pr);
}

describe('LedMatrixPreset', () => {
  it('定義: 設定は 列の数・並べ方・色・高さ・LED の大きさ・うすい格子。黒い背景に光だけ', () => {
    expect(manifest.id).toBe('led-matrix');
    expect(manifest.controls!.map((c) => c.key)).toEqual(['columns', 'layout', 'colors', 'height', 'dot', 'grid']);
    const p = makePreset();
    expect((p.scene.background as THREE.Color).getHex()).toBe(0x000000);
    p.dispose();
  });

  it('静かなときは点灯しない (ピークも出ない)。格子だけがうっすら見える', () => {
    const p = makePreset();
    run(p, 120, () => ({}));
    const s = p.inspect();
    expect(Math.max(...s.levels)).toBeLessThan(0.02);
    expect(Math.max(...s.peaks)).toBeLessThan(0.02);
    expect(s.dim).toBeGreaterThan(0.02); // 点灯していない LED がうっすら見える
    expect(s.dim).toBeLessThan(0.15);
    p.dispose();
  });

  it('帯域の強さで、その列が点灯する (低音は左、高音は右)。立ち上がりは速く、戻りはゆっくり', () => {
    const p = makePreset();
    const bands = new Float32Array(64);
    bands[0] = 1;
    bands[46] = 0.6;
    run(p, 4, () => ({ bands }), params({ sensitivity: 1 }));
    const early = p.inspect();
    expect(early.levels).toHaveLength(LED_BANDS);
    expect(early.levels[0]!).toBeGreaterThan(0.5);
    expect(early.levels[LED_BANDS - 1]!).toBeGreaterThan(0.2);
    expect(early.levels[20]!).toBeLessThan(0.02);
    run(p, 30, () => ({ bands }), params({ sensitivity: 1 }));
    expect(p.inspect().levels[0]!).toBeGreaterThan(0.95);
    run(p, 6, () => ({}));
    const after = p.inspect().levels[0]!;
    expect(after).toBeLessThan(0.95);
    expect(after).toBeGreaterThan(0.4);
    p.dispose();
  });

  it('ピーク: 点灯の上に残り、しばらく止まってから落ちる。点灯より下には落ちない', () => {
    const p = makePreset();
    const bands = new Float32Array(64);
    bands[0] = 1;
    run(p, 20, () => ({ bands }), params({ sensitivity: 1 }));
    const top = p.inspect().peaks[0]!;
    expect(top).toBeGreaterThan(0.95);
    run(p, 9, () => ({}));
    expect(p.inspect().peaks[0]!).toBeCloseTo(top, 3); // 止まっている間
    run(p, 40, () => ({}));
    expect(p.inspect().peaks[0]!).toBeLessThan(top); // 落ち始める
    run(p, 400, () => ({}));
    const end = p.inspect();
    expect(end.peaks[0]!).toBeGreaterThanOrEqual(end.levels[0]! - 1e-9);
    expect(end.peaks[0]!).toBeLessThan(0.05);
    p.dispose();
  });

  it('bass で点灯していない LED が少し強くなり、拍で点灯の明るさが少し上がる (最大 +25%)', () => {
    const q = makePreset();
    const l = makePreset();
    run(q, 60, () => ({}));
    run(l, 60, () => ({ bass: 1, beat: 1 }));
    expect(l.inspect().dim).toBeGreaterThan(q.inspect().dim);
    expect(q.inspect().boost).toBeCloseTo(1, 3);
    expect(l.inspect().boost).toBeGreaterThan(1.15);
    expect(l.inspect().boost).toBeLessThanOrEqual(1.25 + 1e-9);
    q.dispose();
    l.dispose();
  });

  it('設定: 列の数・並べ方・色・高さ・LED の大きさ・うすい格子。知らない値は既定に戻り、範囲外は丸める', () => {
    const p = makePreset();
    p.update(frame(0), params({ columns: '24', layout: 'center', colors: 'theme', height: 1, dot: 1, grid: 1 }));
    const a = p.inspect();
    expect(a.cols).toBe(24);
    expect(a.centered).toBe(true);
    expect(a.classic).toBe(false);
    expect(a.heightFrac).toBeCloseTo(0.95, 6);
    expect(a.dotSize).toBeCloseTo(0.95, 6);
    p.update(frame(0), params({ columns: '48', layout: 'bottom', colors: 'classic', height: 0, dot: 0, grid: 0 }));
    const b = p.inspect();
    expect(b.cols).toBe(48);
    expect(b.centered).toBe(false);
    expect(b.classic).toBe(true);
    expect(b.heightFrac).toBeCloseTo(0.25, 6);
    expect(b.dotSize).toBeCloseTo(0.4, 6);
    expect(b.dim).toBe(0);
    p.update(frame(0), params({ columns: '999', layout: 'no', colors: 'no', height: 99, dot: -9, grid: Number.NaN }));
    const c = p.inspect();
    expect(c.cols).toBe(32);
    expect(c.centered).toBe(false);
    expect(c.classic).toBe(true);
    expect(c.heightFrac).toBeCloseTo(0.95, 6);
    expect(c.dotSize).toBeCloseTo(0.4, 6);
    expect(Number.isFinite(c.dim)).toBe(true);
    p.dispose();
  });

  it('同じ入力なら同じ結果になる (乱数を使わない = 書き出しの再現性)', () => {
    const a = makePreset();
    const b = makePreset();
    const o = (i: number): Partial<AudioFrame> => ({ bass: Math.abs(Math.sin(i / 7)), beat: i % 30 === 0 ? 1 : 0, beatIndex: Math.floor(i / 30), bands: new Float32Array(64).map((_, k) => Math.abs(Math.cos(i / 11 + k))) });
    run(a, 200, o);
    run(b, 200, o);
    expect(a.inspect()).toEqual(b.inspect());
    a.dispose();
    b.dispose();
  });

  it('NaN・極端な値でも壊れない (値は有限のまま)。縦長の画面・知らない配色名でも落ちない', () => {
    const p = makePreset(params({ colorTheme: 'no-such-theme' }));
    p.resize(720, 1280);
    const bad = frame(0, { bass: Number.NaN, mid: Infinity, high: -5, beat: Number.NaN, beatIndex: Number.NaN, dt: Number.NaN, bands: new Float32Array(64).fill(Number.NaN) });
    expect(() => p.update(bad, params({ intensity: Number.NaN, height: Number.NaN, dot: Number.NaN }))).not.toThrow();
    run(p, 10, (i) => ({ bass: 1, beat: 1, beatIndex: i, bands: new Float32Array(64).fill(1) }));
    const s = p.inspect();
    for (const v of [s.heightFrac, s.dotSize, s.dim, s.boost, ...s.levels, ...s.peaks]) expect(Number.isFinite(v)).toBe(true);
    p.dispose();
  });

  it('テーマを切り替えても落ちず、dispose でジオメトリとマテリアルを片づける', () => {
    const p = makePreset();
    for (const theme of ['gold', 'ice', 'neon', 'mono', 'default']) expect(() => p.update(frame(0), params({ colorTheme: theme }))).not.toThrow();
    const mesh = p.scene.children[0] as THREE.Mesh;
    let geo = 0;
    let mat = 0;
    mesh.geometry.addEventListener('dispose', () => geo++);
    (mesh.material as THREE.Material).addEventListener('dispose', () => mat++);
    p.dispose();
    expect(geo).toBe(1);
    expect(mat).toBe(1);
    expect(p.scene.children).toHaveLength(0);
  });
});
