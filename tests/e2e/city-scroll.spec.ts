import { expect, test } from '@playwright/test';

/**
 * 「流れる街並み」の E2E: 10 枚の街並みと「全部つなげる」が読み込まれて映り (真っ黒でない)、時間がたつと絵が流れて変わる。
 * 同じ音・同じ seed なら同じ絵 (乱数は ctx.rng だけ)。ぼかしを上げると細かい模様が減る。
 */

test.describe.configure({ timeout: 180_000 });

for (const scene of ['grand-avenue', 'neon-night', 'old-downtown', 'harbor-town', 'tram-street', 'palace-plaza', 'residential', 'rainy-street', 'country-road', 'marathon', 'all']) {
  test(`流れる街並み (${scene}): 絵が映り、時間がたつと流れ、同じなら同じ絵、ぼかすと細かさが減る`, async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async (scene) => {
      const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
      const { visualizerRegistry } = await import('/src/visualizers/index.ts');
      const { defaultCommonParams } = await import('/src/core/types.ts');
      const W = 320;
      const H = 180;
      const shot = async (frames: number, extra: Record<string, unknown> = {}): Promise<Uint8ClampedArray> => {
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        document.body.appendChild(canvas);
        const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
        host.resize(W, H);
        const params = { ...defaultCommonParams(), scene, speed: 0.6, ...extra };
        await host.setPreset(visualizerRegistry.get('city-scroll')!, 1, params);
        for (let i = 0; i < frames; i++) {
          host.render({ t: i / 30, dt: 1 / 30, bass: 0.5, mid: 0, high: 0.5, rms: 0.5, peak: 0, beat: i % 15 === 0 ? 1 : 0, beatIndex: Math.floor(i / 15), spectralEnergy: 0, flux: 0, bands: new Float32Array(64) }, params);
        }
        const tmp = document.createElement('canvas');
        tmp.width = W;
        tmp.height = H;
        const g = tmp.getContext('2d')!;
        g.drawImage(canvas, 0, 0);
        const data = g.getImageData(0, 0, W, H).data;
        host.dispose();
        canvas.remove();
        return data;
      };
      const early = await shot(2);
      const later = await shot(90);
      const again = await shot(90);
      const blurred = await shot(2, { blur: 1, particles: 'none', sparkle: 0 });
      const sharp = await shot(2, { particles: 'none', sparkle: 0 });
      let mean = 0;
      let moved = 0;
      let same = 0;
      // 細かさ = 隣の画素との差の平均
      const detail = (d: Uint8ClampedArray): number => {
        let s = 0;
        for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) s += Math.abs(d[(y * W + x) * 4]! - d[(y * W + x - 1) * 4]!);
        return s / (W * H);
      };
      for (let i = 0; i < early.length; i += 4) {
        mean += (early[i]! + early[i + 1]! + early[i + 2]!) / 3;
        moved += Math.abs(later[i]! - early[i]!) + Math.abs(later[i + 1]! - early[i + 1]!) + Math.abs(later[i + 2]! - early[i + 2]!);
        same = Math.max(same, Math.abs(later[i]! - again[i]!), Math.abs(later[i + 1]! - again[i + 1]!), Math.abs(later[i + 2]! - again[i + 2]!));
      }
      const n = early.length / 4;
      return { mean: mean / n, moved: moved / n, same, sharp: detail(sharp), blurred: detail(blurred) };
    }, scene);
    expect(r.mean, JSON.stringify(r)).toBeGreaterThan(12);
    expect(r.moved, JSON.stringify(r)).toBeGreaterThan(5);
    expect(r.same, JSON.stringify(r)).toBeLessThanOrEqual(1);
    expect(r.blurred, JSON.stringify(r)).toBeLessThan(r.sharp * 0.7);
  });
}

test('「ビジュアライザー」タブで「流れる街並み」を選ぶと、向き・速さ・ぼかし・きらめき・舞うものの設定が出る', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'en'));
  await page.goto('/');
  await page.getByRole('tab', { name: 'Visualizer' }).click();
  await page.locator('section.panel select').first().selectOption('city-scroll');
  for (const key of ['scene', 'direction', 'particles']) await expect(page.locator(`select[data-preset-param="${key}"]`)).toBeVisible();
  for (const key of ['speed', 'blur', 'sparkle', 'particleAmount']) await expect(page.locator(`[data-preset-param="${key}"]`)).toBeVisible();
  await page.locator('select[data-preset-param="direction"]').selectOption('right');
  await expect(page.locator('select[data-preset-param="direction"]')).toHaveValue('right');
});
