import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { manifest } from './index';
import { SpeakerConePreset } from './preset';
import { CONE_RINGS, EQ_BARS, MAX_BURSTS } from './shaders';

/**
 * WebGL を使わずに (three.js のシーングラフだけで) Speaker Cone を動かし、反応設計どおりに数値が動くかを確かめる。
 */

type Params = CommonParams & Record<string, unknown>;
const params = (o: Record<string, unknown> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;
const fakeRenderer = {} as THREE.WebGLRenderer;

function makePreset(p: Params = params(), w = 1280, h = 720): SpeakerConePreset {
  const preset = new SpeakerConePreset();
  preset.init({ renderer: fakeRenderer, width: w, height: h, seed: 1, params: p, rng: () => 0.5 });
  return preset;
}

function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return { t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64), ...o };
}

function run(p: SpeakerConePreset, frames: number, o: (i: number) => Partial<AudioFrame>, pr: Params = params()): void {
  for (let i = 0; i < frames; i++) p.update(frame(i / 60, o(i)), pr);
}

describe('SpeakerConePreset', () => {
  it('定義: 設定は 大きさ・左右・上下・まわりの棒・拍の波。既定は黒い背景に光だけ (スクリーンで絵に重ねる前提)', () => {
    expect(manifest.id).toBe('speaker-cone');
    expect(manifest.controls!.map((c) => c.key)).toEqual(['size', 'offsetX', 'offsetY', 'equalizer', 'waves']);
    const p = makePreset();
    expect((p.scene.background as THREE.Color).getHex()).toBe(0x000000);
    p.dispose();
  });

  it('静かなときは動かない (コーン・リング・棒・波とも小さい / 出ない)', () => {
    const p = makePreset();
    run(p, 120, () => ({}));
    const s = p.inspect();
    expect(s.cap).toBeLessThan(0.02);
    expect(Math.max(...s.ringEx)).toBeLessThan(0.02);
    expect(Math.max(...s.eq)).toBeLessThan(0.02);
    expect(s.burstCount).toBe(0);
    p.dispose();
  });

  it('bass でコーンが動く。立ち上がりは速く、戻りはゆっくり (光過敏への配慮)', () => {
    const p = makePreset();
    run(p, 6, () => ({ bass: 1 }));
    const up = p.inspect().cap;
    expect(up).toBeGreaterThan(0.6);
    // 音が止んで 6 コマ後は、まだ半分以上残る (戻りは立ち上がりより遅い)
    run(p, 6, () => ({ bass: 0 }));
    const after = p.inspect().cap;
    expect(after).toBeLessThan(up);
    expect(after).toBeGreaterThan(up * 0.45);
    // 上限
    run(p, 60, () => ({ bass: 1, beat: 1 }));
    expect(p.inspect().cap).toBeLessThanOrEqual(1.2 + 1e-9);
    p.dispose();
  });

  it('低音の動きは中心から外へ、時間差をつけて伝わる (外のリングほど遅れて動く)', () => {
    const p = makePreset();
    run(p, 5, () => ({ bass: 1 }));
    const early = p.inspect().ringEx;
    expect(early).toHaveLength(CONE_RINGS);
    expect(early[0]!).toBeGreaterThan(early[CONE_RINGS - 1]!);
    // 十分たてば外のリングにも届く
    run(p, 40, () => ({ bass: 1 }));
    const late = p.inspect().ringEx;
    expect(late[CONE_RINGS - 1]!).toBeGreaterThan(0.6);
    expect(Math.abs(late[0]! - late[CONE_RINGS - 1]!)).toBeLessThan(0.05);
    p.dispose();
  });

  it('時間差は、フレームの間隔が違っても同じ (30fps と 60fps で、同じ時間がたてば同じ動き)', () => {
    const a = makePreset();
    const b = makePreset();
    for (let i = 0; i < 12; i++) a.update(frame(i / 60, { bass: 1 }), params());
    for (let i = 0; i < 6; i++) b.update(frame(i / 30, { bass: 1, dt: 1 / 30 }), params());
    const ra = a.inspect().ringEx;
    const rb = b.inspect().ringEx;
    // 外のリングは中心の動きの遅れ。同じ向きに、同じくらい (30fps は荒いので ±0.2 を許す)
    for (let k = 0; k < CONE_RINGS; k++) expect(Math.abs(ra[k]! - rb[k]!)).toBeLessThan(0.2);
    a.dispose();
    b.dispose();
  });

  it('拍が変わると粒が飛び出し (1 回分)、遠くへ飛んでから薄れて消える。同じ拍の間は増えない。同時に 4 回分まで', () => {
    const p = makePreset();
    p.update(frame(0, { bass: 0.8, beat: 1, beatIndex: 0 }), params());
    expect(p.inspect().burstCount).toBe(1);
    const r0 = p.inspect().burstMaxRadius;
    p.update(frame(1 / 60, { bass: 0.8, beat: 0.9, beatIndex: 0 }), params());
    expect(p.inspect().burstCount).toBe(1);
    expect(p.inspect().burstMaxRadius).toBeGreaterThan(r0);
    // 拍をたくさん入れても 4 回分まで
    for (let i = 1; i <= 12; i++) p.update(frame(i / 60, { bass: 0.8, beat: 1, beatIndex: i }), params());
    expect(p.inspect().burstCount).toBeLessThanOrEqual(MAX_BURSTS);
    // 拍が止めば、やがて全部消える
    run(p, 60 * 8, () => ({}));
    expect(p.inspect().burstCount).toBe(0);
    p.dispose();
  });

  it('粒が飛ぶのは、スピーカーの半径の約 3 倍まで (画面いっぱいには広がらない = 背景の絵が隠れない)。最初に速く、遠くでゆっくり', () => {
    const p = makePreset();
    p.update(frame(0, { bass: 0.8, beat: 1, beatIndex: 0 }), params({ motion: 1 }));
    const radii: number[] = [];
    for (let i = 1; i <= 140; i++) {
      p.update(frame(i / 60, { bass: 0, beat: 0, beatIndex: 0 }), params({ motion: 1 }));
      if (p.inspect().burstCount > 0) radii.push(p.inspect().burstMaxRadius);
    }
    expect(radii.length).toBeGreaterThan(40);
    for (const r of radii) expect(r).toBeLessThanOrEqual(3.08 + 1e-9);
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeGreaterThanOrEqual(radii[i - 1]!);
    const early = radii[9]! - radii[0]!;
    const late = radii[radii.length - 1]! - radii[radii.length - 11]!;
    expect(early).toBeGreaterThan(late * 2);
    // Motion が小さいと、飛ぶのがゆっくり
    const slow = makePreset();
    slow.update(frame(0, { bass: 0.8, beat: 1, beatIndex: 0 }), params({ motion: 0 }));
    run(slow, 30, () => ({}), params({ motion: 0 }));
    const fast = makePreset();
    fast.update(frame(0, { bass: 0.8, beat: 1, beatIndex: 0 }), params({ motion: 1 }));
    run(fast, 30, () => ({}), params({ motion: 1 }));
    expect(fast.inspect().burstMaxRadius).toBeGreaterThan(slow.inspect().burstMaxRadius);
    for (const q of [p, slow, fast]) q.dispose();
  });

  it('拍で飛ぶ粒の量 0 なら出ない。beat が小さい (拍でない) ときも出ない', () => {
    const p = makePreset();
    const off = params({ waves: 0 });
    p.update(frame(0, { bass: 1, beat: 1, beatIndex: 0 }), off);
    expect(p.inspect().burstCount).toBe(0);
    p.update(frame(1 / 60, { bass: 1, beat: 0.1, beatIndex: 1 }), params());
    expect(p.inspect().burstCount).toBe(0);
    p.dispose();
  });

  it('帯域ごとの強さで、その帯域の棒が伸びる (ほかは伸びない)', () => {
    const p = makePreset();
    const bands = new Float32Array(64);
    bands[10] = 1;
    bands[25] = 0.5;
    run(p, 20, () => ({ bands }), params({ sensitivity: 1 }));
    const eq = p.inspect().eq;
    expect(eq).toHaveLength(EQ_BARS);
    expect(eq[10]!).toBeGreaterThan(0.7);
    expect(eq[25]!).toBeGreaterThan(0.3);
    expect(eq[25]!).toBeLessThan(eq[10]!);
    expect(eq[3]!).toBeLessThan(0.02);
    p.dispose();
  });

  it('大きさと位置の設定: 半径は大きさに比例し、位置は画面からはみ出さない範囲に収まる', () => {
    const p = makePreset();
    p.update(frame(0), params({ size: 1, offsetX: 0, offsetY: 0 }));
    expect(p.inspect().radius).toBeCloseTo(0.5, 6);
    expect(p.inspect().center).toEqual({ x: 0, y: 0 });
    // 大きさ 1 (外枠 = 半径の 1.9 倍 = 0.95): 右下の端まで寄せても、画面の中に収まる
    p.update(frame(0), params({ size: 1, offsetX: 1, offsetY: -1 }));
    const s = p.inspect();
    expect(s.center.x).toBeCloseTo(s.aspect - 0.95, 6);
    expect(s.center.x + s.radius * 1.9).toBeLessThanOrEqual(s.aspect + 1e-9);
    expect(s.center.y - s.radius * 1.9).toBeGreaterThanOrEqual(-1 - 1e-9);
    // 大きすぎて (外枠が画面の高さを超える) 余裕が無いときは、その向きは真ん中のまま
    p.update(frame(0), params({ size: 1.4, offsetX: 0, offsetY: 1 }));
    expect(p.inspect().radius).toBeCloseTo(0.7, 6);
    expect(p.inspect().center.y).toBe(0);
    // 範囲外の値は丸める
    p.update(frame(0), params({ size: 99, offsetX: 99, offsetY: -99 }));
    expect(p.inspect().radius).toBeCloseTo(0.8, 6);
    p.dispose();
  });

  it('縦長の画面でも壊れない (横幅の余裕が小さいと、位置は真ん中のまま)', () => {
    const p = makePreset(params(), 720, 1280);
    p.update(frame(0), params({ size: 1, offsetX: 1, offsetY: 0 }));
    const s = p.inspect();
    expect(s.aspect).toBeCloseTo(720 / 1280, 6);
    expect(s.center.x).toBeLessThanOrEqual(s.aspect + 1e-9);
    expect(Number.isFinite(s.center.x)).toBe(true);
    p.dispose();
  });

  it('同じ入力なら同じ結果になる (乱数を使わない = 書き出しの再現性)', () => {
    const a = makePreset();
    const b = makePreset();
    const o = (i: number): Partial<AudioFrame> => ({ bass: Math.abs(Math.sin(i / 7)), beat: i % 30 === 0 ? 1 : 0, beatIndex: Math.floor(i / 30), bands: new Float32Array(64).fill(Math.abs(Math.cos(i / 11))) });
    run(a, 200, o);
    run(b, 200, o);
    expect(a.inspect()).toEqual(b.inspect());
    a.dispose();
    b.dispose();
  });

  it('NaN・極端な値でも壊れない (値は有限のまま)。知らない配色名でも落ちない', () => {
    const p = makePreset(params({ colorTheme: 'no-such-theme' }));
    const bad = frame(0, { bass: Number.NaN, mid: Infinity, high: -5, rms: Number.NaN, beat: Number.NaN, beatIndex: Number.NaN, dt: Number.NaN, bands: new Float32Array(64).fill(Number.NaN) });
    expect(() => p.update(bad, params({ intensity: Number.NaN, motion: Number.NaN, size: Number.NaN, offsetX: Number.NaN, equalizer: Number.NaN }))).not.toThrow();
    run(p, 10, () => ({ bass: 1, beat: 1, beatIndex: 3 }), params({ intensity: Number.NaN }));
    const s = p.inspect();
    for (const v of [s.cap, s.radius, s.center.x, s.center.y, s.burstMaxRadius, ...s.ringEx, ...s.eq]) expect(Number.isFinite(v)).toBe(true);
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
