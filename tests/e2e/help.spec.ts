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

test('ロゴは ZUNZUN3 (3 だけ黄色)。「使い方」のいちばん下に MIT ライセンスと、中で使っているもののライセンスが出る', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-header h1')).toHaveText('ZUNZUN3');
  const color = await page.locator('.app-header h1 .logo-3').evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe('rgb(255, 210, 63)');
  await page.getByRole('tab').last().click();
  const lic = page.locator('[data-help="license"]');
  await expect(lic).toBeVisible();
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
