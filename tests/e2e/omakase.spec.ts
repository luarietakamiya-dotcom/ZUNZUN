import { expect, test, type Page } from '@playwright/test';

/**
 * 「おまかせで作る」 (音楽タブ。2026-10-04 UI 刷新の段階 5): 曲の分析から、映像の種類と歌詞のスタイルを 1 クリックで選ぶ。
 * 曲が無いと押せない。同じ曲なら同じ結果。「別のおまかせ」で順に変わる。歌詞があるときだけ歌詞のスタイルも選ぶ。「映像を見る」でビジュアライザーを開く。
 */

test.describe.configure({ timeout: 90_000 });

/** 6 秒の短い曲 (220Hz の音を、ゆるく脈打たせたもの) */
function toneWav(): Buffer {
  const sr = 22050;
  const n = sr * 6;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round((Math.sin((i / sr) * 2 * Math.PI * 220) * 8000 * (1 + Math.sin((i / sr) * 8))) / 2), 44 + i * 2);
  return buf;
}

async function loadSong(page: Page): Promise<void> {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav() });
  await expect(page.locator('[data-omakase="go"]')).toBeEnabled({ timeout: 30_000 });
}

const presetOf = (page: Page): Promise<string> => page.evaluate(async () => (await import('/src/core/store.ts')).store.presetId ?? '');
const styleOf = (page: Page): Promise<string | null> => page.evaluate(async () => (await import('/src/core/store.ts')).store.lyrics?.motion.style ?? null);

test('曲が無いと押せない。曲を読み込むと押せて、映像の種類が選ばれ、結果が出る。同じ曲なら同じ結果', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-omakase="go"]')).toBeDisabled();
  await expect(page.locator('[data-omakase="result"]')).toBeHidden();
  await loadSong(page);
  await page.locator('[data-omakase="go"]').click();
  await expect(page.locator('[data-omakase="result"]')).toBeVisible();
  await expect(page.locator('[data-omakase="result"]')).toContainText('映像:');
  await expect(page.locator('[data-omakase="result"]')).toContainText('BPM');
  const first = await presetOf(page);
  expect(first).not.toBe('none');
  expect(first).not.toBe('');
  // 歌詞が無いので、歌詞のスタイルは選ばない (歌詞の設定も勝手に作らない)
  await expect(page.locator('[data-omakase="result"]')).toContainText('歌詞を入れると');
  expect(await styleOf(page)).toBeNull();
  // もう一度押しても、同じ曲なら同じ (別のおまかせを押した続きから)
  await page.locator('[data-omakase="go"]').click();
  expect(await presetOf(page)).toBe(first);
});

test('「別のおまかせ」で順に変わり、歌詞があるときは歌詞のスタイルも選ぶ。映像を見るでビジュアライザーが開く', async ({ page }) => {
  await page.goto('/');
  await loadSong(page);
  // 歌詞を入れておく
  await page.evaluate(async () => {
    const { store } = await import('/src/core/store.ts');
    const { defaultLyrics } = await import('/src/core/types.ts');
    store.setLyrics({ ...defaultLyrics(), text: 'はじまりの歌\nつづきの歌' });
  });
  await page.locator('[data-omakase="go"]').click();
  const seen = new Set<string>([await presetOf(page)]);
  const style0 = await styleOf(page);
  expect(style0).toMatch(/^zz-/);
  await expect(page.locator('[data-omakase="result"]')).toContainText('歌詞のスタイル:');
  for (let i = 0; i < 5; i++) {
    await page.locator('[data-omakase="next"]').click();
    seen.add(await presetOf(page));
  }
  expect(seen.size).toBe(6); // 6 つの候補が、順に出る
  await page.locator('[data-omakase="next"]').click(); // 一周して最初に戻る
  expect(await presetOf(page)).toBe([...seen][0]);
  expect(await styleOf(page)).toBe(style0);
  // 映像を見る: ビジュアライザーのタブが開き、選ばれた種類のカードが光っている
  await page.locator('[data-omakase="view"]').click();
  await expect(page.locator('.preset-picker')).toBeVisible();
  await expect(page.locator(`.preset-card[data-preset="${[...seen][0]}"]`)).toHaveAttribute('aria-pressed', 'true');
});
