import { expect, test } from '@playwright/test';

/**
 * プリセットに渡す画像 (Solar Gate のリングの中。2026-10-03 ユーザー「専用作ろう！」)。
 * - 画像が無ければリングの中は真っ暗、入れるとその色が出る、外すと真っ暗に戻る (本物の WebGL で)
 * - Visualizer タブから入れられる (ファイル選択・ドラッグ&ドロップ)
 */

test.describe.configure({ timeout: 120_000 });

test('Solar Gate: リングの中は、画像が無ければ真っ暗、入れるとその画像、外すと真っ暗 (プリセットを替えても持ち越す)', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
    const { visualizerRegistry } = await import('/src/visualizers/index.ts');
    const { defaultCommonParams } = await import('/src/core/types.ts');
    const W = 320;
    const H = 180;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    document.body.appendChild(canvas);
    const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
    host.resize(W, H);
    const params = { ...defaultCommonParams(), cameraMotion: 0 } as ReturnType<typeof defaultCommonParams> & Record<string, unknown>;
    await host.setPreset(visualizerRegistry.get('solar-gate')!, 7, params);
    const tmp = document.createElement('canvas');
    tmp.width = W;
    tmp.height = H;
    const g = tmp.getContext('2d', { willReadFrequently: true })!;
    const centre = (): number[] => {
      for (let i = 0; i < 12; i++) {
        const t = i / 30;
        host.render({ t, dt: 1 / 30, bass: 0.2, mid: 0.2, high: 0.1, rms: 0.2, peak: 0.2, beat: 0, beatIndex: -1, spectralEnergy: 0.2, flux: 0.1, bands: new Float32Array(64).fill(0.1) }, params);
      }
      g.drawImage(canvas, 0, 0);
      // リングの中心 (画面の真ん中)
      return Array.from(g.getImageData(W / 2 - 2, H / 2 - 2, 4, 4).data.slice(0, 4));
    };
    const png = async (color: string): Promise<File> => {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 100;
      const x = c.getContext('2d')!;
      x.fillStyle = color;
      x.fillRect(0, 0, 200, 100);
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
      return new File([blob], 'test.png', { type: 'image/png' });
    };
    const none = centre();
    await host.setPresetImage(await png('#ff2020'));
    const red = centre();
    await host.setPresetImage(null);
    const removed = centre();
    // 画像を入れたまま別のプリセットに替えて、また Solar Gate に戻すと、画像は持ち越される
    await host.setPresetImage(await png('#2040ff'));
    await host.setPreset(visualizerRegistry.get('milky-way')!, 7, params);
    await host.setPreset(visualizerRegistry.get('solar-gate')!, 7, params);
    const carried = centre();
    host.dispose();
    canvas.remove();
    return { none, red, removed, carried };
  });
  // 真っ暗 (どの色も小さい)
  expect(Math.max(r.none[0]!, r.none[1]!, r.none[2]!)).toBeLessThan(12);
  expect(Math.max(r.removed[0]!, r.removed[1]!, r.removed[2]!)).toBeLessThan(12);
  // 赤い画像: 赤がはっきり出て、青・緑は低い
  expect(r.red[0]!).toBeGreaterThan(80);
  expect(r.red[0]!).toBeGreaterThan(r.red[1]! * 2);
  expect(r.red[0]!).toBeGreaterThan(r.red[2]! * 2);
  // 持ち越した青い画像
  expect(r.carried[2]!).toBeGreaterThan(80);
  expect(r.carried[2]!).toBeGreaterThan(r.carried[0]! * 2);
});

test('Visualizer タブ: Solar Gate に「リングの中の画像」の欄が出て、ファイルを選ぶと名前が出て、外せる。ほかのプリセットには出ない', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'en'));
  await page.goto('/');
  await page.getByRole('tab', { name: 'Visualizer' }).click();
  const select = page.locator('section.panel select').first();
  await select.selectOption('solar-gate');
  const slot = page.locator('[data-preset-image="slot"]');
  await expect(slot).toBeVisible();
  await expect(slot).toContainText('No image yet');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator('[data-preset-image="input"]').setInputFiles({ name: 'moon.png', mimeType: 'image/png', buffer: png });
  await expect(slot).toContainText('moon.png');
  await expect(page.locator('[data-preset-image="remove"]')).toBeVisible();
  // タブを切り替えて戻っても、入れた画像は残る (store に持つ)
  await page.getByRole('tab', { name: 'Music' }).click();
  await page.getByRole('tab', { name: 'Visualizer' }).click();
  await expect(page.locator('[data-preset-image="slot"]')).toContainText('moon.png');
  await page.locator('[data-preset-image="remove"]').click();
  await expect(page.locator('[data-preset-image="slot"]')).toContainText('No image yet');
  // 画像の欄が無いプリセット
  await page.locator('section.panel select').first().selectOption('milky-way');
  await expect(page.locator('[data-preset-image="slot"]')).toHaveCount(0);
});
