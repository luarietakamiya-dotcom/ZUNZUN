import { expect, test } from '@playwright/test';

/**
 * 歌詞の時刻だけを変えたときは、歌詞の動きを自動で作り直さず、「反映」ボタンで作り直す
 * (自動で作り直すと、タイムラインで少し動かすたびに画面が止まっていた。2026-10-01)。
 * あわせて、[ ] で囲んだ行 (見出し) が歌詞の行にならないことも見る。
 */

test.describe.configure({ timeout: 240_000 });

/** 6 秒の試験用の音 (0.5 秒ごとに短い音)。16bit モノラル WAV */
function testWav(): Buffer {
  const rate = 22050;
  const n = rate * 6;
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
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const p = t % 0.5;
    const v = p < 0.15 ? Math.sin(2 * Math.PI * 220 * t) * Math.exp(-p * 20) * 0.6 : 0;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

test('歌詞の時刻だけを変えると「反映」ボタンが出て、押すまで歌詞の動きは作り直さない', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept="audio/*"]').setInputFiles({
    name: 'test.wav',
    mimeType: 'audio/wav',
    buffer: testWav(),
  });
  await page.waitForFunction(
    async () => {
      const { store } = await import('/src/core/store.ts');
      return store.audio.isLoaded && !!store.audio.analysis;
    },
    null,
    { timeout: 120_000 },
  );
  await page.evaluate(async () => {
    const { store } = await import('/src/core/store.ts');
    const { defaultLyrics } = await import('/src/core/types.ts');
    store.setLyrics({
      ...defaultLyrics(),
      text: 'はじまりの歌\n[サビ]\nつぎの歌',
      timing: { ...defaultLyrics().timing, lineTimes: { 0: 1, 1: 3 } },
    });
  });
  // 最初の歌詞の動きはリリックモーションのタブで作る (歌詞タブは作り直さない)
  await page.click('button[data-panel="motion"]');
  const P = '/src/core/lyrics/motion-provider.ts';
  // 最初の歌詞の動きができるまで待つ
  const ready = (): Promise<boolean> =>
    page.evaluate(async (P) => {
      const p = (await import(P)).previewMotionProvider as unknown as {
        currentKey: string;
        isBuilding: boolean;
      };
      return p.currentKey !== '' && !p.isBuilding;
    }, P);
  await expect.poll(ready, { timeout: 120_000 }).toBe(true);
  await page.click('button[data-panel="lyrics"]');
  const notice = page.locator('[data-lyrics="motion-apply"]').first();
  await expect(notice).toBeHidden();
  // [サビ] は行にならない (タイムラインのブロックは 2 つ)
  const lines = await page.evaluate(async () => {
    const { buildLyricsView } = await import('/src/core/lyrics/view.ts');
    const { store } = await import('/src/core/store.ts');
    return buildLyricsView(store.lyrics!, 6).parsed.lines.map((l) => l.text);
  });
  expect(lines).toEqual(['はじまりの歌', 'つぎの歌']);

  // 時刻だけを変える → しばらく待っても作り直さず、ボタンが出る
  await page.evaluate(async () => {
    const { store } = await import('/src/core/store.ts');
    store.updateLyricsTiming({ lineTimes: { 0: 1.2, 1: 3 } });
  });
  await page.waitForTimeout(2000);
  await expect(notice).toBeVisible();
  expect(await page.evaluate(async (P) => (await import(P)).previewMotionProvider.hasPendingTiming, P)).toBe(true);
  // ビジュアライザータブにも出る
  await page.click('button[data-panel="visualizer"]');
  await expect(page.locator('[data-lyrics="motion-apply"]')).toBeVisible();
  // 押すと作り直して、消える
  await page.locator('[data-lyrics="motion-apply-button"]').click();
  await expect
    .poll(
      () =>
        page.evaluate(async (P) => {
          const { previewMotionProvider: p } = await import(P);
          return !p.isBuilding && !p.hasPendingTiming;
        }, P),
      { timeout: 120_000 },
    )
    .toBe(true);
  await expect(page.locator('[data-lyrics="motion-apply"]')).toBeHidden();
});

test('タイムラインのドラッグは最初は吸着しない (置いた所に置ける)。「ドラッグで吸着する」を入れると候補・拍に合う', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept="audio/*"]').setInputFiles({
    name: 'test.wav',
    mimeType: 'audio/wav',
    buffer: testWav(),
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { store } = await import('/src/core/store.ts');
          return store.audio.isLoaded && !!store.audio.analysis;
        }),
      { timeout: 120_000 },
    )
    .toBe(true);
  await page.evaluate(async () => {
    const { store } = await import('/src/core/store.ts');
    const { defaultLyrics } = await import('/src/core/types.ts');
    store.setLyrics({
      ...defaultLyrics(),
      text: 'はじまりの歌\nつぎの歌',
      timing: {
        ...defaultLyrics().timing,
        lineTimes: { 0: 1, 1: 3 },
        lineEnds: { 0: 2.5 },
      },
    });
  });
  await page.click('button[data-panel="lyrics"]');
  const canvas = page.locator('.lyrics-timeline-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const start0 = (): Promise<number> =>
    page.evaluate(async () => {
      const { store } = await import('/src/core/store.ts');
      return Number(store.lyrics!.timing.lineTimes['0']);
    });
  // 曲が短いので、曲全体が横幅いっぱいに入る (1 秒 = 横幅 ÷ 6 秒)
  const pps = box.width / 6;
  /** 1 行目のブロックの真ん中あたりをつかんで、右へ sec 秒ぶん動かす */
  const drag = async (sec: number): Promise<void> => {
    const t = await start0();
    const x = box.x + t * pps + 40;
    const dx = sec * pps;
    const y = box.y + 145;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, { steps: 3 });
    await page.mouse.move(x + dx, y, { steps: 3 });
    await page.mouse.up();
  };
  await expect(page.locator('[data-lyrics="timeline-snap"]')).not.toBeChecked();
  // 1 秒 → 1.45 秒 (近くの 1.5 秒に拍・音の立ち上がりがあるが、吸い寄せられない)
  await drag(0.45);
  expect(await start0()).toBeCloseTo(1.45, 2);
  // 吸着を入れると、近くの拍・候補 (0.5 秒ごとの音) に合う
  await page.locator('[data-lyrics="timeline-snap"]').check();
  await drag(0.03);
  const snapped = await start0();
  expect(Math.abs(snapped - Math.round(snapped * 2) / 2), String(snapped)).toBeLessThan(0.03);
});

test('はじめかた: 歌詞タブで曲を選び、歌詞を入れ、「1 行目からタップを始める」でタップが始まる。歌詞の表示とタイムラインが一緒に見える', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.click('button[data-panel="lyrics"]');
  const tapStart = page.locator('[data-lyrics="step-tap"]');
  await expect(tapStart).toBeDisabled();
  await page.locator('[data-lyrics="step-song"]').setInputFiles({
    name: 'test.wav',
    mimeType: 'audio/wav',
    buffer: testWav(),
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { store } = await import('/src/core/store.ts');
          return store.audio.isLoaded && !!store.audio.analysis;
        }),
      { timeout: 120_000 },
    )
    .toBe(true);
  await expect(tapStart).toBeDisabled();
  await page.locator('textarea').first().fill('[Intro]\nはじまりの歌\nつぎの歌');
  await expect(tapStart).toBeEnabled();
  await expect(page.locator('[data-lyrics="steps"] .lyrics-step-mark.done')).toHaveCount(2);
  await tapStart.click();
  await expect(page.locator('.lyrics-tap-controls .lyrics-tap-active')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isPlaying)).toBe(true);
  // 大きな歌詞の表示とタイムラインが、どちらも画面の中にある
  await page.waitForTimeout(800);
  await expect(page.locator('.lyrics-now')).toBeInViewport();
  await expect(page.locator('.lyrics-timeline-canvas')).toBeInViewport();
  await page.keyboard.press('Escape');
});

test('歌詞の空白: 再生位置から作ると、次の行の始まりまでが空白になり、行はそこで終わる。種類を選べて、Delete で消せる', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept="audio/*"]').setInputFiles({ name: 'test.wav', mimeType: 'audio/wav', buffer: testWav() });
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isLoaded)).toBe(true);
  await page.evaluate(async () => {
    const { store } = await import('/src/core/store.ts');
    const { defaultLyrics } = await import('/src/core/types.ts');
    store.setLyrics({ ...defaultLyrics(), text: 'はじまりの歌\nつぎの歌', timing: { ...defaultLyrics().timing, lineTimes: { 0: 0.5, 1: 4.5 } } });
    store.audio.seek(2);
  });
  await page.click('button[data-panel="lyrics"]');
  await page.locator('[data-lyrics="blank-make"]').click();
  const timing = () => page.evaluate(async () => (await import('/src/core/store.ts')).store.lyrics!.timing);
  await expect.poll(async () => (await timing()).blanks?.length ?? 0).toBe(1);
  const t1 = await timing();
  expect(t1.blanks![0]!.start).toBeCloseTo(2, 1);
  expect(t1.blanks![0]!.end).toBeCloseTo(4.5, 5);
  expect(t1.blanks![0]!.mode).toBe('none');
  // 1 行目は空白の始まりで終わる
  expect(t1.lineEnds['0']).toBeCloseTo(2, 1);
  // 種類を「間奏の動き」に
  await page.locator('[data-lyrics="blank-mode"]').selectOption('interlude');
  await expect.poll(async () => (await timing()).blanks![0]!.mode).toBe('interlude');
  // Delete で消す
  await page.locator('[data-lyrics="blank-mode"]').blur();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await timing()).blanks?.length ?? 0).toBe(0);
});
