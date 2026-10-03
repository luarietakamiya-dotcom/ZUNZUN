import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { makeRng } from '../../core/random';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { manifest } from './index';
import { RipplesPreset } from './preset';
import { MAX_RIPPLES } from './shaders';

/**
 * WebGL を使わずに (three.js のシーングラフだけで) Ripples を動かし、反応設計どおりに数値が動くか・
 * 同じ seed なら波紋の位置まで同じになるかを確かめる。
 */

type Params = CommonParams & Record<string, unknown>;
const params = (o: Record<string, unknown> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;
const fakeRenderer = {} as THREE.WebGLRenderer;

function makePreset(seed = 7, p: Params = params()): RipplesPreset {
  const preset = new RipplesPreset();
  preset.init({ renderer: fakeRenderer, width: 1280, height: 720, seed, params: p, rng: makeRng(seed) });
  return preset;
}

function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return { t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64), ...o };
}

function run(p: RipplesPreset, frames: number, o: (i: number) => Partial<AudioFrame>, pr: Params = params()): void {
  for (let i = 0; i < frames; i++) p.update(frame(i / 60, o(i)), pr);
}

describe('RipplesPreset', () => {
  it('定義: 設定は 広がる速さ・波紋の量・波紋の大きさ。黒い背景に光だけ (スクリーンで絵に重ねる前提)', () => {
    expect(manifest.id).toBe('ripples');
    expect(manifest.controls!.map((c) => c.key)).toEqual(['speed', 'amount', 'size']);
    const p = makePreset();
    expect((p.scene.background as THREE.Color).getHex()).toBe(0x000000);
    p.dispose();
  });

  it('静かなときは波紋が出ない', () => {
    const p = makePreset();
    run(p, 120, () => ({}));
    expect(p.inspect().active).toBe(0);
    expect(p.inspect().spawned).toEqual({ big: 0, medium: 0, small: 0 });
    p.dispose();
  });

  it('低音の立ち上がりで、真ん中あたりに大きな波紋が 1 つ。鳴り続けても、続けては出ない (立ち上がりのときだけ)', () => {
    const p = makePreset();
    run(p, 1, () => ({ bass: 1 }));
    expect(p.inspect().spawned.big).toBe(1);
    const c = p.inspect().centers[0]!;
    expect(Math.abs(c.x)).toBeLessThanOrEqual(0.35 + 1e-9);
    expect(Math.abs(c.y)).toBeLessThanOrEqual(0.35 + 1e-9);
    // 鳴りっぱなしでは増えない
    run(p, 60, () => ({ bass: 1 }));
    expect(p.inspect().spawned.big).toBe(1);
    // いったん静かになって、また立ち上がると出る (0.2 秒あけて)
    run(p, 20, () => ({ bass: 0 }));
    run(p, 1, () => ({ bass: 1 }));
    expect(p.inspect().spawned.big).toBe(2);
    p.dispose();
  });

  it('拍が変わると中くらいの波紋。同じ拍の間は増えない。拍でない (beat が小さい) ときも出ない', () => {
    const p = makePreset();
    p.update(frame(0, { beat: 1, beatIndex: 0 }), params());
    expect(p.inspect().spawned.medium).toBe(1);
    p.update(frame(1 / 60, { beat: 0.9, beatIndex: 0 }), params());
    expect(p.inspect().spawned.medium).toBe(1);
    p.update(frame(2 / 60, { beat: 1, beatIndex: 1 }), params());
    expect(p.inspect().spawned.medium).toBe(2);
    p.update(frame(3 / 60, { beat: 0.1, beatIndex: 2 }), params());
    expect(p.inspect().spawned.medium).toBe(2);
    p.dispose();
  });

  it('高音で小さな波紋が、間隔をあけて出る (1 秒に 9 個まで)', () => {
    const p = makePreset();
    run(p, 60, () => ({ high: 1 }));
    const n = p.inspect().spawned.small;
    expect(n).toBeGreaterThanOrEqual(5);
    expect(n).toBeLessThanOrEqual(9);
    p.dispose();
  });

  it('波紋は外へ広がり、薄れて、寿命で消える。速さの設定で広がり方が変わる', () => {
    const slow = makePreset();
    const fast = makePreset();
    slow.update(frame(0, { bass: 1 }), params({ speed: 0 }));
    fast.update(frame(0, { bass: 1 }), params({ speed: 1 }));
    run(slow, 30, () => ({}), params({ speed: 0 }));
    run(fast, 30, () => ({}), params({ speed: 1 }));
    expect(fast.inspect().maxRadius).toBeGreaterThan(slow.inspect().maxRadius * 2);
    const a0 = fast.inspect().maxAmp;
    run(fast, 30, () => ({}), params({ speed: 1 }));
    expect(fast.inspect().maxAmp).toBeLessThan(a0);
    run(fast, 60 * 5, () => ({}), params({ speed: 1 }));
    expect(fast.inspect().active).toBe(0);
    slow.dispose();
    fast.dispose();
  });

  it('出た瞬間に急に光らない (出始めの明るさは小さく、少しずつ立ち上がる。光過敏への配慮)', () => {
    const p = makePreset();
    p.update(frame(0, { bass: 1, dt: 1 / 60 }), params());
    const first = p.inspect().maxAmp;
    run(p, 6, () => ({}));
    expect(p.inspect().maxAmp).toBeGreaterThan(first);
    expect(first).toBeLessThan(0.4);
    expect(p.inspect().maxAmp).toBeLessThanOrEqual(0.95);
    p.dispose();
  });

  it('同時に出るのは 14 個まで (古いものから置き換える)', () => {
    const p = makePreset();
    for (let i = 0; i < 80; i++) p.update(frame(i / 60, { beat: 1, beatIndex: i, high: 1, bass: i % 2 }), params({ amount: 1 }));
    expect(p.inspect().active).toBeLessThanOrEqual(MAX_RIPPLES);
    expect(p.inspect().active).toBeGreaterThan(5);
    p.dispose();
  });

  it('波紋の量の設定: 小さな低音は、量 0 では出ず、量 1 では出る', () => {
    const lo = makePreset();
    const hi = makePreset();
    lo.update(frame(0, { bass: 0.6 }), params({ amount: 0, sensitivity: 0.4 }));
    hi.update(frame(0, { bass: 0.6 }), params({ amount: 1, sensitivity: 0.4 }));
    expect(lo.inspect().spawned.big).toBe(0);
    expect(hi.inspect().spawned.big).toBe(1);
    lo.dispose();
    hi.dispose();
  });

  it('中域が強いほど、波の輪が細かくなる', () => {
    const quiet = makePreset();
    const loud = makePreset();
    run(quiet, 60, () => ({ mid: 0 }));
    run(loud, 60, () => ({ mid: 1 }), params({ sensitivity: 1 }));
    expect(loud.inspect().freq).toBeGreaterThan(quiet.inspect().freq + 10);
    quiet.dispose();
    loud.dispose();
  });

  it('同じ seed・同じ音なら波紋の位置まで同じ、seed が違えば位置が変わる (書き出しの再現性)。Math.random は使わない', () => {
    const o = (i: number): Partial<AudioFrame> => ({ beat: i % 20 === 0 ? 1 : 0, beatIndex: Math.floor(i / 20), bass: i % 40 === 0 ? 1 : 0, high: i % 17 === 0 ? 1 : 0 });
    const a = makePreset(11);
    const b = makePreset(11);
    const c = makePreset(12);
    // three.js 自身が (オブジェクトの UUID に) Math.random を使うので、作ったあと、更新している間だけ見張る
    const spy = vi.spyOn(Math, 'random');
    run(a, 150, o);
    run(b, 150, o);
    run(c, 150, o);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(a.inspect()).toEqual(b.inspect());
    expect(a.inspect().centers).not.toEqual(c.inspect().centers);
    for (const p of [a, b, c]) p.dispose();
  });

  it('NaN・極端な値でも壊れない (値は有限のまま)。知らない配色名でも落ちない', () => {
    const p = makePreset(7, params({ colorTheme: 'no-such-theme' }));
    const bad = frame(0, { bass: Number.NaN, mid: Infinity, high: -5, beat: Number.NaN, beatIndex: Number.NaN, dt: Number.NaN });
    expect(() => p.update(bad, params({ intensity: Number.NaN, speed: Number.NaN, amount: Number.NaN, size: Number.NaN }))).not.toThrow();
    run(p, 30, (i) => ({ bass: i % 2, beat: 1, beatIndex: i, high: 1 }), params({ speed: Number.NaN, size: 99 }));
    const s = p.inspect();
    for (const v of [s.maxRadius, s.maxAmp, s.freq, ...s.centers.flatMap((c) => [c.x, c.y])]) expect(Number.isFinite(v)).toBe(true);
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
