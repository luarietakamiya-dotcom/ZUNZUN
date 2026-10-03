import { expect, test } from '@playwright/test';

/**
 * 「なし」(何も描かないビジュアライザー。2026-10-03 ユーザー「ビジュアライザーは最初は何もつけないのがデフォルトにしよう」):
 * - 新しく開いたときの既定で、Visualizer タブの選択欄の先頭に出る
 * - 選んでいると、ビジュアライザーの層は描かれず、背景などがそのまま見える (ほかのプリセットは黒で覆う)
 */

test.describe.configure({ timeout: 120_000 });

test('既定は「なし」。Visualizer タブの選択欄の先頭に出て、ほかの映像に替えても戻せる', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'en'));
  await page.goto('/');
  await page.getByRole('tab', { name: 'Visualizer' }).click();
  const select = page.locator('section.panel select').first();
  await expect(select).toHaveValue('none');
  await expect(select.locator('option').first()).toHaveText('なし / None');
  await select.selectOption('solar-gate');
  expect(await page.evaluate(async () => (await import('/src/core/store.ts')).store.presetId)).toBe('solar-gate');
  await select.selectOption('none');
  expect(await page.evaluate(async () => (await import('/src/core/store.ts')).store.presetId)).toBe('none');
});

test('「なし」のとき、背景の画像がそのまま見える。ほかの映像 (Solar Gate) は黒で覆うので見えない', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
    const { visualizerRegistry } = await import('/src/visualizers/index.ts');
    const { defaultCommonParams, defaultBackground } = await import('/src/core/types.ts');
    const W = 160;
    const H = 90;
    const src = document.createElement('canvas');
    src.width = 64;
    src.height = 36;
    const sg = src.getContext('2d')!;
    sg.fillStyle = '#00c800';
    sg.fillRect(0, 0, 64, 36);
    const blob = await new Promise<Blob>((res) => src.toBlob((b) => res(b!), 'image/png'));
    const file = new File([blob], 'green.png', { type: 'image/png' });
    const out: Record<string, number[]> = {};
    for (const id of ['none', 'solar-gate']) {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(W, H);
      const params = { ...defaultCommonParams(), cameraMotion: 0 } as ReturnType<typeof defaultCommonParams> & Record<string, unknown>;
      await host.setPreset(visualizerRegistry.get(id)!, 1, params);
      await host.background.load({ ...defaultBackground('green.png', 'a'.repeat(64), 'image'), dim: 0 }, file);
      // 重ね方を「そのまま上に」(over) にして、ビジュアライザーが黒で覆うかを見る
      host.composition = { ...host.composition, visualizerBlend: 'over', visualizerOpacity: 1 };
      for (let i = 0; i < 8; i++) host.render({ t: i / 30, dt: 1 / 30, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64) }, params);
      const tmp = document.createElement('canvas');
      tmp.width = W;
      tmp.height = H;
      const g = tmp.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(canvas, 0, 0);
      out[id] = Array.from(g.getImageData(8, 8, 2, 2).data.slice(0, 3));
      host.dispose();
      canvas.remove();
    }
    return out;
  });
  // なし: 背景の緑がそのまま
  expect(r.none![1]!).toBeGreaterThan(120);
  expect(r.none![0]!).toBeLessThan(40);
  // Solar Gate: 黒い宇宙が背景を覆う (緑が見えない)
  expect(r['solar-gate']![1]!).toBeLessThan(60);
});
