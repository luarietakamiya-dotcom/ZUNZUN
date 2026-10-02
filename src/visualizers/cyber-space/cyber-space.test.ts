import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeRng } from '../../core/random';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { manifest } from './index';
import { CyberSpacePreset, MAX_WARP, type TextureLoaderFn } from './preset';
import { SCENES } from './scenes';

/**
 * WebGL を使わずに「サイバー空間」を動かし、光らせる値が音の設計どおりに変わるかを確かめる。
 * 絵の読み込みは、テストでは小さなテクスチャに差し替える (jsdom では画像を読めないため)。
 */

const fakeRenderer = { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer;
type Params = CommonParams & Record<string, unknown>;
const params = (o: Partial<CommonParams> & Record<string, unknown> = {}): Params => ({ ...defaultCommonParams(), sensitivity: 1, intensity: 1, ...o }) as Params;

const loaded: THREE.Texture[] = [];
const original = CyberSpacePreset.loadTexture;
const stub: TextureLoaderFn = async (url) => {
  const t = new THREE.DataTexture(new Uint8Array([10, 20, 30, 255]), 1, 1);
  t.name = url;
  loaded.push(t);
  return t;
};
beforeEach(() => {
  loaded.length = 0;
  CyberSpacePreset.loadTexture = stub;
});
afterEach(() => {
  CyberSpacePreset.loadTexture = original;
});

async function makePreset(p: Params = params(), seed = 1): Promise<CyberSpacePreset> {
  const preset = new CyberSpacePreset();
  await preset.init({ renderer: fakeRenderer, width: 1280, height: 720, seed, params: p, rng: makeRng(seed) });
  return preset;
}
function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return { t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64), ...o };
}
function run(p: CyberSpacePreset, frames: number, o: (i: number) => Partial<AudioFrame>, pr: Params): void {
  for (let i = 0; i < frames; i++) p.update(frame(i / 60, o(i)), pr);
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('場面の定義と設定', () => {
  it('空間は 3 つで、消失点は絵の中。設定は空間・ネオン・波・寄る・ワープ・色ずれ・色の移り変わり', () => {
    expect(SCENES.map((s) => s.id)).toEqual(['neon-gate', 'crystal-void', 'sky-hall']);
    for (const s of SCENES) {
      for (const v of s.vp) {
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
      }
      expect(s.gain).toBeGreaterThan(0);
      expect(s.gain).toBeLessThanOrEqual(1);
    }
    expect(manifest.controls!.map((c) => c.key)).toEqual(['scene', 'neon', 'rings', 'zoom', 'warp', 'rgbSplit', 'colorShift']);
  });
});

describe('CyberSpacePreset', () => {
  it('最初の絵を読んでから描き始める。場面を変えると読み直し、古い絵は片づける', async () => {
    const p = await makePreset(params({ scene: 'crystal-void' }));
    expect(p.inspect()).toMatchObject({ scene: 'crystal-void', loaded: true });
    let disposed = false;
    loaded[0]!.addEventListener('dispose', () => (disposed = true));
    p.update(frame(0), params({ scene: 'sky-hall' }));
    await settle();
    expect(p.inspect().scene).toBe('sky-hall');
    expect(disposed).toBe(true);
    p.dispose();
  });

  it('静かなときは控えめ、音量でネオンが強く光り、ワープの線が明るくなる。もともと明るい絵 (空の神殿) は弱めに', async () => {
    const pr = params();
    const p = await makePreset(pr);
    run(p, 60, () => ({}), pr);
    const q = p.inspect();
    run(p, 120, () => ({ rms: 0.9, bass: 0.3 }), pr);
    const l = p.inspect();
    expect(l.neon).toBeGreaterThan(q.neon * 3);
    expect(l.energy).toBeGreaterThan(q.energy + 0.5);
    expect(l.warpBrightness).toBeGreaterThan(q.warpBrightness + 0.8);

    const sky = await makePreset(params({ scene: 'sky-hall' }));
    run(sky, 120, () => ({ rms: 0.9, bass: 0.3 }), params({ scene: 'sky-hall' }));
    expect(sky.inspect().neon).toBeLessThan(l.neon * 0.6);
    p.dispose();
    sky.dispose();
  });

  it('低音で寄って (ブレと色ずれも)、少し行き過ぎて戻る。「低音で寄る」0 なら寄らない', async () => {
    const pr = params();
    const p = await makePreset(pr);
    let peak = 1;
    for (let i = 0; i < 30; i++) {
      p.update(frame(i / 60, { bass: 1 }), pr);
      peak = Math.max(peak, p.inspect().zoom);
    }
    const q = p.inspect();
    expect(peak).toBeGreaterThan(1.04);
    expect(q.zoomBlur).toBeGreaterThan(0);
    expect(q.split).toBeGreaterThan(0.002);

    const still = params({ zoom: 0, cameraMotion: 0 });
    const s = await makePreset(still);
    run(s, 30, () => ({ bass: 1 }), still);
    expect(s.inspect().zoom).toBeCloseTo(1, 6);
    expect(s.inspect().zoomBlur).toBe(0);
    p.dispose();
    s.dispose();
  });

  it('拍ごとに光の波が出て、1.6 秒で消える。同時に出るのは 4 本まで', async () => {
    const pr = params();
    const p = await makePreset(pr);
    expect(p.inspect().rings.every((r) => r === 0)).toBe(true);
    // 0.25 秒ごとに拍 (4 拍で 1 秒)
    run(p, 60, (i) => ({ beat: i % 15 === 0 ? 1 : 0, beatIndex: Math.floor(i / 15) }), pr);
    const on = p.inspect().rings.filter((r) => r > 0).length;
    expect(on).toBe(4);
    run(p, 120, () => ({ beatIndex: 3 }), pr);
    expect(p.inspect().rings.every((r) => r === 0)).toBe(true);
    // 拍の波 0 なら出ない
    const none = params({ rings: 0 });
    const n = await makePreset(none);
    run(n, 30, (i) => ({ beatIndex: Math.floor(i / 15) }), none);
    expect(n.inspect().rings.every((r) => r === 0)).toBe(true);
    p.dispose();
    n.dispose();
  });

  it('ワープの線の数は設定どおり (0 で出ない)。色の移り変わりは 0 なら回らず、上げると時刻で回る', async () => {
    const p = await makePreset(params({ warp: 1 }));
    run(p, 2, () => ({}), params({ warp: 1 }));
    expect(p.inspect().warpCount).toBe(MAX_WARP);
    run(p, 2, () => ({}), params({ warp: 0 }));
    expect(p.inspect().warpCount).toBe(0);
    run(p, 60, () => ({}), params({ colorShift: 0 }));
    expect(p.inspect().hue).toBe(0);
    run(p, 60, () => ({}), params({ colorShift: 1 }));
    expect(p.inspect().hue).toBeGreaterThan(0);
    p.dispose();
  });

  it('同じ seed ならワープの線の並びは同じ、違えば違う。同じ音なら同じ値', async () => {
    const seedsOf = (p: CyberSpacePreset): number[] =>
      Array.from(((p.scene.children[1] as THREE.Mesh<THREE.InstancedBufferGeometry>).geometry.getAttribute('seed') as THREE.InstancedBufferAttribute).array as Float32Array);
    const a = await makePreset(params(), 3);
    const b = await makePreset(params(), 3);
    const c = await makePreset(params(), 4);
    expect(seedsOf(a)).toEqual(seedsOf(b));
    expect(seedsOf(a)).not.toEqual(seedsOf(c));
    const o = (i: number): Partial<AudioFrame> => ({ bass: (i % 20) / 20, rms: 0.6, beatIndex: Math.floor(i / 20) });
    run(a, 200, o, params());
    run(b, 200, o, params());
    expect(a.inspect()).toEqual(b.inspect());
    for (const p of [a, b, c]) p.dispose();
  });

  it('NaN や変な設定でも壊れない', async () => {
    const pr = params({ neon: Number.NaN, rings: 'x', zoom: Infinity, warp: -1, rgbSplit: Number.NaN, colorShift: 'y', scene: 5 });
    const p = await makePreset(pr);
    run(p, 30, () => ({ bass: Number.NaN, rms: Number.NaN, beat: Number.NaN, dt: Number.NaN }), pr);
    const q = p.inspect();
    for (const v of [q.zoom, q.zoomBlur, q.split, q.neon, q.hue, q.energy, q.warpBrightness, ...q.rings]) expect(Number.isFinite(v)).toBe(true);
    p.dispose();
  });

  it('dispose で、絵・ジオメトリ・マテリアルをすべて片づける', async () => {
    const p = await makePreset();
    let tex = false;
    loaded[0]!.addEventListener('dispose', () => (tex = true));
    let geo = 0;
    let mat = 0;
    for (const m of p.scene.children.slice() as THREE.Mesh[]) {
      m.geometry.addEventListener('dispose', () => geo++);
      (m.material as THREE.Material).addEventListener('dispose', () => mat++);
    }
    p.dispose();
    expect(tex).toBe(true);
    expect(geo).toBe(2);
    expect(mat).toBe(2);
    expect(p.scene.children).toHaveLength(0);
  });
});
