import { expect, test } from '@playwright/test';

/**
 * 書き出しの保存 (2026-10-01 レビューの声): 「書き出しを始める」を押すと先に保存する場所を聞き (Chrome / Edge の保存の窓)、
 * 終わったらそこへ自動で書き込む。窓を閉じたら書き出しを始めない。
 * 保存の窓は試験では差し替える (本物の窓は試験から操作できないため)。H.264 を書き出せないブラウザでは、書き込みの確認だけ飛ばす
 */

test.describe.configure({ timeout: 240_000 });

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

test('書き出し: 押すと先に保存する場所を聞く。閉じたら始めない。選べば終わったあとそこへ自動で書き込む', async ({ page }) => {
  // 保存の窓の代わり: 1 回目は閉じた (AbortError)、2 回目は選んだことにして、書き込まれた大きさを覚える
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__picks = [] as string[];
    w.__written = 0;
    w.__closed = false;
    w.showSaveFilePicker = async (opts: { suggestedName: string }) => {
      (w.__picks as string[]).push(opts.suggestedName);
      if ((w.__picks as string[]).length === 1) throw new DOMException('closed', 'AbortError');
      return {
        name: opts.suggestedName,
        createWritable: async () => ({
          write: async (b: Blob) => {
            w.__written = (w.__written as number) + b.size;
          },
          close: async () => {
            w.__closed = true;
          },
        }),
      };
    };
  });
  await page.goto('/');
  await page.locator('input[type="file"][accept^="audio/*"]').setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: testWav() });
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.isLoaded)).toBe(true);
  await page.evaluate(async () => (await import('/src/core/store.ts')).store.setExportSettings({ width: 640, height: 360, fps: 30 }));
  const canEncode = await page.evaluate(async () => {
    const { canEncodeVideo } = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/deps/mediabunny')) ?? 'mediabunny');
    return canEncodeVideo('avc', { width: 640, height: 360, bitrate: 1_000_000 });
  });
  await page.click('button[data-panel="export"]');
  const start = page.getByRole('button', { name: /書き出しを始める|Start export/ });

  // 1 回目: 窓を閉じる → 始めない
  await start.click();
  await expect(page.locator('.export-status')).toContainText(/保存する場所を選ばなかった|No save location was chosen/);
  expect(await page.evaluate(async () => (await import('/src/core/export/controller.ts')).exportController.status.kind)).toBe('idle');
  const picks = await page.evaluate(() => (window as unknown as { __picks: string[] }).__picks);
  expect(picks[0]).toMatch(/\.mp4$/);

  // 2 回目: 場所を選ぶ → 書き出しが始まり、終わったらそこへ書き込む
  await start.click();
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/export/controller.ts')).exportController.status.kind), { timeout: 200_000 }).not.toBe('running');
  const kind = await page.evaluate(async () => (await import('/src/core/export/controller.ts')).exportController.status.kind);
  if (!canEncode) {
    test.info().annotations.push({ type: 'skip-part', description: 'H.264 を書き出せないブラウザなので、書き込みの確認は飛ばした' });
    return;
  }
  expect(kind).toBe('done');
  await expect(page.locator('.export-status')).toContainText(/に保存しました|Saved to/);
  const written = await page.evaluate(() => (window as unknown as { __written: number; __closed: boolean }).__written);
  expect(written).toBeGreaterThan(1000);
  expect(await page.evaluate(() => (window as unknown as { __closed: boolean }).__closed)).toBe(true);
});
