import { expect, test } from '@playwright/test';

/**
 * LED Matrix (背景の絵に重ねる前提の、ドット格子の LED メーター。2026-10-03 ユーザー要望) の E2E。本物の VisualizerHost + PostFX で描く。
 * - シェーダーのエラー (コンパイル失敗など) が出ない
 * - 低音は左・高音は右の列が点灯し、下から上へ積み上がる。「中央から上下」では上と下に対称に広がる
 * - クラシックの色 (下は緑、上は赤) と、テーマの色の違い
 * - 背景の絵に「スクリーン」で重ねると、絵は見えたまま、光だけが乗る
 */

test.describe.configure({ timeout: 120_000 });

test('LED Matrix: シェーダーのエラーなく映り、低音は左・高音は右が点灯する。中央からの並べ方・クラシックの色が効き、背景に光だけが乗る', async ({ page }) => {
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
      await host.setPreset(visualizerRegistry.get('led-matrix')!, 1, params);
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
    const rgb = (d: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number): number[] => {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          r += d[i]!;
          g += d[i + 1]!;
          b += d[i + 2]!;
          n++;
        }
      return [r / n, g / n, b / n];
    };
    const bassOnly = new Float32Array(64);
    for (let i = 0; i < 8; i++) bassOnly[i] = 1;
    const highOnly = new Float32Array(64);
    for (let i = 38; i < 47; i++) highOnly[i] = 1;
    const full = new Float32Array(64).fill(1);
    const bass = await shot(bassOnly, { grid: 0 }, false);
    const high = await shot(highOnly, { grid: 0 }, false);
    const bottom = await shot(full, { layout: 'bottom', grid: 0, height: 1 }, false);
    const centre = await shot(full, { layout: 'center', grid: 0, height: 1 }, false);
    const theme = await shot(full, { layout: 'bottom', colors: 'theme', grid: 0, height: 1 }, false);
    const onBg = await shot(new Float32Array(64).fill(0.3), {}, true);
    let kept = 0;
    let brighter = 0;
    for (let i = 0; i < onBg.length; i += 4) {
      if (onBg[i]! < 20 && onBg[i + 1]! > 80 && onBg[i + 1]! < 120) kept++;
      if (onBg[i]! + onBg[i + 1]! + onBg[i + 2]! > 100 + 90) brighter++;
    }
    return {
      bassLeft: mean(bass, 0, 0, 40, H),
      bassRight: mean(bass, 120, 0, 160, H),
      highLeft: mean(high, 0, 0, 40, H),
      highRight: mean(high, 120, 0, 160, H),
      // 下から: 下の方が点灯、上の端は消えている。中央から: 真ん中が点灯して、上下対称
      bottomLow: mean(bottom, 0, 70, W, 90),
      bottomTopEdge: mean(bottom, 0, 0, W, 4),
      centreMid: mean(centre, 0, 40, W, 50),
      centreUp: mean(centre, 0, 20, W, 30),
      centreDown: mean(centre, 0, 60, W, 70),
      // クラシックの色 (下は緑 = 緑 > 赤、上は赤 = 赤 > 緑)
      classicLow: rgb(bottom, 0, 74, W, 88),
      classicHigh: rgb(bottom, 0, 6, W, 20),
      themeLow: rgb(theme, 0, 74, W, 88),
      kept: kept / (W * H),
      brighter: brighter / (W * H),
    };
  });
  expect(errors).toEqual([]);
  expect(r.bassLeft).toBeGreaterThan(r.bassRight * 3); // 低音は左
  expect(r.highRight).toBeGreaterThan(r.highLeft * 3); // 高音は右
  expect(r.bottomLow).toBeGreaterThan(20); // 下から積み上がる
  expect(r.bottomTopEdge).toBeLessThan(r.bottomLow / 3); // 上の端までは届かない (高さ 1 でも画面の 95% まで)
  expect(r.centreMid).toBeGreaterThan(10);
  expect(Math.abs(r.centreUp - r.centreDown)).toBeLessThan(Math.max(r.centreUp, r.centreDown) * 0.35 + 2); // 上下対称
  expect(r.classicLow[1]!).toBeGreaterThan(r.classicLow[0]! * 1.5); // 下は緑
  expect(r.classicHigh[0]!).toBeGreaterThan(r.classicHigh[1]! * 1.5); // 上は赤
  expect(r.themeLow[2]!).toBeGreaterThan(r.themeLow[0]!); // テーマの色 (ミント〜青) は赤くない
  expect(r.brighter).toBeGreaterThan(0.005);
  expect(r.kept).toBeGreaterThan(0.3);
});
