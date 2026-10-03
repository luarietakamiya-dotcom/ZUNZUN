import { expect, test } from '@playwright/test';

/**
 * 縦長・正方形でも作れる (2026-10-03 ユーザー「16:9 以外にも、縦長などで作れるようにして」):
 * 「書き出し」の画面の大きさを選ぶと、プレビューの枠の縦横比が同じになる。
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
  await page.click('button[data-panel="export"]');
  await page.locator('select', { has: page.locator('option[value="1080x1920"]') }).selectOption('1080x1920');
  await page.click('button[data-panel="visualizer"]');
  await expect.poll(ratio).toBeCloseTo(9 / 16, 1);
  const box = await page.locator('.visualizer-canvas-wrap').first().boundingBox();
  expect(box!.height).toBeLessThanOrEqual(900); // 縦長でも画面からはみ出さない
  await page.click('button[data-panel="export"]');
  await page.locator('select', { has: page.locator('option[value="1080x1080"]') }).selectOption('1080x1080');
  await page.click('button[data-panel="visualizer"]');
  await expect.poll(ratio).toBeCloseTo(1, 1);
});
