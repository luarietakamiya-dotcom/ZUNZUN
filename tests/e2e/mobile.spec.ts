import { expect, test, type Page } from '@playwright/test';

/**
 * スマホ表示 (ui/mobile-shell.ts・ui/layout.ts)。2026-10-02 ユーザー「今のはそのままに、機能をそのまま使えるスマホ用メニュー」。
 * - 狭い画面ではスマホ表示 (下のメニュー 5 つ)。どのメニュー・どのパネルでも横にはみ出さない
 * - 広い画面は今までどおりの PC 表示 (下のメニューは無い)
 * - 「PC 表示にする」/「スマホ表示」で切り替えられ、覚えている。アドレスの ?mobile / ?pc でも選べる
 * - 切り替えても、Space 1 回で再生 1 回 (古い再生欄のキーの受け付けが残らない)
 */

test.describe.configure({ timeout: 120_000 });

const PHONE = { width: 390, height: 844 };

/** 2 秒の試験用の音 (16bit モノラル WAV) */
function testWav(): Buffer {
  const rate = 22050;
  const n = rate * 2;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 110 * i) / rate) * 0.5 * 32767), 44 + i * 2);
  return buf;
}

const overflow = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test('狭い画面ではスマホ表示: 下のメニュー 5 つで全部のパネルを開けて、どれも横にはみ出さない', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'ja'));
  await page.goto('/');
  await expect(page.locator('.m-nav-button')).toHaveCount(5);
  await expect(page.locator('.app-header .tabs')).toHaveCount(0);
  const panels: Record<string, string[]> = { music: ['music'], lyrics: ['lyrics'], visual: ['visualizer', 'motion', 'overlay'], export: ['export'], more: ['settings', 'help'] };
  for (const [menu, ids] of Object.entries(panels)) {
    await page.locator(`.m-nav-button[data-menu="${menu}"]`).click();
    await expect(page.locator(`.m-nav-button[data-menu="${menu}"]`)).toHaveAttribute('aria-current', 'true');
    for (const id of ids) {
      if (ids.length > 1) await page.locator(`.m-subtab[data-panel="${id}"]`).click();
      await page.waitForTimeout(300);
      expect(await overflow(page), `${menu}/${id}`).toBeLessThanOrEqual(0);
    }
  }
  // WebGL のプレビューは、いつも 1 つだけ (パネルのプレビューと上の小さなプレビューが重ならない)
  for (const menu of ['music', 'visual', 'export', 'lyrics']) {
    await page.locator(`.m-nav-button[data-menu="${menu}"]`).click();
    await page.waitForTimeout(500);
    expect(await page.locator('canvas.visualizer-canvas').count(), menu).toBeLessThanOrEqual(1);
  }
});

test('広い画面は今までどおりの PC 表示 (下のメニューも「スマホ表示」のボタンも無い)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('tab')).toHaveCount(8);
  await expect(page.locator('.m-nav')).toHaveCount(0);
  await expect(page.locator('[data-shell="to-mobile"]')).toHaveCount(0);
});

test('「PC 表示にする」と「スマホ表示」で切り替えられ、開き直しても覚えている。同じパネルのまま移る', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'ja'));
  await page.goto('/');
  await page.locator('.m-nav-button[data-menu="export"]').click();
  await page.locator('.m-nav-button[data-menu="more"]').click();
  await page.locator('[data-shell="to-pc"]').click();
  await expect(page.getByRole('tab')).toHaveCount(8);
  await expect(page.locator('button[data-panel="settings"]')).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(8);
  await page.locator('button[data-panel="export"]').click();
  await page.locator('[data-shell="to-mobile"]').click();
  await expect(page.locator('.m-nav-button[data-menu="export"]')).toHaveAttribute('aria-current', 'true');
  await page.reload();
  await expect(page.locator('.m-nav-button')).toHaveCount(5);
});

test('アドレスの ?mobile で広い画面でもスマホ表示、?pc で狭い画面でも PC 表示', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?mobile');
  await expect(page.locator('.m-nav-button')).toHaveCount(5);
  await page.setViewportSize(PHONE);
  await page.goto('/?pc');
  await expect(page.getByRole('tab')).toHaveCount(8);
});

test('表示を行き来しても、Space 1 回で再生が 1 回だけ切り替わる', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'ja'));
  await page.goto('/');
  await page.locator('input[type="file"][accept^="audio/*"]').first().setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: testWav() });
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isLoaded)).toBe(true);
  // スマホ → PC → スマホ → PC
  await page.locator('.m-nav-button[data-menu="more"]').click();
  await page.locator('[data-shell="to-pc"]').click();
  await page.locator('[data-shell="to-mobile"]').click();
  await page.locator('.m-nav-button[data-menu="more"]').click();
  await page.locator('[data-shell="to-pc"]').click();
  await page.locator('button[data-panel="music"]').click();
  await page.locator('h2').first().click();
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  expect(await page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isPlaying)).toBe(true);
});

test('スマホ表示のヘッダー: どの幅 (320〜430px) でも、ロゴが再生ボタンに重ならず、1 行 (高さ 53px) で、横にはみ出さない', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'ja'));
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/?mobile');
    await expect(page.locator('.m-header')).toBeVisible();
    const r = await page.evaluate(() => {
      const logo = document.querySelector('.m-header h1')!.getBoundingClientRect();
      const play = document.querySelector('.transport-play')!.getBoundingClientRect();
      return { overlap: logo.right > play.left + 0.5, headerH: Math.round(document.querySelector('.m-header')!.getBoundingClientRect().height), over: document.documentElement.scrollWidth - innerWidth };
    });
    expect(r, `${width}px`).toEqual({ overlap: false, headerH: 53, over: 0 });
  }
});

test('スマホ表示のヘッダー (再生中): 再生ボタンが ❚❚ に変わっても幅は同じで、ロゴに重ならず、横にはみ出さない', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'ja'));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/?mobile');
  await page.locator('section.panel input[type="file"]').first().setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: testWav() });
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isLoaded)).toBe(true);
  const measure = (): Promise<{ w: number; overlap: boolean; over: number; text: string }> =>
    page.evaluate(() => {
      const logo = document.querySelector('.m-header h1')!.getBoundingClientRect();
      const play = document.querySelector('.transport-play')!;
      const pr = play.getBoundingClientRect();
      return { w: Math.round(pr.width), overlap: logo.right > pr.left + 0.5, over: document.documentElement.scrollWidth - innerWidth, text: play.textContent ?? '' };
    });
  const stopped = await measure();
  await page.locator('.transport-play').click();
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isPlaying)).toBe(true);
  await expect(page.locator('.transport-play')).toHaveText('❚❚');
  const playing = await measure();
  expect(playing.w).toBe(stopped.w);
  expect(playing.overlap).toBe(false);
  expect(playing.over).toBe(0);
  // スマホ表示では、時刻は今の位置だけ (長さは隠す)
  await expect(page.locator('.transport-total')).toBeHidden();
});

test('スマホ表示の「すべてのファイルから選ぶ」は、画面の幅いっぱいの押しやすいボタン', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'ja'));
  await page.goto('/');
  const box = await page.locator('[data-any-file="true"]').first().boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(36);
  expect(box!.width).toBeGreaterThan(PHONE.width * 0.7);
});

test('スマホ表示の歌詞のタップ: 「ここで叩く」は幅いっぱいの大きなボタンで下のメニューの上に固定。触れた瞬間に 1 行だけ記録される (二重に記録しない)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'ja'));
  await page.goto('/');
  await page.locator('.m-nav-button[data-menu="lyrics"]').click();
  await page.locator('[data-lyrics="step-song"]').setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: testWav() });
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isLoaded)).toBe(true);
  await page.locator('textarea').first().fill('[Intro]\nはじまりの歌\nつぎの歌\nさいごの歌');
  // タッチ操作の端末では、Space キーの名前を出さない (説明もボタンの文も)
  await expect(page.locator('.lyrics-tap-controls .lyrics-tap-button')).toHaveText('ここで叩く');
  await expect(page.locator('[data-lyrics="steps"]')).not.toContainText('Space');
  await expect(page.locator('.lyrics-tap-controls')).not.toContainText(/Space|Backspace|Esc/);
  const start = page.locator('[data-lyrics="step-tap"]');
  await expect(start).toBeEnabled();
  await start.click();
  const tapBtn = page.locator('.lyrics-tap-controls .lyrics-tap-button');
  await expect(tapBtn).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isPlaying)).toBe(true);
  // 大きさと位置: 幅の大半・高さ 80px 以上・下のメニュー (.m-nav) の上
  const box = (await tapBtn.boundingBox())!;
  const nav = (await page.locator('.m-nav').boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(80);
  expect(box.width).toBeGreaterThan(PHONE.width * 0.85);
  expect(box.y + box.height).toBeLessThanOrEqual(nav.y);
  // 叩く: 触れて離す 1 回で、記録されるのは 1 行だけ (pointerdown と click の二重にならない)
  const lines = (): Promise<number> => page.evaluate(async () => Object.keys((await import('/src/core/store.ts')).store.lyrics?.timing.lineTimes ?? {}).length);
  const before = await lines();
  await tapBtn.tap();
  await page.waitForTimeout(300);
  expect(await lines()).toBe(before + 1);
  await context.close();
});

test('PC の歌詞のタップ: マウスで 1 回押すと 1 行だけ記録される。ボタンには Space の名前が出る', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'ja'));
  await page.goto('/');
  await page.locator('button[data-panel="lyrics"]').click();
  await page.locator('[data-lyrics="step-song"]').setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: testWav() });
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isLoaded)).toBe(true);
  await page.locator('textarea').first().fill('はじまりの歌\nつぎの歌\nさいごの歌');
  await page.locator('[data-lyrics="step-tap"]').click();
  const tapBtn = page.locator('.lyrics-tap-controls .lyrics-tap-button');
  await expect(tapBtn).toBeVisible();
  await expect(tapBtn).toContainText('Space');
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isPlaying)).toBe(true);
  const lines = (): Promise<number> => page.evaluate(async () => Object.keys((await import('/src/core/store.ts')).store.lyrics?.timing.lineTimes ?? {}).length);
  const before = await lines();
  await tapBtn.click();
  await page.waitForTimeout(300);
  expect(await lines()).toBe(before + 1);
});
