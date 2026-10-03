import { expect, test } from '@playwright/test';

/**
 * 縦長・正方形でも作れる (2026-10-03 ユーザー「16:9 以外にも、縦長などで作れるようにして」):
 * 上のメニューの「画面の大きさ」を選ぶと、プレビューの枠の縦横比が同じになる。書き出しの画面には今の大きさが出る。
 */

test.describe.configure({ timeout: 120_000 });

test('プレビューの縦横比が、書き出しの画面の大きさに合わせて変わる', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const ratio = async (): Promise<number> => {
    const box = await page.locator('.visualizer-canvas-wrap').first().boundingBox();
    return box!.width / box!.height;
  };
  await page.click('button[data-panel="visualizer"]');
  await expect.poll(ratio).toBeCloseTo(16 / 9, 1);
  // 上のメニューのプルダウンで選ぶ (今の大きさが常に見える)
  const size = page.locator('select[data-shell="size"]');
  await expect(size).toHaveValue('1920x1080');
  await size.selectOption('1080x1920');
  await expect.poll(ratio).toBeCloseTo(9 / 16, 1);
  const box = await page.locator('.visualizer-canvas-wrap').first().boundingBox();
  expect(box!.height).toBeLessThanOrEqual(900); // 縦長でも画面からはみ出さない
  await size.selectOption('1080x1080');
  await expect.poll(ratio).toBeCloseTo(1, 1);
  // 書き出しの画面には今の大きさが出る (選ぶ欄は無い)
  await page.click('button[data-panel="export"]');
  await expect(page.locator('[data-export="size-text"]')).toContainText('1080×1080');
  await expect(page.locator('select', { has: page.locator('option[value="1080x1920"]') })).toHaveCount(1); // ヘッダーのものだけ
  // 2:3 を選ぶと、書き出しの表示も追従する
  await size.selectOption('1080x1620');
  await expect(page.locator('[data-export="size-text"]')).toContainText('2:3');
});
