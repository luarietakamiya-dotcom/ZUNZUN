import { expect, test } from '@playwright/test';

/**
 * Spectrum Wave (背景の絵に重ねる前提の、スペクトルのなめらかな光の波形。2026-10-03 ユーザー要望) の E2E。本物の VisualizerHost + PostFX で描く。
 * - シェーダーのエラー (コンパイル失敗など) が出ない
 * - 音が無ければ (反射も含め) ほぼ黒、音で映る。低音は左に、高音は右に山ができる。位置の設定が効く
 * - 背景の絵に「スクリーン」で重ねると、絵は見えたまま、光だけが乗る
 */

test.describe.configure({ timeout: 120_000 });

test('Spectrum Wave: シェーダーのエラーなく映り、低音は左・高音は右に山ができる。位置の設定が効き、背景に光だけが乗る', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text().slice(0, 300));
  });
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
    const { visualizerRegistry } = await import('/src/visualizers/index.ts');
    const { defaultCommonParams, defaultBackground } = await import('/src/core/types.ts');
    const W = 160;
    const H = 90;
    const shot = async (bands: Float32Array, extra: Record<string, unknown>, withBackground: boolean): Promise<Uint8ClampedArray> => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(W, H);
      const params = { ...defaultCommonParams(), sensitivity: 1, ...extra } as ReturnType<typeof defaultCommonParams> & Record<string, unknown>;
      await host.setPreset(visualizerRegistry.get('spectrum-wave')!, 1, params);
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
      for (let i = 0; i < 40; i++) host.render({ t: i / 30, dt: 1 / 30, bass: 0.3, mid: 0.3, high: 0.3, rms: 0.4, peak: 0.4, beat: 0, beatIndex: -1, spectralEnergy: 0.3, flux: 0.2, bands }, params);
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
    const mean = (d: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number): number => {
      let s = 0;
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          s += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
          n++;
        }
      return s / n;
    };
    const silent = await shot(new Float32Array(64), {}, false);
    const bassOnly = new Float32Array(64);
    for (let i = 0; i < 8; i++) bassOnly[i] = 1;
    const highOnly = new Float32Array(64);
    for (let i = 38; i < 47; i++) highOnly[i] = 1;
    const bass = await shot(bassOnly, {}, false);
    const high = await shot(highOnly, {}, false);
    // 位置: 下 (-1) と上 (1) で、光の重心の高さが変わる
    const mid = new Float32Array(64).fill(0.5);
    const low = await shot(mid, { position: -1, height: 0.3 }, false);
    const upper = await shot(mid, { position: 1, height: 0.3 }, false);
    const rows = (d: Uint8ClampedArray): number => {
      let s = 0;
      let w = 0;
      for (let y = 0; y < H; y++) {
        const v = mean(d, 0, y, W, y + 1);
        s += v * y;
        w += v;
      }
      return w > 0 ? s / w : -1;
    };
    // 背景の絵に重ねる
    const onBg = await shot(new Float32Array(64).fill(0.3), {}, true);
    let kept = 0;
    let brighter = 0;
    for (let i = 0; i < onBg.length; i += 4) {
      if (onBg[i]! < 20 && onBg[i + 1]! > 80 && onBg[i + 1]! < 120) kept++;
      if (onBg[i]! + onBg[i + 1]! + onBg[i + 2]! > 100 + 90) brighter++;
    }
    return {
      silentMean: mean(silent, 0, 0, W, H),
      silentRows: Array.from({ length: H }, (_, y) => mean(silent, 0, y, W, y + 1)).filter((v) => v > 30).length,
      bassMean: mean(bass, 0, 0, W, H),
      bassLeft: mean(bass, 0, 0, 40, H),
      bassRight: mean(bass, 120, 0, 160, H),
      highLeft: mean(high, 0, 0, 40, H),
      highRight: mean(high, 120, 0, 160, H),
      rowsLow: rows(low),
      rowsUpper: rows(upper),
      kept: kept / (W * H),
      brighter: brighter / (W * H),
    };
  });
  expect(errors).toEqual([]);
  // 音が無くても、基準線の細い線が 1 本だけ残る (待機の線)。画面全体では暗く、音があるときより暗い
  expect(r.silentMean).toBeLessThan(20);
  expect(r.bassMean).toBeGreaterThan(r.silentMean);
  expect(r.silentRows).toBeLessThanOrEqual(8); // 待機の線は細い (明るい行が 8 行以下)
  expect(r.bassLeft).toBeGreaterThan(r.bassRight * 3); // 低音は左
  expect(r.highRight).toBeGreaterThan(r.highLeft * 3); // 高音は右
  expect(r.rowsUpper).toBeLessThan(r.rowsLow - 8); // 位置を上にすると、光が上 (行の番号が小さい) へ
  expect(r.brighter).toBeGreaterThan(0.005);
  expect(r.kept).toBeGreaterThan(0.3);
});
