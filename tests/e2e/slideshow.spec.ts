import { expect, test } from '@playwright/test';

/**
 * 背景のスライドショー (core/render/background.ts + core/render/slideshow.ts) の E2E。
 * - 本物の VisualizerHost で、切り替え表どおりの時刻に、その画像の色になる (パッと切り替え / じわっと重なる)
 * - 書き出しと同じ advanceExact の流れでも同じ絵になる (読み終わるまで待つ)
 * - 「背景と素材」タブで画像を複数選ぶと、一覧に並び、ファイル名の区切りの言葉に印が付く
 */

test.describe.configure({ timeout: 240_000 });

test('スライドショー: 切り替え表の時刻にその画像の色になり、じわっと重なる間は 2 枚の間の色。書き出しの流れでも同じ', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
    const { visualizerRegistry } = await import('/src/visualizers/index.ts');
    const { defaultCommonParams, defaultBackground, defaultComposition, defaultSlides } = await import('/src/core/types.ts');
    const W = 160;
    const H = 90;
    // 赤・緑・青の 1 色の画像 3 枚
    const colors = ['#ff0000', '#00ff00', '#0000ff'];
    const files = await Promise.all(
      colors.map(async (c, i) => {
        const src = document.createElement('canvas');
        src.width = 64;
        src.height = 36;
        const g = src.getContext('2d')!;
        g.fillStyle = c;
        g.fillRect(0, 0, 64, 36);
        const blob = await new Promise<Blob>((res) => src.toBlob((b) => res(b!), 'image/png'));
        return new File([blob], `p${i}.png`, { type: 'image/png' });
      }),
    );
    const items = files.map((f, i) => ({ ref: f.name, sha256: String(i).repeat(64) }));
    const run = async (transition: 'cut' | 'fade', exact: boolean): Promise<number[][]> => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(W, H);
      const params = { ...defaultCommonParams(), intensity: 0 };
      await host.setPreset(visualizerRegistry.get('_debug-bars')!, 1, params);
      // 背景だけを見る: ビジュアライザーは見えなくする (そのまま上に・濃さ 0)
      host.composition = { ...defaultComposition(), visualizerBlend: 'over', visualizerOpacity: 0 };
      const settings = { ...defaultBackground(items[0]!.ref, items[0]!.sha256, 'image'), dim: 0, slides: { ...defaultSlides(items), transition, fadeSec: 1 } };
      await host.background.load(settings, files[0]!, { exact, slideFiles: files });
      host.background.setSlideCues([
        { t: 0, index: 0 },
        { t: 2, index: 1 },
        { t: 4, index: 2 },
      ]);
      const times = [0.5, 2.5, 3.5, 4.0, 5.5];
      if (exact) host.background.beginExact(times);
      const tmp = document.createElement('canvas');
      tmp.width = W;
      tmp.height = H;
      const tg = tmp.getContext('2d')!;
      const out: number[][] = [];
      for (const t of times) {
        const frame = { t, dt: 1 / 30, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64) };
        if (exact) await host.background.advanceExact();
        else {
          // プレビュー: 画像の読み込みが終わるまで、同じ時刻で何度か描く
          for (let k = 0; k < 20; k++) {
            host.render(frame, params);
            await new Promise((res) => setTimeout(res, 20));
          }
        }
        host.render(frame, params);
        tg.drawImage(canvas, 0, 0);
        const d = tg.getImageData(W / 2, H / 2, 1, 1).data;
        out.push([d[0]!, d[1]!, d[2]!]);
      }
      host.dispose();
      canvas.remove();
      return out;
    };
    return { cut: await run('cut', false), fade: await run('fade', false), exactFade: await run('fade', true) };
  });
  const near = (a: number[], b: number[], tol = 12): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
  // パッと切り替え: 0.5 秒 = 赤、2.5・3.5 秒 = 緑、4.0・5.5 秒 = 青
  expect(near(r.cut[0]!, [255, 0, 0]), JSON.stringify(r.cut)).toBe(true);
  expect(near(r.cut[1]!, [0, 255, 0]), JSON.stringify(r.cut)).toBe(true);
  expect(near(r.cut[2]!, [0, 255, 0]), JSON.stringify(r.cut)).toBe(true);
  expect(near(r.cut[3]!, [0, 0, 255]), JSON.stringify(r.cut)).toBe(true);
  // じわっと重なる (1 秒): 2.5 秒は赤と緑の間、3.5 秒は緑だけ、4.0 秒は緑のまま (重なり始め)、5.5 秒は青
  for (const run of [r.fade, r.exactFade]) {
    expect(run[1]![0]).toBeGreaterThan(60);
    expect(run[1]![1]).toBeGreaterThan(60);
    expect(near(run[2]!, [0, 255, 0]), JSON.stringify(run)).toBe(true);
    expect(near(run[3]!, [0, 255, 0]), JSON.stringify(run)).toBe(true);
    expect(near(run[4]!, [0, 0, 255]), JSON.stringify(run)).toBe(true);
  }
  // プレビューと書き出しの流れで同じ絵
  for (let i = 0; i < r.fade.length; i++) expect(near(r.fade[i]!, r.exactFade[i]!, 2), `${i}`).toBe(true);
});

test('「背景と素材」タブで画像を複数選ぶと一覧に並び、ファイル名の区切りの言葉に印が付く', async ({ page }) => {
  await page.goto('/');
  await page.click('button[data-panel="overlay"]');
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 18;
    const g = c.getContext('2d')!;
    g.fillStyle = '#336';
    g.fillRect(0, 0, 32, 18);
    return c.toDataURL('image/png').split(',')[1]!;
  });
  const buf = Buffer.from(png, 'base64');
  await page.locator('[data-background="slides-files"]').setInputFiles([
    { name: '10_街.png', mimeType: 'image/png', buffer: buf },
    { name: '2_サビ.png', mimeType: 'image/png', buffer: buf },
    { name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('x') },
    { name: '1_intro.png', mimeType: 'image/png', buffer: buf },
  ]);
  const list = page.locator('[data-background="slide-list"]');
  await expect(list.locator('.slide-item')).toHaveCount(3);
  // ファイル名の順 (数字は数として)。画像でないファイルは使わない
  await expect(list.locator('.slide-name')).toHaveText(['1_intro.png', '2_サビ.png', '10_街.png']);
  await expect(list.locator('.slide-item').nth(0).locator('.slide-kind')).toHaveText('イントロ');
  await expect(list.locator('.slide-item').nth(1).locator('.slide-kind')).toHaveText('サビ');
  await expect(list.locator('.slide-item').nth(2).locator('.slide-kind')).toHaveCount(0);
  const saved = await page.evaluate(async () => {
    const { store } = await import('/src/core/store.ts');
    return store.background?.slides?.items.map((it) => it.ref);
  });
  expect(saved).toEqual(['1_intro.png', '2_サビ.png', '10_街.png']);
});
