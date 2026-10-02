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

test('画像の動き: 映している間にゆっくり動き (切ると止まる)、拍の直後は少し寄る。書き出しの流れでも同じ絵', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
    const { visualizerRegistry } = await import('/src/visualizers/index.ts');
    const { defaultCommonParams, defaultBackground, defaultComposition, defaultSlides } = await import('/src/core/types.ts');
    const { defaultSlideMotion } = await import('/src/core/render/slide-motion.ts');
    const W = 160;
    const H = 90;
    // 模様のある画像 2 枚 (動くと画素が変わるように、縞と丸)
    const files = await Promise.all(
      [0, 1].map(async (i) => {
        const src = document.createElement('canvas');
        src.width = 320;
        src.height = 180;
        const g = src.getContext('2d')!;
        for (let x = 0; x < 320; x += 20) {
          g.fillStyle = (x / 20 + i) % 2 ? '#e04040' : '#40a0e0';
          g.fillRect(x, 0, 20, 180);
        }
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(160, 90, 40, 0, Math.PI * 2);
        g.fill();
        const blob = await new Promise<Blob>((res) => src.toBlob((b) => res(b!), 'image/png'));
        return new File([blob], `m${i}.png`, { type: 'image/png' });
      }),
    );
    const items = files.map((f, i) => ({ ref: f.name, sha256: String(i).repeat(64) }));
    const run = async (motion: unknown, exact: boolean, times: number[]): Promise<Uint8ClampedArray[]> => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(W, H);
      const params = { ...defaultCommonParams(), intensity: 0 };
      await host.setPreset(visualizerRegistry.get('_debug-bars')!, 1, params);
      host.composition = { ...defaultComposition(), visualizerBlend: 'over', visualizerOpacity: 0 };
      const settings = { ...defaultBackground(items[0]!.ref, items[0]!.sha256, 'image'), dim: 0, slides: { ...defaultSlides(items), transition: 'cut' as const, motion } };
      await host.background.load(settings, files[0]!, { exact, slideFiles: files });
      host.background.setSlideCues(
        [
          { t: 0, index: 0, kind: 'verse' },
          { t: 10, index: 1, kind: 'verse' },
        ],
        [5],
      );
      if (exact) host.background.beginExact(times);
      const tmp = document.createElement('canvas');
      tmp.width = W;
      tmp.height = H;
      const tg = tmp.getContext('2d')!;
      const out: Uint8ClampedArray[] = [];
      for (const t of times) {
        const frame = { t, dt: 1 / 30, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64) };
        if (exact) await host.background.advanceExact();
        else
          for (let k = 0; k < 15; k++) {
            host.render(frame, params);
            await new Promise((res) => setTimeout(res, 20));
          }
        host.render(frame, params);
        tg.drawImage(canvas, 0, 0);
        out.push(tg.getImageData(0, 0, W, H).data);
      }
      host.dispose();
      canvas.remove();
      return out;
    };
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let s = 0;
      for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
      return s / (a.length / 4) / 3;
    };
    const on = { ...defaultSlideMotion(), beatPush: 0 };
    const off = { ...on, enabled: false };
    const beat = { ...on, beatPush: 1 };
    const [onA, onB] = await run(on, false, [1, 8]);
    const [offA, offB] = await run(off, false, [1, 8]);
    const [exA, exB] = await run(on, true, [1, 8]);
    const [b4, b5] = await run(beat, false, [4.95, 5.0]);
    const [n4, n5] = await run(on, false, [4.95, 5.0]);
    return {
      moved: diff(onA!, onB!),
      still: diff(offA!, offB!),
      previewVsExport: Math.max(diff(onA!, exA!), diff(onB!, exB!)),
      // 拍の直後 (5.0 秒) は、拍で寄らない設定との差が、拍の少し前 (4.95 秒) より大きい
      beatAt: diff(b5!, n5!),
      beatBefore: diff(b4!, n4!),
    };
  });
  expect(r.moved, JSON.stringify(r)).toBeGreaterThan(3);
  expect(r.still, JSON.stringify(r)).toBeLessThan(0.5);
  expect(r.previewVsExport, JSON.stringify(r)).toBeLessThan(0.5);
  expect(r.beatAt, JSON.stringify(r)).toBeGreaterThan(r.beatBefore + 0.5);
});

test('「背景と素材」タブ: スライドショーの「画像をゆっくり動かす」を切ると、大きさ・区切り・拍の設定が隠れ、保存される', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'ja'));
  await page.goto('/');
  await page.click('button[data-panel="overlay"]');
  const pngs = await page.evaluate(async () =>
    Promise.all(
      ['#f00', '#0f0'].map(async (c) => {
        const s = document.createElement('canvas');
        s.width = 32;
        s.height = 18;
        const g = s.getContext('2d')!;
        g.fillStyle = c;
        g.fillRect(0, 0, 32, 18);
        return s.toDataURL('image/png').split(',')[1]!;
      }),
    ),
  );
  await page.locator('[data-background="slides-files"]').setInputFiles(pngs.map((b, i) => ({ name: `s${i}.png`, mimeType: 'image/png', buffer: Buffer.from(b, 'base64') })));
  const onOff = page.locator('[data-background="slides-motion"]');
  await expect(onOff).toBeChecked();
  await expect(page.locator('[data-background="slides-motion-amount"]')).toBeVisible();
  await onOff.uncheck();
  await expect(page.locator('[data-background="slides-motion-amount"]')).toBeHidden();
  await expect(page.locator('[data-background="slides-motion-beat"]')).toBeHidden();
  const saved = await page.evaluate(async () => (await import('/src/core/store.ts')).store.background?.slides?.motion);
  expect(saved).toMatchObject({ enabled: false });
});
