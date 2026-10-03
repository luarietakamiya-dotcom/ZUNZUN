import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { makeRng } from '../../core/random';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { manifest } from './index';
import { SpeakerMegaPreset } from './preset';
import { MEGA_BARS, MEGA_RINGS, MEGA_WAVES } from './shaders';

/** WebGL を使わずに (three.js のシーングラフだけで) Mega Speaker を動かし、反応設計どおりに数値が動くかを確かめる。 */

type Params = CommonParams & Record<string, unknown>;
const params = (o: Record<string, unknown> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;
const fakeRenderer = {} as THREE.WebGLRenderer;

function makePreset(seed = 5, p: Params = params(), w = 1280, h = 720): SpeakerMegaPreset {
  const preset = new SpeakerMegaPreset();
  preset.init({ renderer: fakeRenderer, width: w, height: h, seed, params: p, rng: makeRng(seed) });
  return preset;
}

function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return { t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64), ...o };
}

function run(p: SpeakerMegaPreset, frames: number, o: (i: number) => Partial<AudioFrame>, pr: Params = params()): void {
  for (let i = 0; i < frames; i++) p.update(frame(i / 60, o(i)), pr);
}

describe('SpeakerMegaPreset', () => {
  it('定義: 設定は 大きさ・左右・上下・回る光の筋・虹色の速さ・まわりの棒・拍の衝撃波。黒い背景に光だけ', () => {
    expect(manifest.id).toBe('speaker-mega');
    expect(manifest.controls!.map((c) => c.key)).toEqual(['size', 'offsetX', 'offsetY', 'overflow', 'rays', 'rainbow', 'equalizer', 'waves']);
    const p = makePreset();
    expect((p.scene.background as THREE.Color).getHex()).toBe(0x000000);
    p.dispose();
  });

  it('静かなときは、コーン・棒・波・星は動かない (光の筋はゆっくり回り続ける)', () => {
    const p = makePreset();
    run(p, 120, () => ({}));
    const s = p.inspect();
    expect(s.cap).toBeLessThan(0.02);
    expect(Math.max(...s.eq)).toBeLessThan(0.02);
    expect(s.waveCount).toBe(0);
    expect(s.star).toBeLessThan(0.02);
    expect(s.rot).toBeGreaterThan(0.2);
    expect(s.rotSpeed).toBeGreaterThan(0.1);
    p.dispose();
  });

  it('bass でコーンが動く (立ち上がりは速く、戻りはゆっくり)。動きは外のリングへ時間差で伝わる。光の筋とハローも伸びる', () => {
    const p = makePreset();
    run(p, 5, () => ({ bass: 1 }));
    const early = p.inspect();
    expect(early.cap).toBeGreaterThan(0.4);
    expect(early.ringEx).toHaveLength(MEGA_RINGS);
    expect(early.ringEx[0]!).toBeGreaterThan(early.ringEx[MEGA_RINGS - 1]!);
    run(p, 6, () => ({ bass: 0 }));
    expect(p.inspect().cap).toBeGreaterThan(early.cap * 0.3);
    run(p, 90, () => ({ bass: 1 }));
    const loud = p.inspect();
    expect(loud.cap).toBeLessThanOrEqual(1.2 + 1e-9);
    expect(loud.rayLen).toBeGreaterThan(2);
    expect(loud.halo).toBeGreaterThan(0.5);
    p.dispose();
  });

  it('拍が変わると、衝撃波・星の閃光・回転のキック・虹色の進みが起きる。同じ拍の間は増えない。衝撃波は 6 本まで', () => {
    // 基準: 静かなときの回る速さ
    const calm = makePreset();
    run(calm, 30, () => ({}));
    const base = calm.inspect();
    calm.dispose();
    const p = makePreset();
    run(p, 30, () => ({}));
    p.update(frame(0.5, { bass: 0.8, beat: 1, beatIndex: 0 }), params());
    const s1 = p.inspect();
    expect(s1.waveCount).toBe(1);
    expect(s1.star).toBeGreaterThan(0.4);
    expect(s1.rotSpeed).toBeGreaterThan(base.rotSpeed + 1);
    p.update(frame(1 / 60, { bass: 0.8, beat: 0.9, beatIndex: 0 }), params());
    expect(p.inspect().waveCount).toBe(1);
    for (let i = 1; i < 16; i++) p.update(frame(i / 60, { bass: 0.8, beat: 1, beatIndex: i }), params());
    expect(p.inspect().waveCount).toBeLessThanOrEqual(MEGA_WAVES);
    // 拍が止めば、星・衝撃波は消え、回転は基本の速さへ戻る (なめらかに)
    run(p, 60 * 10, () => ({}));
    const rest = p.inspect();
    expect(rest.waveCount).toBe(0);
    expect(rest.star).toBeLessThan(0.02);
    expect(rest.rotSpeed).toBeLessThan(base.rotSpeed + 0.15);
    p.dispose();
  });

  it('回転のキックはなめらかに戻る (1 コマで急に変わらない。光過敏への配慮)。向きは変わらない', () => {
    const p = makePreset();
    p.update(frame(0, { bass: 1, beat: 1, beatIndex: 0 }), params());
    let prevSpeed = p.inspect().rotSpeed;
    let prevRot = p.inspect().rot;
    for (let i = 1; i < 120; i++) {
      p.update(frame(i / 60, { bass: 0, beat: 0, beatIndex: 0 }), params());
      const s = p.inspect();
      expect(s.rot).toBeGreaterThan(prevRot); // 逆回りしない
      expect(prevSpeed - s.rotSpeed).toBeLessThan(0.2); // 1 コマで 0.2 rad/s より急には落ちない
      prevSpeed = s.rotSpeed;
      prevRot = s.rot;
    }
    p.dispose();
  });

  it('中音が強いほど光の筋が速く回る。Motion でも速くなる', () => {
    const quiet = makePreset();
    const mid = makePreset();
    const fast = makePreset();
    run(quiet, 60, () => ({}), params({ motion: 0 }));
    run(mid, 60, () => ({ mid: 1 }), params({ motion: 0, sensitivity: 1 }));
    run(fast, 60, () => ({}), params({ motion: 1 }));
    expect(mid.inspect().rotSpeed).toBeGreaterThan(quiet.inspect().rotSpeed + 0.3);
    expect(fast.inspect().rotSpeed).toBeGreaterThan(quiet.inspect().rotSpeed + 0.3);
    for (const p of [quiet, mid, fast]) p.dispose();
  });

  it('帯域ごとの強さで、その帯域の棒が伸びる (ほかは伸びない)', () => {
    const p = makePreset();
    const bands = new Float32Array(64);
    bands[8] = 1;
    bands[30] = 0.5;
    run(p, 20, () => ({ bands }), params({ sensitivity: 1 }));
    const eq = p.inspect().eq;
    expect(eq).toHaveLength(MEGA_BARS);
    expect(eq[8]!).toBeGreaterThan(0.7);
    expect(eq[30]!).toBeGreaterThan(0.3);
    expect(eq[30]!).toBeLessThan(eq[8]!);
    expect(eq[2]!).toBeLessThan(0.02);
    p.dispose();
  });

  it('虹色は、拍ごとに進み、時間でも流れる。始まりの色は seed で決まる (同じ seed なら同じ)', () => {
    const a = makePreset(5);
    const b = makePreset(5);
    const c = makePreset(6);
    for (const p of [a, b, c]) p.update(frame(0), params());
    expect(a.inspect().hue).toBe(b.inspect().hue);
    expect(a.inspect().hue).not.toBe(c.inspect().hue);
    const h0 = a.inspect().hue;
    a.update(frame(0, { bass: 1, beat: 1, beatIndex: 0 }), params());
    // 拍で色が進む。ただし 1 コマでは飛ばない (なめらかに。広い範囲の明るさが急に変わらないように)
    const h1 = a.inspect().hue;
    expect(Math.abs(h1 - h0)).toBeLessThan(0.01);
    run(a, 60, () => ({ bass: 0, beatIndex: 0 }));
    expect(a.inspect().hue).not.toBe(h0);
    // 流れる速さの設定: 速いほど、時間でよく動く
    const slow = makePreset(5);
    const fast = makePreset(5);
    run(slow, 300, () => ({}), params({ rainbow: 0 }));
    run(fast, 300, () => ({}), params({ rainbow: 1 }));
    const dist = (x: number, y: number): number => Math.min(Math.abs(x - y), 1 - Math.abs(x - y));
    expect(dist(fast.inspect().hue, b.inspect().hue)).toBeGreaterThan(dist(slow.inspect().hue, b.inspect().hue));
    for (const p of [a, b, c, slow, fast]) p.dispose();
  });

  it('大きさと位置の設定: 半径は大きさに比例し、位置は棒の先まで画面に収まる範囲。範囲外の値は丸める', () => {
    const p = makePreset();
    p.update(frame(0), params({ size: 1, offsetX: 0, offsetY: 0 }));
    expect(p.inspect().radius).toBeCloseTo(0.42, 6);
    expect(p.inspect().center).toEqual({ x: 0, y: 0 });
    p.update(frame(0), params({ size: 0.8, offsetX: 1, offsetY: -1 }));
    const s = p.inspect();
    expect(s.center.x + s.radius * 1.9).toBeLessThanOrEqual(s.aspect + 1e-9);
    expect(s.center.y - s.radius * 1.9).toBeGreaterThanOrEqual(-1 - 1e-9);
    p.update(frame(0), params({ size: 99, offsetX: 99, offsetY: -99 }));
    expect(p.inspect().radius).toBeCloseTo(0.42 * 1.6, 6);
    p.dispose();
  });

  it('同じ seed・同じ音なら同じ結果 (書き出しの再現性)。更新中は Math.random を使わない', () => {
    const o = (i: number): Partial<AudioFrame> => ({ bass: Math.abs(Math.sin(i / 7)), mid: Math.abs(Math.cos(i / 5)), beat: i % 30 === 0 ? 1 : 0, beatIndex: Math.floor(i / 30), bands: new Float32Array(64).fill(Math.abs(Math.cos(i / 11))) });
    const a = makePreset(9);
    const b = makePreset(9);
    // three.js 自身が (オブジェクトの UUID に) Math.random を使うので、作ったあと、更新している間だけ見張る
    const spy = vi.spyOn(Math, 'random');
    run(a, 200, o);
    run(b, 200, o);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(a.inspect()).toEqual(b.inspect());
    a.dispose();
    b.dispose();
  });

  it('NaN・極端な値でも壊れない (値は有限のまま)。縦長の画面でも壊れない', () => {
    const p = makePreset(5, params(), 720, 1280);
    const bad = frame(0, { bass: Number.NaN, mid: Infinity, high: -5, beat: Number.NaN, beatIndex: Number.NaN, dt: Number.NaN, bands: new Float32Array(64).fill(Number.NaN) });
    expect(() => p.update(bad, params({ intensity: Number.NaN, motion: Number.NaN, size: Number.NaN, rainbow: Number.NaN, rays: Number.NaN }))).not.toThrow();
    run(p, 10, (i) => ({ bass: 1, beat: 1, beatIndex: i }), params({ intensity: Number.NaN }));
    const s = p.inspect();
    for (const v of [s.cap, s.rot, s.rotSpeed, s.rayLen, s.star, s.halo, s.hue, s.radius, s.center.x, s.center.y, ...s.ringEx, ...s.eq]) expect(Number.isFinite(v)).toBe(true);
    p.dispose();
  });

  it('dispose でジオメトリとマテリアルを片づける', () => {
    const p = makePreset();
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
