import { expect, test, type Page } from '@playwright/test';

/**
 * レイヤー (docs/ARCHITECTURE.md「レイヤー」) の E2E。本物の Host で描いて画素を比べる。
 * - 見た目が変わらない並べ替え (空の「重ねる画像」をいちばん奥へ) では、組み替えて描いても今までと同じ絵
 *   (ビジュアライザーを写し取ってから重ね直す描き方の確かめ。差は丸めの 1〜2 まで)
 * - 歌詞をビジュアライザーの奥へ置き、ビジュアライザーを「そのまま上に」濃さ 1 にすると、歌詞は隠れる (歌詞を隠したときと同じ絵)
 * - 「背景と素材」タブのレイヤーの一覧で、▼ を押すと順番が変わる
 */

test.describe.configure({ timeout: 180_000 });

type Comp = { order?: string[]; hidden?: string[]; visualizerBlend?: 'screen' | 'add' | 'over'; visualizerOpacity?: number };

async function render(page: Page, comp: Comp): Promise<Uint8ClampedArray> {
  const data = await page.evaluate(async (comp) => {
    const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
    const { visualizerRegistry } = await import('/src/visualizers/index.ts');
    const { defaultCommonParams, defaultBackground, defaultLyrics, defaultComposition } = await import('/src/core/types.ts');
    const A = await import('/src/core/lyrics/jizura-adapter.ts');
    const W = 320;
    const H = 180;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    document.body.appendChild(canvas);
    const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
    host.resize(W, H);
    const src = document.createElement('canvas');
    src.width = 400;
    src.height = 300;
    const g = src.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 400, 300);
    grad.addColorStop(0, '#2a3f7a');
    grad.addColorStop(1, '#c86a3a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 400, 300);
    const blob = await new Promise<Blob>((r) => src.toBlob((b) => r(b!), 'image/png'));
    await host.background.load({ ...defaultBackground('bg.png', 'a'.repeat(64), 'image' as const), dim: 0 }, blob);
    host.composition = { ...defaultComposition(), ...comp };
    const lyrics = { ...defaultLyrics(), text: '夜明けの色を/覚えてる', timing: { ...defaultLyrics().timing, lineTimes: { '0': 0.3 } } };
    host.lyrics.setMotion(await A.LyricMotion.create(lyrics, null, { projectSeed: 7, width: W, height: H, fps: 30 }));
    const params = defaultCommonParams() as ReturnType<typeof defaultCommonParams> & Record<string, unknown>;
    await host.setPreset(visualizerRegistry.get('live-stage')!, 20260927, params);
    for (let i = 0; i <= 90; i++) {
      const t = i / 60;
      const bp = (t % 0.5) / 0.5;
      const bands = new Float32Array(64).fill(0.3);
      host.render({ t, dt: 1 / 60, bass: 0.9 * Math.exp(-bp * 6), mid: 0.4, high: 0.5, rms: 0.4, peak: 0.5, beat: Math.exp(-bp * 5), beatIndex: Math.floor(t / 0.5), spectralEnergy: 0.4, flux: 0.2, bands }, params);
    }
    const tmp = document.createElement('canvas');
    tmp.width = W;
    tmp.height = H;
    const g2 = tmp.getContext('2d')!;
    g2.drawImage(canvas, 0, 0);
    const d = Array.from(g2.getImageData(0, 0, W, H).data);
    host.dispose();
    canvas.remove();
    return d;
  }, comp);
  return Uint8ClampedArray.from(data);
}

function diff(a: Uint8ClampedArray, b: Uint8ClampedArray): { max: number; changed: number } {
  let max = 0;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!));
    max = Math.max(max, d);
    if (d > 8) changed++;
  }
  return { max, changed: changed / (a.length / 4) };
}

test('見た目が変わらない並べ替えなら、組み替えて描いても今までと同じ絵 (スクリーン・加算・そのまま上に)', async ({ page }) => {
  await page.goto('/');
  for (const [blend, op] of [['screen', 1], ['add', 0.8], ['over', 0.6]] as const) {
    const base = await render(page, { visualizerBlend: blend, visualizerOpacity: op });
    const moved = await render(page, { visualizerBlend: blend, visualizerOpacity: op, order: ['overlays', 'background', 'visualizer', 'lyrics'] });
    expect(diff(base, moved).max, blend).toBeLessThanOrEqual(2);
  }
});

test('歌詞をビジュアライザーの奥にして、ビジュアライザーを「そのまま上に」濃さ 1 にすると、歌詞は隠れる', async ({ page }) => {
  await page.goto('/');
  const front = await render(page, { visualizerBlend: 'over', visualizerOpacity: 1 });
  const behind = await render(page, { visualizerBlend: 'over', visualizerOpacity: 1, order: ['background', 'lyrics', 'visualizer', 'overlays'] });
  const noLyrics = await render(page, { visualizerBlend: 'over', visualizerOpacity: 1, hidden: ['lyrics'] });
  expect(diff(behind, noLyrics).max).toBeLessThanOrEqual(2);
  // 手前にあれば歌詞が見える (隠したときと違う画素がある)
  expect(diff(front, noLyrics).changed).toBeGreaterThan(0.002);
});

test('「背景と素材」タブのレイヤーの一覧: ▼ で歌詞がビジュアライザーの奥へ、チェックを外すと隠れる', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'en'));
  await page.goto('/');
  await page.getByRole('tab', { name: 'Overlay' }).click();
  const order = () => page.locator('.layer-row').evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.layer));
  // 一覧は手前から
  expect(await order()).toEqual(['overlays', 'lyrics', 'visualizer', 'background']);
  await page.locator('.layer-row[data-layer="lyrics"] .layer-move').nth(1).click();
  expect(await order()).toEqual(['overlays', 'visualizer', 'lyrics', 'background']);
  await page.locator('.layer-row[data-layer="lyrics"] input[type="checkbox"]').uncheck();
  // タブを切り替えても残る (store の composition)
  await page.getByRole('tab', { name: 'Music' }).click();
  await page.getByRole('tab', { name: 'Overlay' }).click();
  expect(await order()).toEqual(['overlays', 'visualizer', 'lyrics', 'background']);
  await expect(page.locator('.layer-row[data-layer="lyrics"] input[type="checkbox"]')).not.toBeChecked();
  await expect(page.locator('select[data-control="visualizer-blend"]')).toHaveValue('screen');
});
