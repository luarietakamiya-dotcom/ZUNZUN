import { expect, test } from '@playwright/test';

/**
 * Ripples (背景の絵に重ねる前提の波紋のエフェクト。2026-10-03 ユーザー選択) の E2E。本物の VisualizerHost + PostFX で描く。
 * - 映る (真っ黒でない)、同じ seed・同じ音なら同じ絵、seed が違えば波紋の位置が違う絵 (乱数は ctx.rng だけ)
 * - 音が無いときは何も出ない (真っ黒)
 * - 背景の絵に「スクリーン」で重ねると、絵は見えたまま、光だけが乗る
 */

test.describe.configure({ timeout: 120_000 });

test('Ripples: 静かなら黒、音で波紋が映る。同じ seed なら同じ絵、seed が違えば違う絵。背景の絵に光だけが乗る', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
    const { visualizerRegistry } = await import('/src/visualizers/index.ts');
    const { defaultCommonParams, defaultBackground } = await import('/src/core/types.ts');
    const W = 160;
    const H = 90;
    const shot = async (seed: number, loud: boolean, withBackground: boolean): Promise<Uint8ClampedArray> => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(W, H);
      const params = { ...defaultCommonParams() } as ReturnType<typeof defaultCommonParams> & Record<string, unknown>;
      await host.setPreset(visualizerRegistry.get('ripples')!, seed, params);
      if (withBackground) {
        const src = document.createElement('canvas');
        src.width = 64;
        src.height = 36;
        const g = src.getContext('2d')!;
        g.fillStyle = '#006400';
        g.fillRect(0, 0, 64, 36);
        const blob = await new Promise<Blob>((res) => src.toBlob((b) => res(b!), 'image/png'));
        await host.background.load({ ...defaultBackground('g.png', 'a'.repeat(64), 'image'), dim: 0 }, new File([blob], 'g.png', { type: 'image/png' }));
      }
      for (let i = 0; i < 40; i++) {
        const t = i / 30;
        const e = Math.exp(-(((t % 0.5) / 0.5) * 5));
        host.render({ t, dt: 1 / 30, bass: loud ? 0.9 * e : 0, mid: loud ? 0.4 : 0, high: loud && i % 5 === 0 ? 0.9 : 0, rms: loud ? 0.5 : 0, peak: 0.4, beat: loud ? e : 0, beatIndex: loud ? Math.floor(t / 0.5) : -1, spectralEnergy: 0.3, flux: 0.2, bands: new Float32Array(64) }, params);
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
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let s = 0;
      for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
      return s / (a.length / 4);
    };
    const quiet = await shot(1, false, false);
    const a = await shot(1, true, false);
    const a2 = await shot(1, true, false);
    const b = await shot(2, true, false);
    const onBg = await shot(1, true, true);
    // 背景 (暗い緑 #006400) に光が足されて、背景だけより明るい所が増える。緑の背景は、光の無い所ではそのまま残る
    let brighter = 0;
    let kept = 0;
    for (let i = 0; i < onBg.length; i += 4) {
      const sum = onBg[i]! + onBg[i + 1]! + onBg[i + 2]!;
      if (sum > 100 + 120) brighter++;
      if (onBg[i]! < 20 && onBg[i + 1]! > 80 && onBg[i + 1]! < 120) kept++;
    }
    return { quietMean: mean(quiet), loudMean: mean(a), same: diff(a, a2), seedDiff: diff(a, b), brighter: brighter / (W * H), kept: kept / (W * H) };
  });
  expect(r.quietMean).toBeLessThan(0.5); // 静かなら出ない
  expect(r.loudMean).toBeGreaterThan(2); // 音で映る
  expect(r.same).toBe(0); // 同じ seed・同じ音なら同じ絵
  expect(r.seedDiff).toBeGreaterThan(0.5); // seed が違えば波紋の位置が違う
  expect(r.brighter).toBeGreaterThan(0.01); // 光が乗る
  expect(r.kept).toBeGreaterThan(0.3); // 光の無い所は、背景の緑のまま
});
