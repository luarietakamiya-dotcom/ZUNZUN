import { expect, test } from '@playwright/test';

/**
 * Speaker Cone (背景の絵に重ねる前提のスピーカーのコーン風エフェクト。2026-10-03 ユーザー要望) の E2E。
 * 本物の VisualizerHost + PostFX で描く。
 * - 映る (真っ黒でない)、同じ入力なら同じ絵 (乱数を使わない)、低音で絵が変わる
 * - 背景の絵に「スクリーン」で重ねると、絵は見えたまま、光だけが乗る (黒は透ける)
 */

test.describe.configure({ timeout: 120_000 });

test('Speaker Cone: 映り、同じ入力なら同じ絵で、低音で変わる。背景の絵に光だけが乗る', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
    const { visualizerRegistry } = await import('/src/visualizers/index.ts');
    const { defaultCommonParams, defaultBackground } = await import('/src/core/types.ts');
    const W = 160;
    const H = 90;
    const shot = async (bass: number, withBackground: boolean): Promise<Uint8ClampedArray> => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(W, H);
      const params = { ...defaultCommonParams() } as ReturnType<typeof defaultCommonParams> & Record<string, unknown>;
      await host.setPreset(visualizerRegistry.get('speaker-cone')!, 1, params);
      if (withBackground) {
        // 全体が暗い緑 (#006400) の絵を背景に (重ね方は既定の「スクリーン」)
        const src = document.createElement('canvas');
        src.width = 64;
        src.height = 36;
        const g = src.getContext('2d')!;
        g.fillStyle = '#006400';
        g.fillRect(0, 0, 64, 36);
        const blob = await new Promise<Blob>((res) => src.toBlob((b) => res(b!), 'image/png'));
        await host.background.load({ ...defaultBackground('g.png', 'a'.repeat(64), 'image'), dim: 0 }, new File([blob], 'g.png', { type: 'image/png' }));
      }
      for (let i = 0; i < 30; i++) {
        const t = i / 30;
        host.render({ t, dt: 1 / 30, bass, mid: 0.3, high: 0.3, rms: 0.4, peak: 0.4, beat: i % 15 === 0 ? 1 : 0, beatIndex: Math.floor(i / 15), spectralEnergy: 0.3, flux: 0.2, bands: new Float32Array(64).fill(bass * 0.8) }, params);
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
    const quiet = await shot(0.05, false);
    const loud = await shot(0.9, false);
    const loud2 = await shot(0.9, false);
    const onBg = await shot(0.9, true);
    // 背景だけ (スピーカーを描かない所 = 画面の左上の角) の色
    const corner = [onBg[0]!, onBg[1]!, onBg[2]!];
    // スピーカーの中心 (ドーム)
    const c = (Math.floor(H / 2) * W + Math.floor(W / 2)) * 4;
    const centre = [onBg[c]!, onBg[c + 1]!, onBg[c + 2]!];
    return { quietMean: mean(quiet), loudMean: mean(loud), same: diff(loud, loud2), changed: diff(quiet, loud), corner, centre };
  });
  expect(r.quietMean).toBeGreaterThan(1); // 映る
  expect(r.loudMean).toBeGreaterThan(r.quietMean); // 低音で明るくなる
  expect(r.same).toBe(0); // 同じ入力なら同じ絵
  expect(r.changed).toBeGreaterThan(1); // 低音で絵が変わる
  // 角: 背景の暗い緑がそのまま (赤・青はほぼ 0、緑が見える)。スピーカーの中心: 光が足されて明るい
  expect(r.corner[1]!).toBeGreaterThan(60);
  expect(r.corner[0]!).toBeLessThan(40);
  expect(r.centre[0]! + r.centre[1]! + r.centre[2]!).toBeGreaterThan(r.corner[0]! + r.corner[1]! + r.corner[2]! + 90);
});
