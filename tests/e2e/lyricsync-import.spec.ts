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

/** 2 秒の無音の WAV（「自動で合わせる」は読み込んだ曲を送るので、曲が要る） */
function testWav(): Buffer {
  const rate = 22050, n = rate * 2, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  return buf;
}
const syncMessage = async (page: Page) => (await page.locator('p.lyrics-help').allTextContents()).find((t) => /LyricSync|時刻を入れました|うまくいきませんでした/.test(t) && !/入れた人向け/.test(t)) ?? '';

test('「LyricSync で自動で合わせる」: 曲と歌詞（改行つき）を 127.0.0.1 に送り、終わるまで待って取り込む', async ({ page }) => {
  // まねの LyricSync: /health → /jobs（番号）→ /jobs/j1（計算中 → 終わった）
  let posted = '', polls = 0;
  await page.route('http://127.0.0.1:8765/**', async (route) => {
    const req = route.request(), url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (url.pathname === '/health') return route.fulfill({ headers: cors, body: JSON.stringify({ ok: true, gpu: 'RTX', model_loaded: false }) });
    if (url.pathname === '/jobs' && req.method() === 'POST') { posted = req.postDataBuffer()?.toString('utf8') ?? ''; return route.fulfill({ headers: cors, body: JSON.stringify({ id: 'j1', status: 'queued' }) }); }
    if (url.pathname === '/jobs/j1') {
      polls++;
      return route.fulfill({ headers: cors, body: JSON.stringify(polls < 2 ? { status: 'running', progress: 0.3 } : { status: 'done', result: RESULT }) });
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('/');
  await page.locator('input[type="file"][accept^="audio/*"]').setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: testWav() });
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isLoaded)).toBe(true);
  await page.locator('button', { hasText: /^歌詞$/ }).first().click();
  await page.fill('textarea.lyrics-textarea', LYRICS);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'LyricSync で自動で合わせる' }).click();
  await expect.poll(() => syncMessage(page), { timeout: 15000 }).toContain('4 行に時刻を入れました');
  expect(await timing(page)).toEqual({ '0': 1, '1': 3.5, '2': 6, '3': 9 });
  expect(posted).toMatch(/赤いライトが\r?\n鼓動を撃った/);
  expect(posted).toContain('name="audio"; filename="song.wav"');
  expect(polls).toBe(2);
});

test('「LyricSync で自動で合わせる」: LyricSync が起動していなければ、起動の仕方を案内する', async ({ page }) => {
  await page.route('http://127.0.0.1:8765/**', (route) => route.abort('connectionrefused'));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('/');
  await page.locator('input[type="file"][accept^="audio/*"]').setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: testWav() });
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isLoaded)).toBe(true);
  await page.locator('button', { hasText: /^歌詞$/ }).first().click();
  await page.fill('textarea.lyrics-textarea', LYRICS);
  await page.getByRole('button', { name: 'LyricSync で自動で合わせる' }).click();
  await expect.poll(() => syncMessage(page)).toContain('lyricsync.exe serve');
  await expect(page.getByRole('button', { name: 'LyricSync で自動で合わせる' })).toBeEnabled();
});
