import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeRng } from '../../core/random';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { MAX_REGIONS, MAX_SPEAKERS, PHOTOS } from './photos';
import { PhotoMotionPreset, type TextureLoaderFn } from './preset';

/**
 * WebGL を使わずに「写真に動き」を動かし、効果の強さ (シェーダーに渡す値) が反応設計どおりに変わるかを確かめる。
 * 写真の読み込みは、テストでは小さなテクスチャに差し替える (jsdom では画像を読めないため)。
 */

const fakeRenderer = { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer;
type Params = CommonParams & Record<string, unknown>;
const params = (o: Partial<CommonParams> & Record<string, unknown> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;

const loaded: THREE.Texture[] = [];
const original = PhotoMotionPreset.loadTexture;
const stub: TextureLoaderFn = async (url) => {
  const t = new THREE.DataTexture(new Uint8Array([10, 20, 30, 255]), 1, 1);
  t.name = url;
  loaded.push(t);
  return t;
};
beforeEach(() => {
  loaded.length = 0;
  PhotoMotionPreset.loadTexture = stub;
});
afterEach(() => {
  PhotoMotionPreset.loadTexture = original;
});

async function makePreset(p: Params = params(), w = 1280, h = 720): Promise<PhotoMotionPreset> {
  const preset = new PhotoMotionPreset();
  await preset.init({ renderer: fakeRenderer, width: w, height: h, seed: 1, params: p, rng: makeRng(1) });
  return preset;
}

function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return { t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64), ...o };
}
function run(p: PhotoMotionPreset, frames: number, o: (i: number) => Partial<AudioFrame>, pr: Params = params()): void {
  for (let i = 0; i < frames; i++) p.update(frame(i / 60, o(i)), pr);
}
/** 読み込み (Promise) が終わるのを待つ */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const uniforms = (p: PhotoMotionPreset): Record<string, THREE.IUniform> => (p.scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material.uniforms;

describe('写真の定義 (photos)', () => {
  it('写真 1 枚の場面 4 つと、部品から組み立てる場面 2 つがあり、位置はどれも絵の中、数はシェーダーの上限まで', () => {
    expect(PHOTOS.map((p) => p.id)).toEqual(['speaker-rack', 'speaker-rack-lit', 'stage-lights', 'speaker-alley', 'rack-parts', 'alley-lights']);
    for (const scene of PHOTOS) {
      expect(scene.layers.length).toBeGreaterThan(0);
      for (const p of scene.layers) {
        expect(p.speakers.length).toBeLessThanOrEqual(MAX_SPEAKERS);
        expect(p.regions.length).toBeLessThanOrEqual(MAX_REGIONS);
        for (const s of p.speakers) {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.x).toBeLessThanOrEqual(1);
          expect(s.y).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeLessThanOrEqual(1);
          expect(s.r).toBeGreaterThan(0);
        }
        for (const r of p.regions) {
          expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
          expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });
});

describe('PhotoMotionPreset', () => {
  it('最初の写真を読んでから描き始める。設定で写真を変えると読み直し、古いテクスチャは片づける', async () => {
    const p = await makePreset();
    expect(p.inspect()).toMatchObject({ photo: 'speaker-rack', loaded: true });
    const first = loaded[0]!;
    let disposed = false;
    first.addEventListener('dispose', () => (disposed = true));
    p.update(frame(0), params({ photo: 'speaker-alley' }));
    await settle();
    expect(p.inspect().photo).toBe('speaker-alley');
    expect(disposed).toBe(true);
    // 知らない写真は最初の写真
    p.update(frame(0), params({ photo: 'nothing' }));
    await settle();
    expect(p.inspect().photo).toBe('speaker-rack');
    p.dispose();
  });

  it('bass でスピーカーのコーンの所がふくらみ、音が止むと戻る。「スピーカーの震え」0 や Intensity 0 ならふくらまない', async () => {
    const p = await makePreset();
    run(p, 30, () => ({}));
    expect(Math.max(...p.inspect().speakers.map(Math.abs))).toBeLessThan(1e-6);
    run(p, 12, () => ({ bass: 1 }));
    const s = p.inspect().speakers;
    expect(s[0]).toBeGreaterThan(0.3);
    expect(s[1]).toBeGreaterThan(0.3);
    run(p, 120, () => ({}));
    expect(Math.abs(p.inspect().speakers[0]!)).toBeLessThan(0.02);
    run(p, 30, () => ({ bass: 1 }), params({ pump: 0 }));
    expect(Math.abs(p.inspect().speakers[0]!)).toBeLessThan(1e-9);
    run(p, 60, () => ({}));
    run(p, 30, () => ({ bass: 1 }), params({ intensity: 0 }));
    expect(Math.abs(p.inspect().speakers[0]!)).toBeLessThan(0.02);
    p.dispose();
  });

  it('high でツイーター (高音のスピーカー) が震える', async () => {
    const p = await makePreset();
    run(p, 30, () => ({}));
    expect(p.inspect().speakers[2]).toBe(0);
    let max = 0;
    for (let i = 0; i < 30; i++) {
      p.update(frame(i / 60, { high: 1 }), params());
      max = Math.max(max, p.inspect().speakers[2]!);
    }
    expect(max).toBeGreaterThan(0.2);
    p.dispose();
  });

  it('曲の音の大きさに合わせる: 実際の曲のように小さな高音・音量・帯域でも、ツイーター・光・スペクトラムが動く', async () => {
    const p = await makePreset();
    run(p, 60, () => ({}));
    const quiet = p.inspect();
    let tweeter = 0;
    for (let i = 0; i < 120; i++) {
      p.update(frame(i / 60, { high: 0.01, rms: 0.15, bands: new Float32Array(64).fill(0.08) }), params());
      tweeter = Math.max(tweeter, p.inspect().speakers[2]!);
    }
    const loud = p.inspect();
    expect(tweeter).toBeGreaterThan(0.2);
    expect(loud.regions[1]).toBeGreaterThan(quiet.regions[1]! + 0.2);
    expect(loud.spectrum).toBeGreaterThan(0.3);
    p.dispose();
  });

  it('通路の写真では、奥のスピーカーほど遅れてふくらむ', async () => {
    const p = await makePreset(params({ photo: 'speaker-alley' }));
    run(p, 30, () => ({}), params({ photo: 'speaker-alley' }));
    run(p, 3, () => ({ bass: 1 }), params({ photo: 'speaker-alley' }));
    const early = p.inspect().speakers;
    // 手前 (遅れ 0) は動き始め、いちばん奥 (遅れ 0.09 秒) はまだ
    expect(early[0]).toBeGreaterThan(0.05);
    expect(Math.abs(early[6]!)).toBeLessThan(0.01);
    run(p, 12, () => ({ bass: 1 }), params({ photo: 'speaker-alley' }));
    expect(p.inspect().speakers[6]).toBeGreaterThan(0.1);
    p.dispose();
  });

  it('音量で光る所が明るくなり、帯域でスペクトラムのバーが伸びる。静かになると戻る', async () => {
    const p = await makePreset();
    run(p, 60, () => ({}));
    const quiet = p.inspect();
    expect(quiet.spectrum).toBeLessThan(0.01);
    run(p, 60, () => ({ rms: 1, bands: new Float32Array(64).fill(0.8) }), params({ sensitivity: 1 }));
    const loud = p.inspect();
    expect(loud.regions[1]).toBeGreaterThan(quiet.regions[1]! + 0.2);
    expect(loud.spectrum).toBeGreaterThan(0.4);
    run(p, 240, () => ({}), params({ sensitivity: 1 }));
    expect(p.inspect().spectrum).toBeLessThan(0.01);
    p.dispose();
  });

  it('明かりの消えたラック: VU の針は音量で振れ (上がりは速く、戻りはゆっくり)、盤面の灯り・真空管はいつも少し点いている。拍で写真全体は動かない', async () => {
    const p = await makePreset();
    run(p, 60, () => ({}));
    const quiet = p.inspect();
    expect(Math.max(...quiet.needles)).toBeLessThan(0.01);
    // 盤面 (regions[1], [2]) と真空管 (regions[5], [6]) は静かなときも消えない
    for (const i of [1, 2, 5, 6]) expect(quiet.regions[i]).toBeGreaterThan(0.1);
    const offsetBefore = (uniforms(p).uvOffset!.value as THREE.Vector2).clone();
    run(p, 15, (i) => ({ rms: 0.8, bass: 1, beat: i === 0 ? 1 : 0, beatIndex: 0 }));
    const loud = p.inspect();
    expect(loud.needles[0]).toBeGreaterThan(0.5);
    expect(loud.needles[1]).toBeGreaterThan(0.4);
    // 写真全体の位置は、ゆっくりした寄り・流れ (Camera Motion) のぶんしか変わらない
    expect((uniforms(p).uvOffset!.value as THREE.Vector2).distanceTo(offsetBefore)).toBeLessThan(0.002);
    run(p, 6, () => ({}));
    // 戻りはゆっくり (0.1 秒ではまだ半分以上残る)
    expect(p.inspect().needles[0]).toBeGreaterThan(loud.needles[0] * 0.5);
    run(p, 180, () => ({}));
    expect(p.inspect().needles[0]).toBeLessThan(0.02);
    p.dispose();
  });

  it('ステージの写真では、照明が拍ごとに左右交互に強まり、スモークが流れる。強まり方は控えめ (0.6 以下)', async () => {
    const pr = params({ photo: 'stage-lights' });
    const p = await makePreset(pr);
    const lr = (): [number, number] => {
      const r = p.inspect().regions;
      return [r[0]!, r[1]!];
    };
    run(p, 10, () => ({ beat: 1, beatIndex: 0 }), pr);
    const [l0, r0] = lr();
    run(p, 40, () => ({}), pr);
    run(p, 10, () => ({ beat: 1, beatIndex: 1 }), pr);
    const [l1, r1] = lr();
    expect(l0).toBeGreaterThan(r0);
    expect(r1).toBeGreaterThan(l1);
    expect(Math.max(l0, r1)).toBeLessThanOrEqual(0.6);
    expect(p.inspect().haze).toBeGreaterThan(0);
    p.dispose();
  });

  it('画面の形に合わせて写真を切り抜く (はみ出した所を切る): 横長は上下、縦長は左右を切る', async () => {
    const wide = await makePreset(params({ cameraMotion: 0 }), 2400, 720);
    wide.update(frame(0), params({ cameraMotion: 0 }));
    const w = uniforms(wide).uvScale!.value as THREE.Vector2;
    expect(w.x).toBeCloseTo(1, 6);
    expect(w.y).toBeLessThan(1);
    const tall = await makePreset(params({ cameraMotion: 0 }), 720, 1280);
    tall.update(frame(0), params({ cameraMotion: 0 }));
    const t = uniforms(tall).uvScale!.value as THREE.Vector2;
    expect(t.y).toBeCloseTo(1, 6);
    expect(t.x).toBeLessThan(0.4);
    wide.dispose();
    tall.dispose();
  });

  it('部品から組み立てる「ラックとスピーカー」: 3 つの層。静かなときは明かりが消え (0 近く)、音で点く (1 近く)。スピーカーは低音でふくらむ', async () => {
    const pr = params({ photo: 'rack-parts', sensitivity: 1 });
    const p = await makePreset(pr);
    expect(p.inspect()).toMatchObject({ photo: 'rack-parts', layers: 3, lights: -1 });
    run(p, 120, () => ({}), pr);
    const quiet = p.inspect();
    // 明かりの消える層の光る所 (スペクトラム以外) は、静かなときほぼ 0
    const glows = (i: ReturnType<typeof p.inspect>): number[] => i.regions.filter((_v, k) => k !== 0);
    expect(Math.max(...glows(quiet))).toBeLessThan(0.15);
    run(p, 120, () => ({ rms: 0.5, bass: 1 }), pr);
    const loud = p.inspect();
    expect(Math.min(...glows(loud))).toBeGreaterThan(0.6);
    expect(Math.max(...glows(loud))).toBeLessThanOrEqual(1);
    expect(loud.speakers[0]).toBeGreaterThan(0.3);
    expect(loud.speakers[1]).toBeGreaterThan(0.3);
    p.dispose();
  });

  it('部品から組み立てる「通路」: 4 つの層。照明の層は静かなときは薄く、音量と拍で濃くなる (なめらかに)', async () => {
    const pr = params({ photo: 'alley-lights', sensitivity: 1 });
    const p = await makePreset(pr);
    expect(p.inspect()).toMatchObject({ photo: 'alley-lights', layers: 4 });
    run(p, 120, () => ({}), pr);
    const quiet = p.inspect().lights;
    expect(quiet).toBeLessThan(0.2);
    let prev = quiet;
    let maxStep = 0;
    for (let i = 0; i < 120; i++) {
      p.update(frame(i / 60, { rms: 0.5, beat: i % 30 === 0 ? 1 : Math.exp(-(i % 30) / 8), beatIndex: Math.floor(i / 30) }), pr);
      const l = p.inspect().lights;
      maxStep = Math.max(maxStep, l - prev);
      prev = l;
    }
    expect(p.inspect().lights).toBeGreaterThan(0.6);
    // 1 コマで急に濃くならない (光過敏への配慮。0.2 以下)
    expect(maxStep).toBeLessThanOrEqual(0.2);
    // 手前の箱 2 つのスピーカーがふくらむ
    run(p, 12, () => ({ bass: 1, rms: 0.5 }), pr);
    const sp = p.inspect().speakers;
    expect(sp.length).toBe(2);
    expect(Math.min(...sp)).toBeGreaterThan(0.3);
    p.dispose();
  });

  it('dt=0 や極端な値でも NaN にならない。dispose で写真・材質・形を片づける', async () => {
    const p = await makePreset();
    p.update(frame(0, { dt: 0, bass: 1, high: 1 }), params());
    p.update(frame(1, { dt: 5, bass: 1, high: 1, beat: 1, beatIndex: 3, rms: 1 }), params());
    p.update(frame(2, { dt: Number.NaN, high: Number.NaN, bass: Number.NaN, rms: Number.NaN, bands: new Float32Array(64).fill(Number.NaN) }), params({ intensity: Number.NaN, pump: Number.NaN }));
    const i = p.inspect();
    for (const v of [...i.speakers, ...i.regions, i.globalGlow, i.haze, i.spectrum, ...i.needles]) expect(Number.isFinite(v)).toBe(true);
    const u = uniforms(p);
    for (const v of [...(u.uvScale!.value as THREE.Vector2).toArray(), ...(u.uvOffset!.value as THREE.Vector2).toArray()]) expect(Number.isFinite(v)).toBe(true);
    const mesh = p.scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const watched = [loaded[0]!, mesh.material, mesh.geometry];
    const gone = new Set<object>();
    for (const o of watched) o.addEventListener('dispose', () => gone.add(o));
    p.dispose();
    expect(watched.every((o) => gone.has(o))).toBe(true);
    expect(p.scene.children.length).toBe(0);
  });
});
