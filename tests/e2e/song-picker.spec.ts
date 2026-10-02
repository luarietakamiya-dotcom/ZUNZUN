import { expect, test } from '@playwright/test';

/**
 * 曲を選ぶ欄 (2026-10-02 ユーザーの実機: iPhone のファイルアプリで、mp3 が灰色になって選べなかった)。
 * - accept に拡張子も並べている (audio/* だけでは iOS で選べないことがあった)
 * - 「すべてのファイルから選ぶ」(絞り込みの無い逃げ道) で選んでも、ふつうに読み込める
 */

test.describe.configure({ timeout: 120_000 });

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

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`曲を選ぶ欄 (${viewport.width}px): 拡張子も許していて、「すべてのファイルから選ぶ」でも読み込める`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'ja'));
    await page.goto('/');
    if (viewport.width < 760) await page.locator('.m-nav-button[data-menu="music"]').click();
    else await page.locator('button[data-panel="music"]').click();
    const input = page.locator('section.panel input[type="file"]').first();
    const accept = await input.getAttribute('accept');
    for (const ext of ['audio/*', '.mp3', '.wav', '.m4a', '.flac']) expect(accept, ext).toContain(ext);
    // 逃げ道: 絞り込みの無い欄から選ぶ
    const any = page.locator('[data-any-file="true"]').first();
    await expect(any).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await any.click();
    const fc = await chooser;
    await fc.setFiles({ name: 'song.wav', mimeType: 'application/octet-stream', buffer: testWav() });
    await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isLoaded)).toBe(true);
    expect(await page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.fileName)).toBe('song.wav');
  });
}

test('歌詞タブの「曲を読み込む」にも、拡張子の指定と逃げ道がある', async ({ page }) => {
  await page.goto('/');
  await page.locator('button[data-panel="lyrics"]').click();
  const accept = await page.locator('[data-lyrics="step-song"]').getAttribute('accept');
  expect(accept).toContain('.mp3');
  await expect(page.locator('[data-lyrics="steps"] [data-any-file="true"]')).toHaveCount(1);
});
