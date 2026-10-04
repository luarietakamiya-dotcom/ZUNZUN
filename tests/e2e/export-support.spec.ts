import { expect, test } from '@playwright/test';

/**
 * 書き出しに必要な機能 (WebCodecs) が無いブラウザ (公開前の整備, 2026-10-04): 書き出しの画面に案内が出て、開始ボタンが押せない。
 * あるブラウザでは案内は出ない (曲が無い案内だけ)。
 */

test('WebCodecs が無いと、書き出しの画面に案内が出て、開始ボタンが押せない', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).VideoEncoder;
    delete (window as unknown as Record<string, unknown>).AudioEncoder;
  });
  await page.goto('/');
  await page.click('button[data-panel="export"]');
  await expect(page.getByText('このブラウザでは MP4 を書き出せません')).toBeVisible();
  await expect(page.getByText('最新の Chrome / Edge')).toBeVisible();
  await expect(page.getByRole('button', { name: '書き出しを始める' })).toBeDisabled();
});

test('WebCodecs があれば、非対応の案内は出ない', async ({ page }) => {
  await page.goto('/');
  await page.click('button[data-panel="export"]');
  await expect(page.getByText('このブラウザでは MP4 を書き出せません')).toHaveCount(0);
});
