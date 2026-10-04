import { expect, test } from '@playwright/test';

/**
 * ビジュアライザーを選ぶカード (2026-10-04 UI を正式版に合わせる。段階 4):
 * 種類ごとのカード (サムネイルつき)。押すと選ばれ、一覧がたたまれる。タブを切り替えても状態を保つ。選択欄とつながっている。
 */

test('カードで種類を選ぶ: サムネイルが出て、押すと選ばれて一覧がたたまれ、タブを切り替えても保たれる。選択欄とつながっている', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab').nth(3).click(); // ビジュアライザー
  const picker = page.locator('details.preset-picker');
  await expect(picker).toHaveAttribute('open', ''); // 最初は一覧が開いている
  const cards = page.locator('.preset-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(15);
  await expect(page.locator('.preset-card[data-preset^="_"]')).toHaveCount(0); // 開発用は出さない
  // 「なし」以外は、サムネイルの画像が読めている
  const loaded = await page.locator('.preset-card:not([data-preset="none"]) img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).complete));
  expect(loaded.length).toBeGreaterThanOrEqual(14);
  // 既定は「なし」が選ばれている
  await expect(page.locator('.preset-card[data-preset="none"]')).toHaveAttribute('aria-pressed', 'true');
  const select = page.locator('section.panel select').first();
  await expect(select).toHaveValue('none');
  // 押すと選ばれ、選択欄も変わり、一覧がたたまれる
  await page.locator('.preset-card[data-preset="kaleidoscope"]').click();
  await expect(select).toHaveValue('kaleidoscope');
  await expect(picker).not.toHaveAttribute('open', '');
  await expect(page.locator('.preset-picker-name')).toContainText('Kaleidoscope');
  await expect(page.locator('select[data-preset-param="segments"], input[data-preset-param="segments"]')).toHaveCount(1); // この種類の設定が出る
  // タブを切り替えて戻っても、たたんだまま・選んだまま
  await page.getByRole('tab').nth(0).click();
  await page.getByRole('tab').nth(3).click();
  await expect(page.locator('details.preset-picker')).not.toHaveAttribute('open', '');
  await expect(page.locator('.preset-picker-name')).toContainText('Kaleidoscope');
  // 見出しを押すと開く。開くと、選んでいるカードが光る (aria-pressed)
  await page.locator('.preset-picker-summary').click();
  await expect(page.locator('details.preset-picker')).toHaveAttribute('open', '');
  await expect(page.locator('.preset-card[data-preset="kaleidoscope"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.preset-card[data-preset="none"]')).toHaveAttribute('aria-pressed', 'false');
  // 選択欄で変えても、カードの表示が合う
  await page.locator('section.panel select').first().selectOption('ripples');
  await expect(page.locator('.preset-card[data-preset="ripples"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.preset-picker-name')).toContainText('Ripples');
});
