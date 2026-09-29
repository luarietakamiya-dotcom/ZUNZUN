import { expect, test } from '@playwright/test';

test('shows all 6 tabs and switches panels', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('ZUNZUN');

  const tabLabels = ['Music', 'Visualizer', 'Lyrics', 'Overlay', 'Settings', 'Export'];
  for (const label of tabLabels) {
    await expect(page.getByRole('tab', { name: label })).toBeVisible();
  }

  // Music が既定でアクティブ
  await expect(page.getByRole('tab', { name: 'Music' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.panel h2')).toHaveText('Music');

  await page.getByRole('tab', { name: 'Export' }).click();
  await expect(page.getByRole('tab', { name: 'Export' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.panel h2')).toHaveText('Export');
});

test('ヘッダーに共通の再生欄があり、音源が無い間は押せない (どのタブでも同じもの)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-header .transport')).toBeVisible();
  await expect(page.locator('.transport-play')).toBeDisabled();
  await expect(page.locator('.transport-name')).toHaveText('音源なし (Music タブで読み込む)');
  await page.getByRole('tab', { name: 'Overlay' }).click();
  await expect(page.locator('.app-header .transport')).toBeVisible();
});
