import { expect, test, type Page } from '@playwright/test';

/**
 * LyricSync の結果の読み込み（docs/LYRICSYNC_INTEGRATION_PLAN.md 段階 1、Codex レビュー 2026-10-14 の修正）。
 * 取り込み → 確認モード → 取り消しで戻る / 行の数が違う結果は断る / 読み込みの途中で歌詞が変わったら取り込まない。
 */
const LYRICS = '赤いライトが\n鼓動を撃った\n退屈なんて\n噛み切って笑え';
const RESULT = { files: { zunzun: { lineTimes: { '0': 1, '1': 3.5, '2': 6, '3': 9 }, lineEnds: { '0': 3.2 } } }, data: { review: [2], lines: LYRICS.split('\n') } };
const file = (name: string, json: unknown) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
const timing = (page: Page) => page.evaluate(async () => (await import('/src/core/store.ts')).store.lyrics?.timing.lineTimes ?? null);
const message = async (page: Page) => (await page.locator('p.lyrics-help').allTextContents()).find((t) => /時刻を入れました|読み込めませんでした|取り込みませんでした/.test(t)) ?? '';

async function open(page: Page) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('/');
  await page.locator('button', { hasText: /^歌詞$/ }).first().click();
  await page.fill('textarea.lyrics-textarea', LYRICS);
  await page.waitForTimeout(300);
  return page.locator('xpath=//button[contains(text(),"LyricSync の結果を読み込む")]/following-sibling::input[@type="file"]');
}

test('取り込むと各行に時刻が入り、要確認の数と「未確認でない」ことが出る。取り消しで前に戻る', async ({ page }) => {
  const input = await open(page);
  const before = await timing(page);
  await input.setInputFiles(file('result.json', RESULT));
  await expect.poll(() => message(page)).toContain('4 行に時刻を入れました');
  expect(await message(page)).toContain('自信の低い 1 行');
  expect(await message(page)).not.toContain('未確認');
  expect(await timing(page)).toEqual({ '0': 1, '1': 3.5, '2': 6, '3': 9 });
  // 確認モードでは取り消しのボタンが隠れるので Ctrl+Z（入力欄の外で）
  await page.locator('canvas').last().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');
  await expect.poll(() => timing(page)).toEqual(before);
});

test('本文の無い結果は「歌詞の一致は未確認」と出す。行の数が多い結果は断る', async ({ page }) => {
  const input = await open(page);
  await input.setInputFiles(file('a.json', { lineTimes: { '0': 1 } }));
  await expect.poll(() => message(page)).toContain('未確認');
  await input.setInputFiles(file('b.json', { lineTimes: { '0': 1, '9': 3 } }));
  await expect.poll(() => message(page)).toContain('歌詞の行の数が違います');
});

test('読み込みの途中で歌詞を書き換えたら、取り込まない（古い結果で上書きしない）', async ({ page }) => {
  // ファイルを読むのを 800ms 遅らせて、その間に歌詞を書き換える
  await page.addInitScript(() => {
    const orig = Blob.prototype.text;
    Blob.prototype.text = function (this: Blob) { return new Promise((r) => setTimeout(() => r(orig.call(this)), 800)); };
  });
  const input = await open(page);
  const before = await timing(page);
  await input.setInputFiles(file('result.json', RESULT));
  await page.fill('textarea.lyrics-textarea', LYRICS + '\n書き足した行');
  await expect.poll(() => message(page), { timeout: 5000 }).toContain('取り込みませんでした');
  expect(await timing(page)).toEqual(before);
});
