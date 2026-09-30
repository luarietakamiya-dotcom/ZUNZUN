import { expect, test, type Page } from '@playwright/test';

/**
 * 用意された背景 (core/library.ts) の E2E。
 * - 「背景と素材」タブのサムネイルを押すと背景になり、プレビューに映る
 * - その背景を使うプロジェクトを開くと、ファイルを選び直さなくても自動で読み込まれる
 */

test.describe.configure({ timeout: 120_000 });

/** 背景の欄 (ほかの欄も .background-card を使うので、用意された背景の列がある欄) */
const bgCard = (page: Page) => page.locator('.background-card').filter({ has: page.locator('.library-row') });

/** プレビューの平均の色 (背景の有無で大きく変わる) */
async function previewMean(page: Page): Promise<number[]> {
  await page.getByRole('tab', { name: 'Visualizer' }).click();
  await page.waitForTimeout(1500);
  const shot = await page.locator('.visualizer-canvas').screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const s = [0, 0, 0];
    for (let k = 0; k < d.length; k += 4) for (let j = 0; j < 3; j++) s[j] += d[k + j]!;
    return s.map((v) => v / (d.length / 4));
  }, shot.toString('base64'));
}

test('用意された背景: サムネイルを押すと背景になり、プレビューの絵が変わる', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'en'));
  await page.goto('/');
  const before = await previewMean(page);
  await page.getByRole('tab', { name: 'Overlay' }).click();
  await expect(page.locator('.library-thumb')).toHaveCount(3);
  await page.locator('.library-thumb[data-library="speaker-rack"]').click();
  await expect(bgCard(page)).toContainText('"Speakers and gear rack"');
  await expect(page.locator('.library-thumb[data-library="speaker-rack"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.library-thumb[data-library="stage-lights"]')).toHaveAttribute('aria-pressed', 'false');
  const after = await previewMean(page);
  const diff = after.reduce((s, v, i) => s + Math.abs(v - before[i]!), 0);
  expect(diff, `before ${before} after ${after}`).toBeGreaterThan(10);
});

test('用意された背景を使うプロジェクトを開くと、選び直さなくても背景が読み込まれる', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'en'));
  await page.goto('/');
  const json = await page.evaluate(async () => {
    const { defaultProject, defaultBackground } = await import('/src/core/types.ts');
    const { LIBRARY, libraryRef } = await import('/src/core/library.ts');
    const item = LIBRARY.find((it) => it.id === 'stage-lights')!;
    return JSON.stringify({ ...defaultProject(), background: { ...defaultBackground(libraryRef(item), item.sha256, 'image'), dim: 0.2 } });
  });
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({ name: 'p.zunzun.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByRole('tab', { name: 'Overlay' }).click();
  await expect(bgCard(page)).toContainText('"Live stage (lights and haze)"');
  await expect(bgCard(page)).not.toContainText('pick the same file again');
  await expect(bgCard(page).locator('.background-thumb')).toBeVisible();
  await expect(page.locator('.library-thumb[data-library="stage-lights"]')).toHaveAttribute('aria-pressed', 'true');
});
