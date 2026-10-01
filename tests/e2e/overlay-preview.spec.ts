import { expect, test, type Page } from '@playwright/test';

/**
 * 「背景と素材」タブのプレビュー (2026-10-01 「グリーンバックの素材をプレビューを見ながら調整したい」):
 * 設定の欄を下へ動かしてもプレビューは見えたまま。グリーンバックの素材を置くとプレビューに出て、「自動で合わせる」で緑が透ける
 */

test.describe.configure({ timeout: 120_000 });

/** プレビューの画面を撮って、真ん中から少し外れた所 (素材の緑の地のあたり) の色を読む */
async function previewPixel(page: Page, fx: number, fy: number): Promise<number[]> {
  const shot = await page.locator('[data-overlay="preview"] canvas').screenshot();
  return page.evaluate(
    async ({ b64, fx, fy }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(Math.round(img.width * fx), Math.round(img.height * fy), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!];
    },
    { b64: shot.toString('base64'), fx, fy },
  );
}

test('背景と素材のプレビュー: 下へ動かしても見えたまま。グリーンバックの素材が映り、「自動で合わせる」で緑が透ける', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.click('button[data-panel="overlay"]');
  const preview = page.locator('[data-overlay="preview"]');
  await expect(preview.locator('canvas')).toBeVisible();
  // 緑の地に黄色い丸の素材
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const g = c.getContext('2d')!;
    g.fillStyle = '#00d040';
    g.fillRect(0, 0, 320, 180);
    g.fillStyle = '#ffcc33';
    g.beginPath();
    g.arc(160, 90, 50, 0, 7);
    g.fill();
    return c.toDataURL('image/png').split(',')[1]!;
  });
  await page.locator('.media-card input[type="file"]').first().setInputFiles({ name: 'gs.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  // 素材の緑の地 (丸の外、素材の中) がプレビューに出る
  await expect.poll(async () => { const [r, g, b] = await previewPixel(page, 0.36, 0.5); return g > 150 && r < 80 && b < 120; }, { timeout: 20_000 }).toBe(true);
  // 下の「自動で合わせる」まで動かしても、プレビューは画面の中
  const auto = page.locator('[data-media="chroma-auto"]').first();
  await auto.scrollIntoViewIfNeeded();
  await expect(preview).toBeInViewport();
  await auto.click();
  // 緑が透けて、ビジュアライザーの暗い絵になる
  await expect.poll(async () => { const [r, g, b] = await previewPixel(page, 0.36, 0.5); return g < 120 || g < r + b; }, { timeout: 20_000 }).toBe(true);
});
