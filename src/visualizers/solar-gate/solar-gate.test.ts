import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/random';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { SolarGatePreset } from './preset';

/**
 * WebGL を使わずに (three.js のシーングラフだけで) Solar Gate を動かし、
 * 反応設計どおりに数値が動くか・同じ seed なら同じ結果になるかを確かめる。
 * Reflector はレンダーターゲットを作るだけで GPU には触らないので、ここでも生成できる。
 */

const fakeRenderer = { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer;
type Params = CommonParams & Record<string, unknown>;
/** Visualizer パネルと同じく、共通パラメータを preset.update() が受け取る型にして渡す */
const params = (o: Partial<CommonParams> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;

function makePreset(seed = 42, p: Params = params()): SolarGatePreset {
  const preset = new SolarGatePreset();
  preset.init({ renderer: fakeRenderer, width: 1280, height: 720, seed, params: p, rng: makeRng(seed) });
  return preset;
}

function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return {
    t,
    dt: 1 / 60,
    bass: 0,
    mid: 0,
    high: 0,
    rms: 0,
    peak: 0,
    beat: 0,
    beatIndex: -1,
    spectralEnergy: 0,
    flux: 0,
    bands: new Float32Array(64),
    ...o,
  };
}

function run(preset: SolarGatePreset, frames: number, o: (i: number) => Partial<AudioFrame>, p: Params = params()): void {
  for (let i = 0; i < frames; i++) preset.update(frame(i / 60, o(i)), p);
}

describe('SolarGatePreset', () => {
  it('bass が強いほど、輪のまわりのオーロラの縁が長く伸びる', () => {
    const quiet = makePreset();
    const loud = makePreset();
    run(quiet, 60, () => ({ bass: 0 }));
    run(loud, 60, () => ({ bass: 1, bands: new Float32Array(64).fill(0.8) }));
    expect(loud.inspect().meanRayLength).toBeGreaterThan(quiet.inspect().meanRayLength * 3);
  });

  it('円環そのものは音に合わせて拡大縮小しない', () => {
    const p = makePreset();
    run(p, 120, (i) => ({ bass: i % 2, beat: (i % 30) / 30, mid: 1, high: 1 }));
    expect(p.inspect().ringScale).toBe(1);
  });

  it('high が強いほど粒子が多く放出される', () => {
    const calm = makePreset();
    const bright = makePreset();
    run(calm, 90, () => ({ high: 0 }));
    run(bright, 90, () => ({ high: 1 }));
    expect(bright.inspect().activeParticles).toBeGreaterThan(calm.inspect().activeParticles + 100);
  });

  it('音が大きいほど月食のフレアが強くなり、静かなときは落ち着いている (光過敏への配慮で、1.5 を超えない)', () => {
    const quiet = makePreset();
    const loud = makePreset();
    run(quiet, 120, () => ({}));
    run(loud, 120, (i) => ({ rms: 0.9, mid: 0.8, beat: i % 30 === 0 ? 1 : (30 - (i % 30)) / 60, beatIndex: Math.floor(i / 30) }));
    expect(loud.inspect().flareStrength).toBeGreaterThan(quiet.inspect().flareStrength + 0.3);
    expect(loud.inspect().flareStrength).toBeLessThanOrEqual(1.5);
    expect(quiet.inspect().flareStrength).toBeLessThan(0.5);
  });

  it('フレアが燃える位置は、ゆっくり輪を回り (約 40 秒で 1 周)、拍が多いと少し速い。同じ音なら同じ位置', () => {
    const calm = makePreset();
    const beaty = makePreset();
    const calm2 = makePreset();
    const a0 = calm.inspect().flareAngle;
    run(calm, 600, () => ({}));
    run(calm2, 600, () => ({}));
    run(beaty, 600, (i) => ({ beat: (i % 30) / 30 < 0.2 ? 1 - (i % 30) / 6 : 0 }));
    const turn = calm.inspect().flareAngle - a0;
    // 10 秒で、1 周の 1/4 より少し進む (Motion 0.6 の既定: 0.5 + 0.9 × 0.6 = 1.04 倍速)
    expect(turn).toBeGreaterThan(0.9);
    expect(turn).toBeLessThan(2.4);
    expect(beaty.inspect().flareAngle).toBeGreaterThan(calm.inspect().flareAngle);
    expect(calm2.inspect().flareAngle).toBe(calm.inspect().flareAngle);
  });

  it('リングの中は真っ暗 (不透明な黒)。光の幕と水面は無く、宇宙だけ', () => {
    const p = makePreset();
    run(p, 30, () => ({ bass: 1, mid: 1, beat: 1, rms: 1, high: 1 }));
    const black = p.scene.children
      .flatMap((c) => [c, ...c.children])
      .filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true)
      .filter((m) => {
        const mat = m.material as THREE.MeshBasicMaterial;
        return mat.name === 'SolarGatePortal' && mat.color.getHex() === 0x000000 && !mat.transparent;
      });
    expect(black.length).toBe(1);
    // 水面 (Reflector) と、光の幕・光だまりの板が無い
    const names: string[] = [];
    p.scene.traverse((o) => {
      if ((o as { isReflector?: boolean }).isReflector) names.push('reflector');
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && /Curtain|Floor|Pool/.test(m.name)) names.push(m.name);
    });
    expect(names).toEqual([]);
  });

  describe('リングの中の画像 (setImage)', () => {
    const tex = (): THREE.Texture => new THREE.Texture();

    it('画像が無いあいだは出さず (真っ暗)、入れると出て、null で外せる', () => {
      const p = makePreset();
      expect(p.inspect().imageVisible).toBe(false);
      p.setImage({ texture: tex(), aspect: 1.5 });
      p.update(frame(0), params());
      expect(p.inspect().imageVisible).toBe(true);
      p.setImage(null);
      expect(p.inspect().imageVisible).toBe(false);
    });

    it('縦横比が違っても、真ん中を丸く切り抜く (はみ出しは切る・縦長も横長も)', () => {
      const p = makePreset();
      const wide = tex();
      p.setImage({ texture: wide, aspect: 2 });
      expect(wide.repeat.x).toBeCloseTo(0.5, 6);
      expect(wide.repeat.y).toBe(1);
      expect(wide.offset.x).toBeCloseTo(0.25, 6);
      const tall = tex();
      p.setImage({ texture: tall, aspect: 0.5 });
      expect(tall.repeat.y).toBeCloseTo(0.5, 6);
      expect(tall.repeat.x).toBe(1);
      expect(tall.offset.y).toBeCloseTo(0.25, 6);
      // 壊れた縦横比でも NaN にならない
      const bad = tex();
      p.setImage({ texture: bad, aspect: Number.NaN });
      expect(Number.isFinite(bad.repeat.x) && Number.isFinite(bad.repeat.y)).toBe(true);
    });

    it('明るさは設定どおり。拍ではごく少しだけ (最大 +25%) 明るくなり、0 なら動かない', () => {
      const withBeat = makePreset();
      const steady = makePreset();
      withBeat.setImage({ texture: tex(), aspect: 1 });
      steady.setImage({ texture: tex(), aspect: 1 });
      const pBeat = { ...params(), imageBrightness: 0.8, imageBeat: 1 } as Params;
      const pSteady = { ...params(), imageBrightness: 0.8, imageBeat: 0 } as Params;
      run(withBeat, 30, () => ({ beat: 1, beatIndex: 0 }), pBeat);
      run(steady, 30, () => ({ beat: 1, beatIndex: 0 }), pSteady);
      expect(steady.inspect().imageBrightness).toBeCloseTo(0.8, 6);
      expect(withBeat.inspect().imageBrightness).toBeGreaterThan(0.8);
      expect(withBeat.inspect().imageBrightness).toBeLessThanOrEqual(0.8 * 1.25 + 1e-9);
      const dark = makePreset();
      dark.setImage({ texture: tex(), aspect: 1 });
      run(dark, 5, () => ({ beat: 1 }), { ...params(), imageBrightness: 0 } as Params);
      expect(dark.inspect().imageBrightness).toBe(0);
    });

    it('dispose しても、Host から受け取ったテクスチャは破棄しない (Host のもの)', () => {
      const p = makePreset();
      const t = tex();
      let disposed = false;
      t.addEventListener('dispose', () => (disposed = true));
      p.setImage({ texture: t, aspect: 1 });
      p.dispose();
      expect(disposed).toBe(false);
    });
  });

  it('同じ seed・同じ音声なら粒子の配置まで完全に一致し、seed が違えば変わる (書き出しの再現性)', () => {
    const audio = (i: number): Partial<AudioFrame> => ({ high: 0.5 + 0.5 * Math.sin(i / 7), beat: i % 30 === 0 ? 1 : 0, beatIndex: Math.floor(i / 30) });
    const a = makePreset(7);
    const b = makePreset(7);
    const c = makePreset(8);
    run(a, 150, audio);
    run(b, 150, audio);
    run(c, 150, audio);
    expect(Array.from(a.particlePositionsSnapshot())).toEqual(Array.from(b.particlePositionsSnapshot()));
    expect(Array.from(a.particlePositionsSnapshot())).not.toEqual(Array.from(c.particlePositionsSnapshot()));
  });

  it('dt=0 や極端な dt・値でも NaN にならない', () => {
    const p = makePreset();
    p.update(frame(0, { dt: 0, bass: 1, high: 1 }), params());
    p.update(frame(1, { dt: 5, bass: 1, high: 1, beat: 1, beatIndex: 3 }), params());
    p.update(frame(2, { dt: Number.NaN, high: 1 }), params());
    const positions = p.particlePositionsSnapshot();
    expect(positions.every((v) => Number.isFinite(v))).toBe(true);
    expect(Number.isFinite(p.inspect().meanRayLength)).toBe(true);
  });

  it('縦長の画面ではカメラを引いて円環が左右で切れないようにする', () => {
    const p = makePreset();
    p.resize(1920, 1080);
    const landscape = p.inspect().cameraDistance;
    p.resize(1080, 1920);
    expect(p.inspect().cameraDistance).toBeGreaterThan(landscape);
  });

  it('テーマを切り替えても落ちず、dispose できる', () => {
    const p = makePreset();
    for (const theme of ['gold', 'ice', 'neon', 'mono', 'unknown-theme', 'default']) {
      run(p, 2, () => ({ bass: 0.5 }), params({ colorTheme: theme }));
    }
    expect(() => p.dispose()).not.toThrow();
  });
});
