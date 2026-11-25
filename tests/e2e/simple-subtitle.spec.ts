import { expect, test, type Page } from '@playwright/test';

/**
 * シンプル字幕 (JIZURA を使わない字幕。2026-11-25 姫)。リリックモーションのタブで描き方を切り替えると、
 * JIZURA の設定が隠れて字幕の設定が出て、プレビューにシンプル字幕が描かれる。設定を変えると保存される。
 */

/** 2 秒の無音の WAV */
function testWav(): Buffer {
  const rate = 22050, n = rate * 2, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  return buf;
}

const lyricsNow = (page: Page) => page.evaluate(async () => (await import('/src/core/store.ts')).store.lyrics);

test('描き方を「シンプル字幕」にすると、字幕の設定が出て、プレビューに JIZURA を使わない字幕が描かれる', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('/');
  await page.locator('input[type="file"][accept^="audio/*"]').setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: testWav() });
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isLoaded)).toBe(true);
  await page.evaluate(async () => {
    const { store } = await import('/src/core/store.ts');
    const { defaultLyrics } = await import('/src/core/types.ts');
    const l = defaultLyrics();
    store.setLyrics({ ...l, text: '赤いライトが\n鼓動を撃った', timing: { ...l.timing, lineTimes: { '0': 0.2, '1': 1 }, lineEnds: { '0': 0.9, '1': 1.9 } } });
    store.audio.seek(0.5);
  });
  await page.click('button[data-panel="motion"]');
  const engine = page.locator('select[data-motion="engine"]');
  await expect(engine).toHaveValue('jizura');
  await expect(page.locator('select[data-subtitle="font"]')).toBeHidden();

  await engine.selectOption('subtitle');
  expect((await lyricsNow(page))?.engine).toBe('subtitle');
  await expect(page.locator('select[data-subtitle="font"]')).toBeVisible();
  await expect(page.locator('.lyrics-jizura')).toBeHidden();

  // プレビューの係がシンプル字幕を作り、0.5 秒 (1 行目の表示中) のコマに文字が描かれる
  await expect.poll(() => page.evaluate(async () => {
    const { previewMotionNow } = await import('/src/ui/panels/motion-apply.ts');
    const m = previewMotionNow();
    return m && 'kind' in m ? m.kind : null;
  }), { timeout: 15000 }).toBe('subtitle');
  const painted = await page.evaluate(async () => {
    const { previewMotionNow } = await import('/src/ui/panels/motion-apply.ts');
    const m = previewMotionNow()!;
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d')!;
    const count = (t: number) => { m.render(g, t); const d = g.getImageData(0, 0, 640, 360).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]! > 128) n++; return n; };
    return { during: count(0.5), before: count(0.1) };
  });
  expect(painted.during).toBeGreaterThan(100);
  expect(painted.before).toBe(0);

  // 設定を変えると保存される (位置・大きさ・書体)
  await page.locator('select[data-subtitle="position"]').selectOption('top');
  await page.locator('input[data-subtitle="size"]').fill('1.5');
  await page.locator('select[data-subtitle="font"]').selectOption('noto-serif');
  expect((await lyricsNow(page))?.subtitle).toMatchObject({ position: 'top', size: 1.5, font: 'noto-serif' });

  // 動く歌詞に戻すと、JIZURA の設定がまた出る
  await engine.selectOption('jizura');
  await expect(page.locator('.lyrics-jizura')).toBeVisible();
  await expect(page.locator('select[data-subtitle="font"]')).toBeHidden();
});
