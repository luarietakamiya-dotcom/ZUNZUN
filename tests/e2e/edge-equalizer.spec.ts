import { expect, test } from '@playwright/test';

/**
 * Edge Equalizer (背景の絵に重ねる前提の、画面の縁のイコライザー。2026-10-03 ユーザー要望) の E2E。本物の VisualizerHost + PostFX で描く。
 * - シェーダーのエラー (コンパイル失敗など) が出ない
 * - 四辺に映る・真ん中は黒のまま (縁だけ)・低音は下の真ん中、高音は上の真ん中に出る
 * - 使う辺の設定が効く (下だけ → 上の縁には出ない)
 * - 背景の絵に「スクリーン」で重ねると、絵は見えたまま、光だけが乗る
 */

test.describe.configure({ timeout: 120_000 });

test('Edge Equalizer: シェーダーのエラーなく、縁だけに映る。低音は下の真ん中、高音は上の真ん中。辺の設定が効き、背景に光だけが乗る', async ({ page }) => {
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
      await host.setPreset(visualizerRegistry.get('edge-equalizer')!, 1, params);
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
      for (let i = 0; i < 30; i++) host.render({ t: i / 30, dt: 1 / 30, bass: 0.3, mid: 0.3, high: 0.3, rms: 0.4, peak: 0.4, beat: 0, beatIndex: -1, spectralEnergy: 0.3, flux: 0.2, bands }, params);
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
    /** 長方形の範囲の、明るさの平均 */
    const area = (d: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number): number => {
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
    const all = new Float32Array(64).fill(0.9);
    const bassOnly = new Float32Array(64);
    for (let i = 0; i < 6; i++) bassOnly[i] = 1;
    const highOnly = new Float32Array(64);
    for (let i = 40; i < 47; i++) highOnly[i] = 1;
    const full = await shot(all, {}, false);
    const bass = await shot(bassOnly, {}, false);
    const high = await shot(highOnly, {}, false);
    const bottomOnly = await shot(all, { edges: 'bottom' }, false);
    // 背景の絵に重ねる確認は、ふつうの曲くらいの強さ (0.3) で
    const onBg = await shot(new Float32Array(64).fill(0.3), {}, true);
    // 場所: 下の真ん中 (x 70..90, y 70..90)、上の真ん中 (y 0..20)、左の縁 (x 0..12)、画面の真ん中
    const regions = (d: Uint8ClampedArray) => ({
      bottomMid: area(d, 70, 72, 90, 90),
      topMid: area(d, 70, 0, 90, 18),
      left: area(d, 0, 30, 12, 60),
      centre: area(d, 60, 30, 100, 60),
    });
    let kept = 0;
    for (let i = 0; i < onBg.length; i += 4) if (onBg[i]! < 20 && onBg[i + 1]! > 80 && onBg[i + 1]! < 120) kept++;
    return { full: regions(full), bass: regions(bass), high: regions(high), bottomOnly: regions(bottomOnly), kept: kept / (W * H) };
  });
  expect(errors).toEqual([]);
  // 縁に映り、真ん中は黒のまま
  expect(r.full.bottomMid).toBeGreaterThan(8);
  expect(r.full.topMid).toBeGreaterThan(8);
  expect(r.full.left).toBeGreaterThan(3);
  expect(r.full.centre).toBeLessThan(r.full.bottomMid / 3); // 真ん中には届かない (にじみだけ)
  // 低音は下の真ん中、高音は上の真ん中
  expect(r.bass.bottomMid).toBeGreaterThan(r.bass.topMid * 8);
  expect(r.high.topMid).toBeGreaterThan(r.high.bottomMid * 8);
  // 下だけ: 上の縁には出ない
  expect(r.bottomOnly.bottomMid).toBeGreaterThan(8);
  expect(r.bottomOnly.topMid).toBeLessThan(r.bottomOnly.bottomMid / 10);
  // 背景の絵は、光の無い所 (真ん中) でそのまま見える
  expect(r.kept).toBeGreaterThan(0.3);
});
