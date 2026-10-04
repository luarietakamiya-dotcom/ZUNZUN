import { expect, test } from '@playwright/test';

/**
 * Kaleidoscope (万華鏡。2026-10-04 ユーザー要望。曲調に合わせて色と模様が変わる) の E2E。本物の VisualizerHost + PostFX で描く。
 * - シェーダーのエラー (コンパイル失敗など) が出ない。横長・縦長・正方形のどれでも映る
 * - 同じ入力なら同じ絵 (乱数を使わない)、音で絵が変わる、鏡の枚数・キラキラの設定が効く
 * - 曲調: 静かな曲を流し続けた絵と、激しい曲を流し続けた絵では、色が違う。曲全体の情報 (frame.song) でも同じ
 * - 区間: 区間が違えば破片の並びが違い、切り替えの途中を含めても映る
 */

test.describe.configure({ timeout: 180_000 });

test('Kaleidoscope: シェーダーのエラーなく映り、同じ入力なら同じ絵。鏡の枚数・曲調で絵が変わる。縦長・正方形でも映る', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text().slice(0, 300));
  });
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
    const { visualizerRegistry } = await import('/src/visualizers/index.ts');
    const { defaultCommonParams } = await import('/src/core/types.ts');
    const LOUD = { bass: 0.6, mid: 0.4, high: 0.3, rms: 0.5, peak: 0.6, spectralEnergy: 0.5, flux: 0.5 };
    const QUIET = { bass: 0.05, mid: 0.05, high: 0.05, rms: 0.05, peak: 0.08, spectralEnergy: 0.05, flux: 0.02 };
    const shot = async (W: number, H: number, level: Record<string, number>, seconds: number, extra: Record<string, unknown> = {}, song?: { mood: number; section: (t: number) => number }): Promise<Uint8ClampedArray> => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(W, H);
      const params = { ...defaultCommonParams(), sensitivity: 1, ...extra } as ReturnType<typeof defaultCommonParams> & Record<string, unknown>;
      await host.setPreset(visualizerRegistry.get('kaleidoscope')!, 1, params);
      const frames = Math.round(seconds * 30);
      for (let i = 0; i < frames; i++) {
        const t = i / 30;
        host.render({ t, dt: 1 / 30, beat: 0, beatIndex: -1, bands: new Float32Array(64).fill(level.rms! * 1.2), ...level, ...(song ? { song: { mood: song.mood, section: song.section(t), sectionStart: 0, sectionCount: 3 } } : {}) } as never, params);
      }
      const tmp = document.createElement('canvas');
      tmp.width = W;
      tmp.height = H;
      const tg = tmp.getContext('2d', { willReadFrequently: true })!;
      tg.drawImage(canvas, 0, 0);
      const d = tg.getImageData(0, 0, W, H).data;
      host.dispose();
      canvas.remove();
      return d;
    };
    const mean = (d: Uint8ClampedArray): number => {
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      return s / (d.length / 4);
    };
    const channels = (d: Uint8ClampedArray): number[] => {
      const c = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) c[k]! += d[i + k]!;
      return c.map((v) => v / (d.length / 4));
    };
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let s = 0;
      for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
      return s / (a.length / 4) / 3;
    };
    const a = await shot(160, 90, LOUD, 2);
    const a2 = await shot(160, 90, LOUD, 2);
    const six = await shot(160, 90, LOUD, 2, { segments: 6 });
    const twelve = await shot(160, 90, LOUD, 2, { segments: 12 });
    const noSparkle = await shot(160, 90, LOUD, 2, { sparkle: 0 });
    const fullSparkle = await shot(160, 90, LOUD, 2, { sparkle: 1 });
    const calm = await shot(160, 90, QUIET, 40);
    const lively = await shot(160, 90, LOUD, 40);
    // 曲全体の曲調 (frame.song): ライブの音は同じ (大きい) でも、曲の中で静かな所と激しい所で色が違う。区間が違えば破片の並びが違う
    const songCalm = await shot(160, 90, LOUD, 20, { follow: 1 }, { mood: 0.05, section: () => 0 });
    const songLively = await shot(160, 90, LOUD, 20, { follow: 1 }, { mood: 0.95, section: () => 0 });
    const sec0 = await shot(160, 90, LOUD, 6, { follow: 1 }, { mood: 0.5, section: () => 0 });
    const sec1 = await shot(160, 90, LOUD, 6, { follow: 1 }, { mood: 0.5, section: () => 1 });
    // 切り替えの途中を含めて描いても、エラーなく映る (2 秒で区間 0 → 1)
    const switching = await shot(160, 90, LOUD, 5, { follow: 1 }, { mood: 0.5, section: (t) => (t < 2 ? 0 : 1) });
    // ハート: 出やすさ 1 (ずっとハート) と 0 (花びらの形のまま) で絵が違う
    const heartOn = await shot(160, 90, LOUD, 6, { heart: 1, sparkle: 0 });
    const heartOff = await shot(160, 90, LOUD, 6, { heart: 0, sparkle: 0 });
    const tall = await shot(90, 160, LOUD, 2);
    const square = await shot(120, 120, LOUD, 2);
    return {
      meanA: mean(a),
      same: diff(a, a2),
      segDiff: diff(six, twelve),
      sparkleDiff: diff(noSparkle, fullSparkle),
      sparkleMore: mean(fullSparkle) - mean(noSparkle),
      calmCh: channels(calm),
      livelyCh: channels(lively),
      songCalmCh: channels(songCalm),
      songLivelyCh: channels(songLively),
      sectionDiff: diff(sec0, sec1),
      switching: mean(switching),
      heartDiff: diff(heartOn, heartOff),
      tall: mean(tall),
      square: mean(square),
    };
  });
  const redShare = (c: number[]): number => c[0]! / Math.max(1, c[0]! + c[1]! + c[2]!);
  expect(errors).toEqual([]);
  expect(r.meanA).toBeGreaterThan(8); // 映る (真っ黒でない)
  expect(r.meanA).toBeLessThan(160); // 白く飛ばない
  expect(r.same).toBeLessThan(0.5); // 同じ入力なら同じ絵
  expect(r.segDiff).toBeGreaterThan(3); // 鏡の枚数で絵が変わる
  // 曲全体の曲調: ライブの音が同じでも、曲の中で激しい所は赤が多く、静かな所は少ない
  expect(redShare(r.songLivelyCh)).toBeGreaterThan(redShare(r.songCalmCh) + 0.1);
  expect(r.sectionDiff).toBeGreaterThan(3); // 区間が違えば破片の並び・色の割り当てが違う
  expect(r.switching).toBeGreaterThan(8); // 切り替えを含めて映る
  expect(r.heartDiff).toBeGreaterThan(0.2); // ハートの出やすさで絵が変わる
  expect(r.sparkleDiff).toBeGreaterThan(0.2); // キラキラの量で絵が変わる
  expect(r.sparkleMore).toBeGreaterThan(0); // 増やすと明るくなる (光が足されるだけ)
  expect(r.tall).toBeGreaterThan(8);
  expect(r.square).toBeGreaterThan(8);
  // 曲調: 静かな曲 (青〜青緑) は赤が少なく、激しい曲 (マゼンタ・オレンジ) は赤が多い
  expect(redShare(r.livelyCh)).toBeGreaterThan(redShare(r.calmCh) + 0.1);
});
