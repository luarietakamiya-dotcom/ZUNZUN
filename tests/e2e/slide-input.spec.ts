import { expect, test, type Page } from '@playwright/test';

/**
 * 背景のスライドショーの画像の入れ方 (2026-10-03 ユーザー要望):
 * - 区切りごとの入れ場所 (イントロ・サビ…) へ入れた画像は、ファイル名に関係なくその区切りで使う
 * - フォルダを選ぶと、下の「イントロ」「サビ」などのフォルダ名で区切りが決まる
 * - カードのどこへ・入れ場所へドラッグ&ドロップできる
 * - 1 枚ごとに区切りを選び直せる・外せる。保存される
 */

test.describe.configure({ timeout: 120_000 });

/** 小さな 1 色の PNG (中身の違う 3 枚: 同じ画像は 1 枚にまとめられるため) */
async function pngs(page: Page): Promise<Buffer[]> {
  const urls = await page.evaluate(() =>
    ['#a33', '#3a3', '#33a', '#aa3'].map((c) => {
      const cv = document.createElement('canvas');
      cv.width = 32;
      cv.height = 18;
      const g = cv.getContext('2d')!;
      g.fillStyle = c;
      g.fillRect(0, 0, 32, 18);
      return cv.toDataURL('image/png').split(',')[1]!;
    }),
  );
  return urls.map((u) => Buffer.from(u, 'base64'));
}

const openCard = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.click('button[data-panel="overlay"]');
};
const savedKinds = (page: Page): Promise<(string | null)[]> =>
  page.evaluate(async () => {
    const { store } = await import('/src/core/store.ts');
    return (store.background?.slides?.items ?? []).map((it) => it.kind ?? null);
  });

test('入れ場所: ファイル名に関係なくその区切りで使い、足していける。区切りの変更・外すもできて、枚数が出る', async ({ page }) => {
  await openCard(page);
  const [a, b, c, d] = await pngs(page);
  // サビの入れ場所に 2 枚 (名前は「イントロ」だが、場所が優先)
  await page.locator('[data-zone-input="chorus"]').setInputFiles([
    { name: 'intro-a.png', mimeType: 'image/png', buffer: a! },
    { name: 'b.png', mimeType: 'image/png', buffer: b! },
  ]);
  const list = page.locator('[data-background="slide-list"]');
  await expect(list.locator('.slide-item')).toHaveCount(2);
  await expect(page.locator('[data-zone="chorus"] .slide-zone-count')).toHaveText('2 枚');
  expect(await savedKinds(page)).toEqual(['chorus', 'chorus']);
  await expect(list.locator('select.slide-kind-select option:checked')).toHaveText(['サビ', 'サビ']);
  // イントロの入れ場所に 1 枚足す (今のスライドショーの後ろ)
  await page.locator('[data-zone-input="intro"]').setInputFiles([{ name: 'c.png', mimeType: 'image/png', buffer: c! }]);
  await expect(list.locator('.slide-item')).toHaveCount(3);
  await expect(list.locator('.slide-name')).toHaveText(['intro-a.png', 'b.png', 'c.png']);
  await expect(page.locator('[data-zone="intro"] .slide-zone-count')).toHaveText('1 枚');
  await expect(page.locator('[data-zone="chorus"] .slide-zone-count')).toHaveText('2 枚');
  expect(await savedKinds(page)).toEqual(['chorus', 'chorus', 'intro']);
  // 同じ画像をアウトロの入れ場所へ入れ直すと、増えずに区切りだけ変わる
  await page.locator('[data-zone-input="outro"]').setInputFiles([{ name: 'copy.png', mimeType: 'image/png', buffer: a! }]);
  await expect(list.locator('.slide-item')).toHaveCount(3);
  expect(await savedKinds(page)).toEqual(['outro', 'chorus', 'intro']);
  // 1 枚ごとの選択欄で変える (サビ → 間奏)
  await list.locator('select.slide-kind-select').nth(1).selectOption('interlude');
  expect(await savedKinds(page)).toEqual(['outro', 'interlude', 'intro']);
  await expect(page.locator('[data-zone="interlude"] .slide-zone-count')).toHaveText('1 枚');
  // 外す
  await list.locator('[data-slide-remove="0"]').click();
  await expect(list.locator('.slide-item')).toHaveCount(2);
  expect(await savedKinds(page)).toEqual(['interlude', 'intro']);
  // 4 枚目の画像を足して、全部外すと背景なし
  await page.locator('[data-zone-input="verse"]').setInputFiles([{ name: 'd.png', mimeType: 'image/png', buffer: d! }]);
  await expect(list.locator('.slide-item')).toHaveCount(3);
  for (let i = 0; i < 3; i++) await page.locator('[data-slide-remove="0"]').click();
  await expect(page.locator('[data-background="slide-list"] .slide-item')).toHaveCount(0);
  expect(await page.evaluate(async () => (await import('/src/core/store.ts')).store.background)).toBeNull();
});

test('フォルダを選ぶと、下の「イントロ」「サビ」などのフォルダ名で区切りが決まる (直下は指定なし)', async ({ page }) => {
  await openCard(page);
  const [a, b, c, d] = await pngs(page);
  // ブラウザはフォルダ選択のファイルに webkitRelativePath (例: 素材/イントロ/a.png) を付ける。それをそのまま再現して選ばせる
  // (Playwright の setInputFiles にフォルダを渡すと、選んだあとにファイルが読めなくなるため。フォルダの読み取りはブラウザの仕事)
  await page.evaluate(
    ({ files }) => {
      const picked = files.map(({ path, b64 }) => {
        const f = new File([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], path.split('/').pop()!, { type: 'image/png' });
        Object.defineProperty(f, 'webkitRelativePath', { value: path });
        return f;
      });
      const input = document.querySelector('[data-background="slides-folder"]') as HTMLInputElement;
      Object.defineProperty(input, 'files', { configurable: true, value: picked });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    {
      files: [
        { path: '素材/イントロ/a.png', b64: a!.toString('base64') },
        { path: '素材/Chorus/b.png', b64: b!.toString('base64') },
        { path: '素材/c.png', b64: c!.toString('base64') },
        { path: '素材/旅行/d.png', b64: d!.toString('base64') },
      ],
    },
  );
  const list = page.locator('[data-background="slide-list"]');
  await expect(list.locator('.slide-item')).toHaveCount(4);
  // ファイル名の順 (a, b, c, d)
  await expect(list.locator('.slide-name')).toHaveText(['a.png', 'b.png', 'c.png', 'd.png']);
  expect(await savedKinds(page)).toEqual(['intro', 'chorus', null, null]);
  await expect(page.locator('[data-zone="intro"] .slide-zone-count')).toHaveText('1 枚');
  await expect(page.locator('[data-zone="chorus"] .slide-zone-count')).toHaveText('1 枚');
});

test('ドラッグ&ドロップ: 入れ場所へ落とすとその区切りに、カードへ落とすと足される。1 枚だけ落とすと 1 枚の背景', async ({ page }) => {
  await openCard(page);
  const [a, b, c] = await pngs(page);
  const drop = async (selector: string, files: { name: string; buf: Buffer }[]): Promise<void> => {
    await page.evaluate(
      async ({ selector, files }) => {
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (ch) => ch.charCodeAt(0))], f.name, { type: 'image/png' }));
        document.querySelector(selector)!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      },
      { selector, files: files.map((f) => ({ name: f.name, b64: f.buf.toString('base64') })) },
    );
  };
  // 1 枚だけをカードへ: 今までどおり 1 枚の背景 (スライドショーではない)
  await drop('[data-background="card"]', [{ name: 'one.png', buf: a! }]);
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.background?.ref)).toBe('one.png');
  expect(await page.evaluate(async () => (await import('/src/core/store.ts')).store.background?.slides ?? null)).toBeNull();
  // 入れ場所 (サビ) へ 1 枚: 今の 1 枚の背景を含めて、スライドショーになる
  await drop('[data-zone="chorus"]', [{ name: 'sabi.png', buf: b! }]);
  const list = page.locator('[data-background="slide-list"]');
  await expect(list.locator('.slide-item')).toHaveCount(2);
  expect(await savedKinds(page)).toEqual([null, 'chorus']);
  // カードへ 1 枚 (スライドショーがあるので足される。区切りは指定なし)
  await drop('[data-background="card"]', [{ name: 'more.png', buf: c! }]);
  await expect(list.locator('.slide-item')).toHaveCount(3);
  expect(await savedKinds(page)).toEqual([null, 'chorus', null]);
});

test('保存した区切りの指定は、プロジェクトを保存 → 読み込みで残る', async ({ page }) => {
  await openCard(page);
  const [a, b] = await pngs(page);
  await page.locator('[data-zone-input="outro"]').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: a! }]);
  await page.locator('[data-zone-input="intro"]').setInputFiles([{ name: 'b.png', mimeType: 'image/png', buffer: b! }]);
  await expect(page.locator('[data-background="slide-list"] .slide-item')).toHaveCount(2);
  const r = await page.evaluate(async () => {
    const { store } = await import('/src/core/store.ts');
    const { buildProjectFile } = await import('/src/core/project/serialize.ts');
    const { sanitizeProject } = await import('/src/core/project/validate.ts');
    const project = sanitizeProject(JSON.parse(JSON.stringify(buildProjectFile(store))));
    store.removeBackground();
    store.applyProject(project);
    return store.background?.slides?.items.map((it) => it.kind ?? null);
  });
  expect(r).toEqual(['outro', 'intro']);
});
