import { expect, test } from '@playwright/test';

// このファイルの試験は英語表示で行う (タブ名などを英語で探す)。日本語表示は最後の試験で確かめる
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('zz-lang-set')) {
      localStorage.setItem('zunzun.lang', 'en');
      sessionStorage.setItem('zz-lang-set', '1');
    }
  });
});

test('shows all 8 tabs (including Lyric motion and Help) and switches panels', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('ZUNZUN3');

  const tabLabels = ['Music', 'Lyrics', 'Lyric motion', 'Visualizer', 'Overlay', 'Save', 'Export', 'Help'];
  for (const label of tabLabels) {
    await expect(page.getByRole('tab', { name: label })).toBeVisible();
  }
  // 並び: 作る順 (曲 → 歌詞 → 映像 → 背景 → 保存 → 書き出し) と使い方
  await expect(page.getByRole('tab')).toHaveText(tabLabels);

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
  await expect(page.locator('.transport-name')).toHaveText('No song yet (load one in the Music tab)');
  await page.getByRole('tab', { name: 'Overlay' }).click();
  await expect(page.locator('.app-header .transport')).toBeVisible();
});

test('Visualizer タブの見え方 (View): 拡大を変えると表示が変わり、Reset View で元に戻る', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Visualizer' }).click();
  const zoom = page.locator('input[data-view="zoom"]');
  await expect(zoom).toHaveValue('1');
  await zoom.fill('2');
  await expect(page.getByText('Zoom: 2.00×')).toBeVisible();
  await page.locator('input[data-view="roll"]').fill('-30');
  await expect(page.getByText('Roll: -30°')).toBeVisible();
  // タブを切り替えても設定は残る (store に保存している)
  await page.getByRole('tab', { name: 'Music' }).click();
  await page.getByRole('tab', { name: 'Visualizer' }).click();
  await expect(page.locator('input[data-view="zoom"]')).toHaveValue('2');
  await page.getByRole('button', { name: 'Reset View' }).click();
  await expect(page.getByText('Zoom: 1.00×')).toBeVisible();
  await expect(page.getByText('Roll: 0°')).toBeVisible();
});

test('表記の言語: 日本語に切り替えるとタブ名・設定の名前が日本語になり、説明も出る。英語に戻せて、開き直しても覚えている', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Visualizer' })).toBeVisible();
  await page.locator('button[data-lang="ja"]').click();
  await expect(page.getByRole('tab', { name: 'ビジュアライザー' })).toBeVisible();
  await page.getByRole('tab', { name: 'ビジュアライザー' }).click();
  await expect(page.getByText(/^光のにじみ: /)).toBeVisible();
  await expect(page.getByText('明るい部分のまわりが、ふんわり光って見える量')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  // 開き直しても日本語のまま (このブラウザに覚えている)
  await page.reload();
  await expect(page.getByRole('tab', { name: '音楽' })).toBeVisible();
  await page.locator('button[data-lang="en"]').click();
  await expect(page.getByRole('tab', { name: 'Music' })).toBeVisible();
  await page.getByRole('tab', { name: 'Visualizer' }).click();
  await expect(page.getByText(/^Bloom: /)).toBeVisible();
});

test('このビジュアライザーの設定: Live Stage のカメラの場所を選ぶと残り、ほかのビジュアライザーには出ない', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Visualizer' }).click();
  await page.locator('.visualizer-panel select, section.panel > select').first().selectOption('live-stage');
  const spot = page.locator('select[data-preset-param="cameraSpot"]');
  await expect(spot).toHaveValue('back');
  await spot.selectOption('front');
  await page.locator('section.panel > select').first().selectOption('solar-gate');
  await expect(page.locator('select[data-preset-param="cameraSpot"]')).toHaveCount(0);
  await page.locator('section.panel > select').first().selectOption('live-stage');
  await expect(page.locator('select[data-preset-param="cameraSpot"]')).toHaveValue('front');
  await expect(page.locator('input[data-preset-param="cameraHeight"]')).toHaveValue('0');
});
