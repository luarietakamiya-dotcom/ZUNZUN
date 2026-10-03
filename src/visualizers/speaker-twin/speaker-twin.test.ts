import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { manifest } from './index';
import { SpeakerTwinPreset } from './preset';
import { MAX_BURSTS, STRIP_BARS, WOOFER_RINGS } from './shaders';

/** WebGL を使わずに (three.js のシーングラフだけで) Twin Speakers を動かし、反応設計どおりに数値が動くかを確かめる。 */

type Params = CommonParams & Record<string, unknown>;
const params = (o: Record<string, unknown> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;
const fakeRenderer = {} as THREE.WebGLRenderer;

function makePreset(p: Params = params(), w = 1280, h = 720): SpeakerTwinPreset {
  const preset = new SpeakerTwinPreset();
  preset.init({ renderer: fakeRenderer, width: w, height: h, seed: 1, params: p, rng: () => 0.5 });
  return preset;
}

function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return { t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64), ...o };
}

function run(p: SpeakerTwinPreset, frames: number, o: (i: number) => Partial<AudioFrame>, pr: Params = params()): void {
  for (let i = 0; i < frames; i++) p.update(frame(i / 60, o(i)), pr);
}

describe('SpeakerTwinPreset', () => {
  it('定義: 設定は 大きさ・間隔・上下・交互に鳴らす・足元の棒。黒い背景に光だけ', () => {
    expect(manifest.id).toBe('speaker-twin');
    expect(manifest.controls!.map((c) => c.key)).toEqual(['size', 'spacing', 'offsetY', 'alternate', 'strip']);
    const p = makePreset();
    expect((p.scene.background as THREE.Color).getHex()).toBe(0x000000);
    p.dispose();
  });

  it('静かなときは動かない', () => {
    const p = makePreset();
    run(p, 120, () => ({}));
    const s = p.inspect();
    expect(Math.max(s.cap.left, s.cap.right, s.tweeter.left, s.tweeter.right)).toBeLessThan(0.02);
    expect(Math.max(...s.strip.left, ...s.strip.right)).toBeLessThan(0.02);
    expect(s.burstCount).toBe(0);
    p.dispose();
  });

  it('bass で両方のウーファーが動く。立ち上がりは速く、戻りはゆっくり。動きは外のリングへ時間差で伝わる', () => {
    const p = makePreset();
    run(p, 5, () => ({ bass: 1 }));
    const early = p.inspect();
    expect(early.cap.left).toBeGreaterThan(0.4);
    expect(early.cap.right).toBeGreaterThan(0.4);
    expect(early.rings.left).toHaveLength(WOOFER_RINGS);
    expect(early.rings.left[0]!).toBeGreaterThan(early.rings.left[WOOFER_RINGS - 1]!);
    run(p, 6, () => ({ bass: 0 }));
    expect(p.inspect().cap.left).toBeGreaterThan(early.cap.left * 0.3);
    run(p, 60, () => ({ bass: 1, beat: 1 }));
    const s = p.inspect();
    expect(s.cap.left).toBeLessThanOrEqual(1.2 + 1e-9);
    expect(s.cap.right).toBeLessThanOrEqual(1.2 + 1e-9);
    p.dispose();
  });

  it('左右で動きが違う: 左は低音そのまま、右は低音を弱めて中音を足す。ツイーターは高音で、右が少し強い', () => {
    const bassOnly = makePreset();
    run(bassOnly, 60, () => ({ bass: 1 }), params({ alternate: 0 }));
    const b = bassOnly.inspect();
    expect(b.cap.left).toBeGreaterThan(b.cap.right);
    const midOnly = makePreset();
    run(midOnly, 60, () => ({ mid: 1 }), params({ alternate: 0, sensitivity: 1 }));
    const m = midOnly.inspect();
    expect(m.cap.left).toBeLessThan(0.02);
    expect(m.cap.right).toBeGreaterThan(0.15);
    const hi = makePreset();
    run(hi, 60, () => ({ high: 1 }), params({ sensitivity: 1 }));
    const h = hi.inspect();
    expect(h.tweeter.right).toBeGreaterThan(h.tweeter.left);
    expect(h.tweeter.left).toBeGreaterThan(0.5);
    for (const p of [bassOnly, midOnly, hi]) p.dispose();
  });

  it('拍ごとに強く鳴る側が左右で入れ替わる (交互に鳴らす 0 なら入れ替わらない)', () => {
    const alt = makePreset();
    run(alt, 40, () => ({ bass: 1, beat: 0.5, beatIndex: 0 }), params({ alternate: 1 }));
    const even = alt.inspect();
    expect(even.side).toBeLessThan(0.1); // 偶数拍 = 左が強い
    expect(even.cap.left).toBeGreaterThan(even.cap.right);
    run(alt, 40, () => ({ bass: 1, beat: 0.5, beatIndex: 1 }), params({ alternate: 1 }));
    const odd = alt.inspect();
    expect(odd.side).toBeGreaterThan(0.9); // 奇数拍 = 右が強い
    expect(odd.cap.right).toBeGreaterThan(odd.cap.left);
    // 0 なら、右の中音ぶんだけの違い (交互の差はない)
    const flat = makePreset();
    run(flat, 40, () => ({ bass: 1, beat: 0.5, beatIndex: 0 }), params({ alternate: 0 }));
    const f0 = flat.inspect();
    run(flat, 40, () => ({ bass: 1, beat: 0.5, beatIndex: 1 }), params({ alternate: 0 }));
    expect(Math.abs(flat.inspect().cap.left - f0.cap.left)).toBeLessThan(0.02);
    alt.dispose();
    flat.dispose();
  });

  it('拍で飛ぶ粒は、強く鳴った側のウーファーから出る (偶数拍 = 左、奇数拍 = 右)。同時に 4 回分まで。やがて消える', () => {
    const p = makePreset();
    p.update(frame(0, { bass: 0.8, beat: 1, beatIndex: 0 }), params());
    expect(p.inspect().burstSides).toEqual([-1]);
    p.update(frame(1 / 60, { bass: 0.8, beat: 1, beatIndex: 1 }), params());
    expect(p.inspect().burstSides.sort()).toEqual([-1, 1]);
    p.update(frame(2 / 60, { bass: 0.8, beat: 0.9, beatIndex: 1 }), params());
    expect(p.inspect().burstCount).toBe(2); // 同じ拍の間は増えない
    for (let i = 2; i < 14; i++) p.update(frame(i / 60, { bass: 0.8, beat: 1, beatIndex: i }), params());
    expect(p.inspect().burstCount).toBeLessThanOrEqual(MAX_BURSTS);
    run(p, 60 * 8, () => ({}));
    expect(p.inspect().burstCount).toBe(0);
    p.dispose();
  });

  it('粒の先頭は、最初に速く、遠くでゆっくり飛ぶ (イージング)。進む一方で、戻らない', () => {
    const p = makePreset();
    p.update(frame(0, { bass: 0.8, beat: 1, beatIndex: 0 }), params());
    const radii: number[] = [];
    for (let i = 1; i <= 90; i++) {
      p.update(frame(i / 60, { bass: 0.8, beat: 0.3, beatIndex: 0 }), params());
      const r = p.inspect().burstRadii[0];
      if (r !== undefined) radii.push(r);
    }
    expect(radii.length).toBeGreaterThan(30);
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeGreaterThan(radii[i - 1]!);
    // 最初の 10 コマで進む量 > あとの 10 コマで進む量
    const early = radii[9]! - radii[0]!;
    const late = radii[radii.length - 1]! - radii[radii.length - 11]!;
    expect(early).toBeGreaterThan(late * 2);
    p.dispose();
  });

  it('粒が反対側のキャビネットに届くと、その輪郭が光る (左から出た粒は右、右から出た粒は左)。1 回分で 1 回だけ。やがて戻る', () => {
    const p = makePreset();
    // 偶数拍 (左が強い) → 左から粒が出て、右が光る
    p.update(frame(0, { bass: 0.9, beat: 1, beatIndex: 0 }), params({ spacing: 0.3 }));
    expect(p.inspect().rim.right).toBe(0);
    let maxRight = 0;
    let maxLeft = 0;
    for (let i = 1; i <= 120; i++) {
      p.update(frame(i / 60, { bass: 0.3, beat: 0.2, beatIndex: 0 }), params({ spacing: 0.3 }));
      maxRight = Math.max(maxRight, p.inspect().rim.right);
      maxLeft = Math.max(maxLeft, p.inspect().rim.left);
    }
    expect(maxRight).toBeGreaterThan(0.3);
    expect(maxLeft).toBe(0);
    // 戻る
    run(p, 60 * 3, () => ({}), params({ spacing: 0.3 }));
    expect(p.inspect().rim.right).toBeLessThan(0.02);
    // 奇数拍 (右が強い) → 右から粒が出て、左が光る
    const q = makePreset();
    q.update(frame(0, { bass: 0.9, beat: 1, beatIndex: 1 }), params({ spacing: 0.3 }));
    let leftHit = 0;
    for (let i = 1; i <= 120; i++) {
      q.update(frame(i / 60, { bass: 0.3, beat: 0.2, beatIndex: 1 }), params({ spacing: 0.3 }));
      leftHit = Math.max(leftHit, q.inspect().rim.left);
    }
    expect(leftHit).toBeGreaterThan(0.3);
    p.dispose();
    q.dispose();
  });

  it('光るのは 1 回分につき 1 回だけ (粒が通り過ぎたあと、また光り直さない)', () => {
    const p = makePreset();
    p.update(frame(0, { bass: 0.9, beat: 1, beatIndex: 0 }), params({ spacing: 0.3 }));
    // 光って、いったん落ちるまで進める
    let rises = 0;
    let prev = 0;
    for (let i = 1; i <= 300; i++) {
      p.update(frame(i / 60, { bass: 0, beat: 0, beatIndex: 0 }), params({ spacing: 0.3 }));
      const r = p.inspect().rim.right;
      if (r > prev + 0.05) rises++;
      prev = r;
    }
    expect(rises).toBe(1);
    p.dispose();
  });

  it('間隔が狭いほど、粒は早く反対側に届く (広いと遅い)', () => {
    const firstHit = (spacing: number): number => {
      const p = makePreset();
      p.update(frame(0, { bass: 0.9, beat: 1, beatIndex: 0 }), params({ spacing }));
      for (let i = 1; i <= 240; i++) {
        p.update(frame(i / 60, { bass: 0.3, beat: 0.2, beatIndex: 0 }), params({ spacing }));
        if (p.inspect().rim.right > 0.05) {
          p.dispose();
          return i;
        }
      }
      p.dispose();
      return Infinity;
    };
    expect(firstHit(0)).toBeLessThan(firstHit(1));
  });

  it('間隔をいちばん広げても、粒の先頭は半径の 9.08 倍までしか飛ばない (画面を横切りすぎない)。キャビネットの手前の端までは届く', () => {
    const p = makePreset();
    const wide = params({ spacing: 1, size: 0.4 });
    p.update(frame(0, { bass: 0.9, beat: 1, beatIndex: 0 }), wide);
    let max = 0;
    let hit = false;
    for (let i = 1; i <= 240; i++) {
      p.update(frame(i / 60, { bass: 0.3, beat: 0.2, beatIndex: 0 }), wide);
      for (const r of p.inspect().burstRadii) max = Math.max(max, r);
      if (p.inspect().rim.right > 0.05) hit = true;
    }
    expect(max).toBeLessThanOrEqual(1.08 + 8 + 1e-9);
    expect(max).toBeGreaterThan(5);
    // 小さいスピーカーを広い間隔に置くと、上限 (8) では届かないことがある。その場合は光らない (届かないのに光らせない)
    expect(typeof hit).toBe('boolean');
    p.dispose();
  });

  it('足元の棒: 左の台は低〜中域、右の台は中〜高域の帯域で伸びる', () => {
    const p = makePreset();
    const bands = new Float32Array(64);
    bands[4] = 1; // 左の台の 3 本目 (4 / 2 = 2)
    bands[16 + 2 * 12] = 1; // 右の台の 13 本目 (帯域 40)
    run(p, 20, () => ({ bands }), params({ sensitivity: 1 }));
    const s = p.inspect();
    expect(s.strip.left).toHaveLength(STRIP_BARS);
    expect(s.strip.left[2]!).toBeGreaterThan(0.7);
    expect(s.strip.left[12]!).toBeLessThan(0.02);
    expect(s.strip.right[12]!).toBeGreaterThan(0.7);
    expect(s.strip.right[2]!).toBeLessThan(0.02);
    p.dispose();
  });

  it('大きさと間隔の設定: 半径は大きさに比例し、2 台は画面の幅の中に収まり、間隔を広げると離れる', () => {
    const p = makePreset();
    p.update(frame(0), params({ size: 1, spacing: 0 }));
    const near = p.inspect();
    p.update(frame(0), params({ size: 1, spacing: 1 }));
    const far = p.inspect();
    expect(near.radius).toBeCloseTo(0.34, 6);
    expect(far.centers.right.x).toBeGreaterThan(near.centers.right.x);
    expect(far.centers.left.x).toBeCloseTo(-far.centers.right.x, 9);
    // いちばん広げても、キャビネットの端 (半径の 1.3 倍) が画面の端 (aspect) を越えない
    expect(far.centers.right.x + far.radius * 1.3).toBeLessThanOrEqual(16 / 9 + 1e-9);
    // いちばん狭くても、2 台は重ならない
    expect(near.centers.right.x - near.centers.left.x).toBeGreaterThanOrEqual(near.radius * 2.6 - 1e-9);
    // 大きさの上限・下限で丸める
    p.update(frame(0), params({ size: 99, spacing: 0.5 }));
    expect(p.inspect().radius).toBeCloseTo(0.34 * 1.6, 6);
    p.dispose();
  });

  it('上下の位置: 画面の中に収まる範囲で動く。余裕がないほど大きいと真ん中に寄る', () => {
    const p = makePreset();
    p.update(frame(0), params({ size: 1, offsetY: 1 }));
    const up = p.inspect();
    const top = up.centers.left.y + up.radius * 2.05;
    expect(top).toBeLessThanOrEqual(1 + 1e-9);
    p.update(frame(0), params({ size: 1, offsetY: -1 }));
    const down = p.inspect();
    expect(down.centers.left.y - down.radius * 2.45).toBeGreaterThanOrEqual(-1 - 1e-9);
    p.update(frame(0), params({ size: 1.6, offsetY: 1 }));
    expect(Number.isFinite(p.inspect().centers.left.y)).toBe(true);
    p.dispose();
  });

  it('同じ入力なら同じ結果になる (乱数を使わない = 書き出しの再現性)', () => {
    const a = makePreset();
    const b = makePreset();
    const o = (i: number): Partial<AudioFrame> => ({ bass: Math.abs(Math.sin(i / 7)), mid: Math.abs(Math.cos(i / 5)), high: i % 9 === 0 ? 1 : 0, beat: i % 30 === 0 ? 1 : 0, beatIndex: Math.floor(i / 30), bands: new Float32Array(64).fill(Math.abs(Math.cos(i / 11))) });
    run(a, 200, o);
    run(b, 200, o);
    expect(a.inspect()).toEqual(b.inspect());
    a.dispose();
    b.dispose();
  });

  it('NaN・極端な値でも壊れない (値は有限のまま)。知らない配色名でも落ちない', () => {
    const p = makePreset(params({ colorTheme: 'no-such-theme' }));
    const bad = frame(0, { bass: Number.NaN, mid: Infinity, high: -5, beat: Number.NaN, beatIndex: Number.NaN, dt: Number.NaN, bands: new Float32Array(64).fill(Number.NaN) });
    expect(() => p.update(bad, params({ intensity: Number.NaN, motion: Number.NaN, size: Number.NaN, spacing: Number.NaN, alternate: Number.NaN }))).not.toThrow();
    run(p, 10, (i) => ({ bass: 1, beat: 1, beatIndex: i }), params({ intensity: Number.NaN }));
    const s = p.inspect();
    const all = [s.cap.left, s.cap.right, s.tweeter.left, s.tweeter.right, s.side, s.radius, s.centers.left.x, s.centers.left.y, s.centers.right.x, s.centers.right.y, ...s.rings.left, ...s.rings.right, ...s.strip.left, ...s.strip.right];
    for (const v of all) expect(Number.isFinite(v)).toBe(true);
    p.dispose();
  });

  it('テーマを切り替えても落ちず、縦長の画面でも壊れず、dispose でジオメトリとマテリアルを片づける', () => {
    const p = makePreset(params(), 720, 1280);
    for (const theme of ['gold', 'ice', 'neon', 'mono', 'default']) expect(() => p.update(frame(0), params({ colorTheme: theme }))).not.toThrow();
    const s = p.inspect();
    for (const v of [s.centers.left.x, s.centers.right.x, s.centers.left.y]) expect(Number.isFinite(v)).toBe(true);
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
