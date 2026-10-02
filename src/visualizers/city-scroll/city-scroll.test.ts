import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeRng } from '../../core/random';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { manifest } from './index';
import { CityScrollPreset, MAX_PARTICLES, particleKindFor, scrollSpeed, type TextureLoaderFn } from './preset';
import { SCENES, sceneSequence } from './scenes';
import { SEAM } from './shaders';

/**
 * WebGL を使わずに「流れる街並み」を動かし、流れ方・きらめき・舞うものの値が設計どおりに変わるかを確かめる。
 * 絵の読み込みは、テストでは小さなテクスチャに差し替える (jsdom では画像を読めないため)。
 */

const fakeRenderer = { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer;
type Params = CommonParams & Record<string, unknown>;
const params = (o: Partial<CommonParams> & Record<string, unknown> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;

const loaded: THREE.Texture[] = [];
const original = CityScrollPreset.loadTexture;
const stub: TextureLoaderFn = async (url) => {
  const t = new THREE.DataTexture(new Uint8Array([10, 20, 30, 255]), 1, 1);
  t.name = url;
  loaded.push(t);
  return t;
};
beforeEach(() => {
  loaded.length = 0;
  CityScrollPreset.loadTexture = stub;
});
afterEach(() => {
  CityScrollPreset.loadTexture = original;
});

async function makePreset(p: Params = params(), seed = 1): Promise<CityScrollPreset> {
  const preset = new CityScrollPreset();
  await preset.init({ renderer: fakeRenderer, width: 1280, height: 720, seed, params: p, rng: makeRng(seed) });
  return preset;
}
function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return { t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64), ...o };
}
function run(p: CityScrollPreset, frames: number, o: (i: number) => Partial<AudioFrame>, pr: Params): void {
  for (let i = 0; i < frames; i++) p.update(frame(i / 60, o(i)), pr);
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const seeds = (p: CityScrollPreset): number[] => {
  const mesh = p.scene.children[1] as THREE.Mesh<THREE.InstancedBufferGeometry>;
  return Array.from((mesh.geometry.getAttribute('seedA') as THREE.InstancedBufferAttribute).array as Float32Array);
};

describe('場面の定義と設定', () => {
  it('街並みは 5 枚で、「全部つなげる」は 5 枚の並び。設定の項目は場面・向き・速さ・ぼかし・きらめき・舞うもの・量', () => {
    expect(SCENES.map((s) => s.id)).toEqual(['grand-avenue', 'neon-night', 'old-downtown', 'harbor-town', 'tram-street']);
    expect(sceneSequence('all')).toHaveLength(5);
    expect(sceneSequence('neon-night').map((s) => s.id)).toEqual(['neon-night']);
    expect(sceneSequence('???').map((s) => s.id)).toEqual(['grand-avenue']);
    expect(manifest.controls!.map((c) => c.key)).toEqual(['scene', 'direction', 'speed', 'blur', 'sparkle', 'particles', 'particleAmount']);
  });

  it('舞うもの: 「場面に合わせる」は場面ごと (全部つなげるときは 1 枚目)、選んだものはそのまま、なしは none', () => {
    expect(particleKindFor('auto', sceneSequence('neon-night'))).toBe('petals');
    expect(particleKindFor('auto', sceneSequence('old-downtown'))).toBe('lights');
    expect(particleKindFor('auto', sceneSequence('all'))).toBe('leaves');
    expect(particleKindFor('snow', sceneSequence('neon-night'))).toBe('snow');
    expect(particleKindFor('none', sceneSequence('neon-night'))).toBe('none');
    expect(particleKindFor('bogus', sceneSequence('harbor-town'))).toBe('petals');
  });

  it('速さの設定は、上げるほど速い (0 でも少しは動く)', () => {
    expect(scrollSpeed(0)).toBeGreaterThan(0);
    expect(scrollSpeed(1)).toBeGreaterThan(scrollSpeed(0.5));
    expect(scrollSpeed(0.5)).toBeGreaterThan(scrollSpeed(0.2));
  });
});

describe('CityScrollPreset', () => {
  it('最初の絵を読んでから描き始める。場面を変えると読み直し、使わなくなった絵は片づける。全部つなげると 5 枚', async () => {
    const p = await makePreset(params({ scene: 'neon-night' }));
    expect(p.inspect()).toMatchObject({ scene: 'neon-night', loaded: true, count: 1 });
    const first = loaded[0]!;
    let disposed = false;
    first.addEventListener('dispose', () => (disposed = true));
    p.update(frame(0), params({ scene: 'all' }));
    await settle();
    expect(p.inspect()).toMatchObject({ scene: 'all', count: 5 });
    // neon-night は 5 枚の中にあるので読み直さない (4 枚だけ読む)
    expect(loaded).toHaveLength(5);
    expect(disposed).toBe(false);
    p.update(frame(0), params({ scene: 'harbor-town' }));
    await settle();
    expect(p.inspect()).toMatchObject({ scene: 'harbor-town', count: 1 });
    expect(disposed).toBe(true);
    p.dispose();
  });

  it('「左へ」は流れた位置が増え、「右へ」は減る。速さを上げると速い。1 周 (枚数 × (1 - SEAM)) で戻る', async () => {
    const left = await makePreset(params({ direction: 'left', speed: 0.5 }));
    run(left, 60, () => ({}), params({ direction: 'left', speed: 0.5 }));
    const l = left.inspect().scroll;
    expect(l).toBeGreaterThan(0);
    expect(l).toBeLessThan(0.1);

    const right = await makePreset(params({ direction: 'right', speed: 0.5 }));
    run(right, 60, () => ({}), params({ direction: 'right', speed: 0.5 }));
    // 0 から右へ流れると、1 周の終わりの方へ回る
    expect(right.inspect().scroll).toBeCloseTo(1 - SEAM - l, 5);

    const fast = await makePreset(params({ speed: 1 }));
    run(fast, 60, () => ({}), params({ speed: 1 }));
    expect(fast.inspect().scroll).toBeGreaterThan(l * 2);

    // 長く流しても、位置はいつも 1 周の中
    run(fast, 60 * 120, () => ({}), params({ speed: 1 }));
    const s = fast.inspect().scroll;
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(1 - SEAM);
    // 舞うものも景色といっしょに、景色と同じ向きへ流れる (「左へ」なら左 = 減る)
    expect(left.inspect().drift).toBeLessThan(0);
    expect(right.inspect().drift).toBeGreaterThan(0);
    for (const p of [left, right, fast]) p.dispose();
  });

  it('低音で少しだけ速く流れる (Motion 0 なら変わらない)', async () => {
    const pr = params({ speed: 0.4, motion: 1, intensity: 1, sensitivity: 1 });
    const quiet = await makePreset(pr);
    const loud = await makePreset(pr);
    run(quiet, 240, () => ({}), pr);
    run(loud, 240, () => ({ bass: 1 }), pr);
    const q = quiet.inspect().scroll;
    const l = loud.inspect().scroll;
    expect(l).toBeGreaterThan(q * 1.1);
    expect(l).toBeLessThan(q * 1.45);

    const still = { ...pr, motion: 0 };
    const a = await makePreset(still);
    const b = await makePreset(still);
    run(a, 240, () => ({}), still);
    run(b, 240, () => ({ bass: 1 }), still);
    expect(b.inspect().scroll).toBeCloseTo(a.inspect().scroll, 6);
  });

  it('ぼかし・きらめきは設定どおり。高音と拍できらめきが強まり、音量で絵が少し明るくなる (最大 +5% ほど)', async () => {
    const pr = params({ blur: 1, sparkle: 0.8, sensitivity: 1, intensity: 1 });
    const p = await makePreset(pr);
    run(p, 30, () => ({}), pr);
    const q = p.inspect();
    expect(q.blur).toBeCloseTo(0.018, 6);
    expect(q.sparkle).toBeCloseTo(0.8, 6);
    expect(q.sparkleBoost).toBeLessThan(0.05);
    expect(q.brightness).toBeCloseTo(0.95, 2);
    run(p, 60, (i) => ({ high: 0.8, rms: 0.8, beat: i % 30 === 0 ? 1 : 0, beatIndex: Math.floor(i / 30) }), pr);
    const l = p.inspect();
    expect(l.sparkleBoost).toBeGreaterThan(0.4);
    expect(l.brightness).toBeGreaterThan(1.0);
    expect(l.brightness).toBeLessThanOrEqual(1.05 + 1e-9);
    p.dispose();
  });

  it('舞うもの: 量で数が変わり、なしで出ない。光の粒だけ足し合わせて描く', async () => {
    const p = await makePreset(params({ scene: 'old-downtown', particleAmount: 1 }));
    run(p, 2, () => ({}), params({ scene: 'old-downtown', particleAmount: 1 }));
    expect(p.inspect()).toMatchObject({ particleKind: 'lights', particleCount: MAX_PARTICLES, particlesAdditive: true });
    run(p, 2, () => ({}), params({ scene: 'old-downtown', particles: 'petals', particleAmount: 0.5 }));
    expect(p.inspect()).toMatchObject({ particleKind: 'petals', particleCount: MAX_PARTICLES / 2, particlesAdditive: false });
    run(p, 2, () => ({}), params({ scene: 'old-downtown', particles: 'none' }));
    expect(p.inspect()).toMatchObject({ particleKind: 'none', particleCount: 0 });
    p.dispose();
  });

  it('同じ seed なら舞うものの並びは同じ、seed が違えば違う。同じ音なら同じ位置', async () => {
    const a = await makePreset(params(), 7);
    const b = await makePreset(params(), 7);
    const c = await makePreset(params(), 8);
    expect(seeds(a)).toEqual(seeds(b));
    expect(seeds(a)).not.toEqual(seeds(c));
    const o = (i: number): Partial<AudioFrame> => ({ bass: (i % 20) / 20, rms: 0.5 });
    run(a, 200, o, params());
    run(b, 200, o, params());
    expect(a.inspect()).toEqual(b.inspect());
    for (const p of [a, b, c]) p.dispose();
  });

  it('NaN や変な設定でも壊れない', async () => {
    const pr = params({ speed: Number.NaN, blur: 'x', sparkle: Infinity, particleAmount: -3, direction: 42, scene: 99 });
    const p = await makePreset(pr);
    run(p, 30, () => ({ bass: Number.NaN, high: Number.NaN, rms: Number.NaN, beat: Number.NaN, dt: Number.NaN }), pr);
    const q = p.inspect();
    for (const v of [q.scroll, q.blur, q.sparkle, q.sparkleBoost, q.brightness, q.drift]) expect(Number.isFinite(v)).toBe(true);
    expect(q.particleCount).toBe(0);
    p.dispose();
  });

  it('dispose で、絵・ジオメトリ・マテリアルをすべて片づける', async () => {
    const p = await makePreset(params({ scene: 'all' }));
    const disposed = new Set<string>();
    for (const t of loaded) t.addEventListener('dispose', () => disposed.add(t.name));
    const meshes = p.scene.children.slice() as THREE.Mesh[];
    let geo = 0;
    let mat = 0;
    for (const m of meshes) {
      m.geometry.addEventListener('dispose', () => geo++);
      (m.material as THREE.Material).addEventListener('dispose', () => mat++);
    }
    p.dispose();
    expect(disposed.size).toBe(5);
    expect(geo).toBe(2);
    expect(mat).toBe(2);
    expect(p.scene.children).toHaveLength(0);
  });
});
