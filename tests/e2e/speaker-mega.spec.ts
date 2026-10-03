import { expect, test } from '@playwright/test';

/**
 * Mega Speaker (背景の絵に重ねる前提の、めちゃくちゃ派手なスピーカー。2026-10-03 ユーザー要望) の E2E。本物の VisualizerHost + PostFX で描く。
 * - シェーダーのエラー (コンパイル失敗など) が出ない
 * - 映る・色がある (虹色 = 赤・緑・青のどれも出る)・同じ入力なら同じ絵・seed が違えば色が違う絵・低音で変わる
 * - 背景の絵に「スクリーン」で重ねると、絵は見えたまま、光だけが乗る
 */

test.describe.configure({ timeout: 120_000 });

test('Mega Speaker: シェーダーのエラーなく、虹色で映り、同じ seed なら同じ絵、seed が違えば違う絵。背景に光だけが乗る', async ({ page }) => {
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
    const shot = async (seed: number, bass: number, withBackground: boolean): Promise<Uint8ClampedArray> => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(W, H);
      const params = { ...defaultCommonParams() } as ReturnType<typeof defaultCommonParams> & Record<string, unknown>;
      await host.setPreset(visualizerRegistry.get('speaker-mega')!, seed, params);
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
        host.render({ t, dt: 1 / 30, bass: bass * e, mid: 0.4, high: 0.5, rms: 0.5, peak: 0.4, beat: bass > 0.1 ? e : 0, beatIndex: bass > 0.1 ? Math.floor(t / 0.5) : -1, spectralEnergy: 0.3, flux: 0.2, bands: new Float32Array(64).fill(bass * 0.8) }, params);
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
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let s = 0;
      for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
      return s / (a.length / 4);
    };
    const a = await shot(1, 0.9, false);
    const a2 = await shot(1, 0.9, false);
    const b = await shot(2, 0.9, false);
    const quiet = await shot(1, 0.02, false);
    const onBg = await shot(1, 0.9, true);
    // 虹色: 赤・緑・青のどれも、はっきり出ている画素がある
    let red = 0;
    let green = 0;
    let blue = 0;
    let mean = 0;
    let quietMean = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i]! > 150 && a[i]! > a[i + 2]! * 1.5) red++;
      if (a[i + 1]! > 150 && a[i + 1]! > a[i]! * 1.3) green++;
      if (a[i + 2]! > 150 && a[i + 2]! > a[i]! * 1.3) blue++;
      mean += (a[i]! + a[i + 1]! + a[i + 2]!) / 3;
      quietMean += (quiet[i]! + quiet[i + 1]! + quiet[i + 2]!) / 3;
    }
    const n = a.length / 4;
    let kept = 0;
    for (let i = 0; i < onBg.length; i += 4) if (onBg[i]! < 20 && onBg[i + 1]! > 80 && onBg[i + 1]! < 120) kept++;
    return { red, green, blue, mean: mean / n, quietMean: quietMean / n, same: diff(a, a2), seedDiff: diff(a, b), kept: kept / n };
  });
  expect(errors).toEqual([]);
  expect(r.mean).toBeGreaterThan(5); // 映る (派手)
  expect(r.mean).toBeGreaterThan(r.quietMean); // 低音で明るくなる
  expect(Math.min(r.red, r.green, r.blue)).toBeGreaterThan(5); // 虹色
  expect(r.same).toBe(0);
  expect(r.seedDiff).toBeGreaterThan(1); // seed が違えば色が違う
  expect(r.kept).toBeGreaterThan(0.1); // 光の無い所は、背景のまま
});
