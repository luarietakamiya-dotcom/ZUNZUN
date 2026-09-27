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
