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

test('ロゴは VisualSync (画像)。「使い方」のいちばん下に MIT ライセンスと、中で使っているもののライセンスが出る', async ({ page }) => {
  await page.goto('/');
  const logo = page.locator('.app-header h1 img.brand-logo');
  await expect(logo).toHaveAttribute('alt', 'VisualSync');
  expect(await logo.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true); // 画像が読めている
  // 右上の「ライセンス」から、どのタブにいても使い方のライセンス欄へ飛ぶ
  await page.getByRole('tab').nth(3).click();
  await page.locator('[data-shell="license"]').click();
  await expect(page.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');
  const lic = page.locator('[data-help="license"]');
  await expect(lic).toBeInViewport();
  await expect(lic.locator(':scope > pre')).toContainText('MIT License');
  await expect(lic.locator(':scope > pre')).toContainText('Copyright (c) 2026 luarietakamiya-dotcom');
  for (const name of ['JIZURA', 'three.js', 'Mediabunny']) await expect(lic).toContainText(name);
  // 中で使っているものの全文 (MIT は本文を含めるのが条件)
  const boxes = lic.locator('details.help-license-box');
  await expect(boxes).toHaveCount(3);
  for (const b of await boxes.all()) await b.evaluate((el) => ((el as HTMLDetailsElement).open = true));
  await expect(boxes.nth(0)).toContainText('Copyright (c) 2026 hakoniwa');
  await expect(boxes.nth(0)).toContainText('Permission is hereby granted');
  await expect(boxes.nth(1)).toContainText('three.js authors');
  await expect(boxes.nth(2)).toContainText('Mozilla Public License Version 2.0');
});
