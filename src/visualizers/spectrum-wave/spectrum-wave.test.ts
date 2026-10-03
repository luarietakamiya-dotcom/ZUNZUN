import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { manifest } from './index';
import { SpectrumWavePreset } from './preset';
import { MAX_SPOTS, WAVE_POINTS } from './shaders';

/** WebGL を使わずに (three.js のシーングラフだけで) Spectrum Wave を動かし、反応設計どおりに数値が動くかを確かめる。 */

type Params = CommonParams & Record<string, unknown>;
const params = (o: Record<string, unknown> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;
const fakeRenderer = {} as THREE.WebGLRenderer;

function makePreset(p: Params = params()): SpectrumWavePreset {
  const preset = new SpectrumWavePreset();
  preset.init({ renderer: fakeRenderer, width: 1280, height: 720, seed: 1, params: p, rng: () => 0.5 });
  return preset;
}

function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return { t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64), ...o };
}

function run(p: SpectrumWavePreset, frames: number, o: (i: number) => Partial<AudioFrame>, pr: Params = params()): void {
  for (let i = 0; i < frames; i++) p.update(frame(i / 60, o(i)), pr);
}

describe('SpectrumWavePreset', () => {
  it('定義: 設定は 位置・高さ・反射・残像 (リボン)・塗り。黒い背景に光だけ', () => {
    expect(manifest.id).toBe('spectrum-wave');
    expect(manifest.controls!.map((c) => c.key)).toEqual(['position', 'height', 'mirror', 'ribbons', 'fill']);
    const p = makePreset();
    expect((p.scene.background as THREE.Color).getHex()).toBe(0x000000);
    p.dispose();
  });

  it('静かなときは曲線は平ら・光は走らない', () => {
    const p = makePreset();
    run(p, 120, () => ({}));
    const s = p.inspect();
    expect(Math.max(...s.fast, ...s.mid, ...s.slow)).toBeLessThan(0.02);
    expect(s.spotCount).toBe(0);
    p.dispose();
  });

  it('帯域の強さで、その位置の曲線が伸びる (低音は左、高音は右)。隣となめらかにつながる', () => {
    const p = makePreset();
    const bands = new Float32Array(64);
    bands[0] = 1;
    bands[46] = 1;
    run(p, 30, () => ({ bands }), params({ sensitivity: 1 }));
    const s = p.inspect();
    expect(s.fast).toHaveLength(WAVE_POINTS);
    expect(s.fast[0]!).toBeGreaterThan(0.2);
    expect(s.fast[WAVE_POINTS - 1]!).toBeGreaterThan(0.2);
    expect(s.fast[24]!).toBeLessThan(0.02);
    // なめらか: 隣の点との差が半分以下 (となりの帯域と 1-2-1 でならすので、孤立した 1 帯域 (差 1) でも針のようにならない)
    for (let j = 1; j < WAVE_POINTS; j++) expect(Math.abs(s.fast[j]! - s.fast[j - 1]!)).toBeLessThanOrEqual(0.55);
    p.dispose();
  });

  it('3 本の線は戻る速さが違う: 速い線は先に落ち、遅い線に前の形が残る (立ち上がりは速い線ほど速い)', () => {
    const p = makePreset();
    const bands = new Float32Array(64).fill(1);
    run(p, 3, () => ({ bands }), params({ sensitivity: 1 }));
    const rise = p.inspect();
    expect(rise.fast[10]!).toBeGreaterThan(rise.mid[10]!);
    expect(rise.mid[10]!).toBeGreaterThan(rise.slow[10]!);
    run(p, 60, () => ({ bands }), params({ sensitivity: 1 }));
    run(p, 20, () => ({}));
    const fall = p.inspect();
    expect(fall.fast[10]!).toBeLessThan(fall.mid[10]!);
    expect(fall.mid[10]!).toBeLessThan(fall.slow[10]!);
    expect(fall.slow[10]!).toBeGreaterThan(0.3);
    p.dispose();
  });

  it('拍が変わると光の点が左から走り出し、右へ向かって、やがて消える。同じ拍の間は増えない。同時に 3 つまで', () => {
    const p = makePreset();
    p.update(frame(0, { bass: 0.8, beat: 1, beatIndex: 0 }), params());
    expect(p.inspect().spotCount).toBe(1);
    const x0 = p.inspect().spotPositions[0]!;
    p.update(frame(1 / 60, { bass: 0.8, beat: 0.9, beatIndex: 0 }), params());
    expect(p.inspect().spotCount).toBe(1);
    expect(p.inspect().spotPositions[0]!).toBeGreaterThan(x0);
    for (let i = 1; i < 14; i++) p.update(frame(i / 60, { bass: 0.8, beat: 1, beatIndex: i }), params());
    expect(p.inspect().spotCount).toBeLessThanOrEqual(MAX_SPOTS);
    run(p, 60 * 5, () => ({}));
    expect(p.inspect().spotCount).toBe(0);
    // 拍でない (beat が小さい) ときは出ない
    const q = makePreset();
    q.update(frame(0, { beat: 0.1, beatIndex: 0 }), params());
    expect(q.inspect().spotCount).toBe(0);
    p.dispose();
    q.dispose();
  });

  it('設定: 位置・高さ・反射・残像・塗りが反映される。範囲外は丸める。曲線は画面の上にはみ出さない', () => {
    const p = makePreset();
    p.update(frame(0), params({ position: -1, height: 1, mirror: 0.2, ribbons: 0.3, fill: 0.4 }));
    const a = p.inspect();
    expect(a.baseY).toBeCloseTo(-0.8, 6);
    expect(a.height).toBeCloseTo(1.1, 6);
    expect(a.mirror).toBeCloseTo(0.2, 6);
    expect(a.ribbons).toBeCloseTo(0.3, 6);
    expect(a.fill).toBeCloseTo(0.4, 6);
    // 位置を上にして高くしても、曲線のてっぺんが画面の上端 (1) を越えない
    p.update(frame(0), params({ position: 1, height: 1 }));
    const b = p.inspect();
    expect(b.baseY + b.height).toBeLessThanOrEqual(1 - 0.05 + 1e-9);
    p.update(frame(0), params({ position: 99, height: 99, mirror: 99, ribbons: -9, fill: Number.NaN }));
    const c = p.inspect();
    expect(c.baseY + c.height).toBeLessThanOrEqual(1);
    expect(c.mirror).toBe(1);
    expect(c.ribbons).toBe(0);
    expect(Number.isFinite(c.fill)).toBe(true);
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
    expect(() => p.update(bad, params({ intensity: Number.NaN, position: Number.NaN, height: Number.NaN }))).not.toThrow();
    run(p, 10, (i) => ({ bass: 1, beat: 1, beatIndex: i, bands: new Float32Array(64).fill(1) }));
    const s = p.inspect();
    for (const v of [s.baseY, s.height, ...s.fast, ...s.mid, ...s.slow, ...s.spotPositions]) expect(Number.isFinite(v)).toBe(true);
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
