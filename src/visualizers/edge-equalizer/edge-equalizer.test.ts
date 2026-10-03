import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { manifest } from './index';
import { EdgeEqualizerPreset } from './preset';
import { EDGE_BARS, MAX_PULSES } from './shaders';

/** WebGL を使わずに (three.js のシーングラフだけで) Edge Equalizer を動かし、反応設計どおりに数値が動くかを確かめる。 */

type Params = CommonParams & Record<string, unknown>;
const params = (o: Record<string, unknown> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;
const fakeRenderer = {} as THREE.WebGLRenderer;

function makePreset(p: Params = params()): EdgeEqualizerPreset {
  const preset = new EdgeEqualizerPreset();
  preset.init({ renderer: fakeRenderer, width: 1280, height: 720, seed: 1, params: p, rng: () => 0.5 });
  return preset;
}

function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return { t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64), ...o };
}

function run(p: EdgeEqualizerPreset, frames: number, o: (i: number) => Partial<AudioFrame>, pr: Params = params()): void {
  for (let i = 0; i < frames; i++) p.update(frame(i / 60, o(i)), pr);
}

describe('EdgeEqualizerPreset', () => {
  it('定義: 設定は 使う辺・棒のスタイル・棒の長さ・ピーク線・拍で走る光。黒い背景に光だけ', () => {
    expect(manifest.id).toBe('edge-equalizer');
    expect(manifest.controls!.map((c) => c.key)).toEqual(['edges', 'style', 'length', 'peaks', 'pulse']);
    const p = makePreset();
    expect((p.scene.background as THREE.Color).getHex()).toBe(0x000000);
    p.dispose();
  });

  it('静かなときは、棒は伸びない・光は走らない (縁の細い線だけ)', () => {
    const p = makePreset();
    run(p, 120, () => ({}));
    const s = p.inspect();
    expect(Math.max(...s.levels)).toBeLessThan(0.02);
    expect(Math.max(...s.peaks)).toBeLessThan(0.02);
    expect(s.pulseCount).toBe(0);
    p.dispose();
  });

  it('帯域ごとの強さで、その位置の棒が伸びる (低音は先頭、高音は末尾)。立ち上がりは速く、戻りはゆっくり', () => {
    const p = makePreset();
    const bands = new Float32Array(64);
    bands[0] = 1; // 棒 0 (下の真ん中 = 低音)
    bands[46] = 1; // 棒 47 (上の真ん中 = 高音)
    bands[23] = 0.6; // 真ん中あたり
    run(p, 4, () => ({ bands }), params({ sensitivity: 1 }));
    const early = p.inspect();
    expect(early.levels).toHaveLength(EDGE_BARS);
    expect(early.levels[0]!).toBeGreaterThan(0.5);
    expect(early.levels[EDGE_BARS - 1]!).toBeGreaterThan(0.5);
    expect(early.levels[12]!).toBeLessThan(0.05);
    run(p, 20, () => ({ bands }), params({ sensitivity: 1 }));
    expect(p.inspect().levels[0]!).toBeGreaterThan(0.95);
    // 音が止むと、すぐには消えない
    run(p, 6, () => ({}), params({ sensitivity: 1 }));
    const after = p.inspect().levels[0]!;
    expect(after).toBeLessThan(0.95);
    expect(after).toBeGreaterThan(0.4);
    p.dispose();
  });

  it('ピーク線: 棒の先に残り、しばらく止まってから、一定の速さで落ちる (棒より下には落ちない)', () => {
    const p = makePreset();
    const bands = new Float32Array(64);
    bands[0] = 1;
    run(p, 20, () => ({ bands }), params({ sensitivity: 1 }));
    const top = p.inspect().peaks[0]!;
    expect(top).toBeGreaterThan(0.95);
    // 音が止んで 0.15 秒 (止まっている間) は、位置が変わらない
    run(p, 9, () => ({}));
    expect(p.inspect().peaks[0]!).toBeCloseTo(top, 3);
    // 止まる時間 (0.3 秒) のあと、落ちていく
    run(p, 30, () => ({}));
    const falling = p.inspect().peaks[0]!;
    expect(falling).toBeLessThan(top);
    run(p, 120, () => ({}));
    expect(p.inspect().peaks[0]!).toBeLessThan(falling);
    // 十分たてば棒 (ほぼ 0) まで落ちる。棒より下には行かない
    run(p, 240, () => ({}));
    const end = p.inspect();
    expect(end.peaks[0]!).toBeGreaterThanOrEqual(end.levels[0]! - 1e-9);
    expect(end.peaks[0]!).toBeLessThan(0.05);
    p.dispose();
  });

  it('bass で縁の細い線が明るくなる (なめらかに)', () => {
    const q = makePreset();
    const l = makePreset();
    run(q, 60, () => ({}));
    run(l, 60, () => ({ bass: 1 }));
    expect(l.inspect().frame).toBeGreaterThan(q.inspect().frame + 0.3);
    q.dispose();
    l.dispose();
  });

  it('拍が変わると、光が下の真ん中から走り出し、上の真ん中へ向かって、やがて消える。同じ拍の間は増えない。同時に 3 つまで', () => {
    const p = makePreset();
    p.update(frame(0, { bass: 0.8, beat: 1, beatIndex: 0 }), params());
    expect(p.inspect().pulseCount).toBe(1);
    const m0 = p.inspect().pulsePositions[0]!;
    p.update(frame(1 / 60, { bass: 0.8, beat: 0.9, beatIndex: 0 }), params());
    expect(p.inspect().pulseCount).toBe(1);
    expect(p.inspect().pulsePositions[0]!).toBeGreaterThan(m0);
    for (let i = 1; i < 14; i++) p.update(frame(i / 60, { bass: 0.8, beat: 1, beatIndex: i }), params());
    expect(p.inspect().pulseCount).toBeLessThanOrEqual(MAX_PULSES);
    run(p, 60 * 4, () => ({}));
    expect(p.inspect().pulseCount).toBe(0);
    p.dispose();
  });

  it('拍で走る光の量 0 なら出ない。beat が小さい (拍でない) ときも出ない', () => {
    const p = makePreset();
    p.update(frame(0, { bass: 1, beat: 1, beatIndex: 0 }), params({ pulse: 0 }));
    expect(p.inspect().pulseCount).toBe(0);
    p.update(frame(1 / 60, { bass: 1, beat: 0.1, beatIndex: 1 }), params());
    expect(p.inspect().pulseCount).toBe(0);
    p.dispose();
  });

  it('設定: 使う辺・LED 風・棒の長さ。知らない値は既定に戻り、範囲外は丸める', () => {
    const p = makePreset();
    p.update(frame(0), params({ edges: 'all' }));
    expect(p.inspect().edges).toEqual([1, 1, 1, 1]);
    p.update(frame(0), params({ edges: 'topbottom' }));
    expect(p.inspect().edges).toEqual([1, 0, 1, 0]);
    p.update(frame(0), params({ edges: 'sides' }));
    expect(p.inspect().edges).toEqual([0, 1, 0, 1]);
    p.update(frame(0), params({ edges: 'bottom' }));
    expect(p.inspect().edges).toEqual([1, 0, 0, 0]);
    p.update(frame(0), params({ edges: 'no-such-edge' }));
    expect(p.inspect().edges).toEqual([1, 1, 1, 1]);
    p.update(frame(0), params({ style: 'led' }));
    expect(p.inspect().led).toBe(1);
    p.update(frame(0), params({ style: 'smooth' }));
    expect(p.inspect().led).toBe(0);
    p.update(frame(0), params({ length: 1 }));
    expect(p.inspect().barLength).toBeCloseTo(0.5, 6);
    p.update(frame(0), params({ length: 99 }));
    expect(p.inspect().barLength).toBeCloseTo(0.75, 6);
    p.update(frame(0), params({ length: -5 }));
    expect(p.inspect().barLength).toBeCloseTo(0.2, 6);
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
    expect(() => p.update(bad, params({ intensity: Number.NaN, length: Number.NaN, peaks: Number.NaN, pulse: Number.NaN }))).not.toThrow();
    run(p, 10, (i) => ({ bass: 1, beat: 1, beatIndex: i, bands: new Float32Array(64).fill(1) }));
    const s = p.inspect();
    for (const v of [s.frame, s.barLength, ...s.levels, ...s.peaks, ...s.pulsePositions]) expect(Number.isFinite(v)).toBe(true);
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
