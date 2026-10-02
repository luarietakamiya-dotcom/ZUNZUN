import { expect, test } from '@playwright/test';

/** 「使い方」タブ: 書き出しの右にあり、かんたんな使い方 5 つの手順と、くわしい使い方が出る。画像がすべて読める */
test('「使い方」タブ: 5 つの手順とくわしい使い方が出て、画像がすべて読める', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('tab');
  await expect(tabs.last()).toHaveText(/Help|使い方/);
  await tabs.last().click();
  await expect(page.locator('[data-help="quick"] .help-block')).toHaveCount(5);
  expect(await page.locator('[data-help="details"] details').count()).toBeGreaterThanOrEqual(8);
  // 閉じている項目も開いて、画像を全部読み込ませる
  for (const d of await page.locator('[data-help="details"] details').all()) await d.evaluate((el) => ((el as HTMLDetailsElement).open = true));
  const imgs = page.locator('img.help-image');
  expect(await imgs.count()).toBe(11);
  for (const img of await imgs.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
  }
});
