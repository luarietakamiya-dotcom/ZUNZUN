import { expect, test, type Page } from '@playwright/test';

/**
 * 素材レイヤーの動画 (core/render/media.ts) の E2E。ページの中で Mediabunny で WebM (VP9) を作って読む。
 * - 書き出し用 (exact): 各時刻にその時刻のフレームが出る (フレーム i の赤 = 20 + 10i。背景の動画の試験と同じ作り)
 * - 透明な部分がある WebM (VP9 + alpha): 左半分が透明な動画を、赤紫の背景の上に置くと、左は背景、右は動画の色になる
 *   (書き出し用・プレビュー用の両方)。透明な動画を作れないブラウザではスキップする
 */

test.describe.configure({ timeout: 180_000 });

async function run(page: Page, mode: 'frames' | 'alpha', exact: boolean): Promise<{ skipped: string } | { values: number[][] }> {
  return page.evaluate(
    async ({ mode, exact }) => {
      const mb = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/deps/mediabunny')) ?? 'mediabunny');
      const alpha = mode === 'alpha';
      if (!(await mb.canEncodeVideo('vp9', { width: 160, height: 90, bitrate: 500_000 }))) return { skipped: 'VP9 を作れないブラウザ' };
      const src = document.createElement('canvas');
      src.width = 160;
      src.height = 90;
      const g = src.getContext('2d')!;
      const output = new mb.Output({ format: new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
      const vs = new mb.CanvasSource(src, { codec: 'vp9', bitrate: 800_000, keyFrameInterval: 1, ...(alpha ? { alpha: 'keep' as const } : {}) });
      output.addVideoTrack(vs, { frameRate: 10 });
      await output.start();
      try {
        for (let i = 0; i < 20; i++) {
          g.clearRect(0, 0, 160, 90);
          g.fillStyle = alpha ? 'rgb(40, 200, 220)' : `rgb(${20 + 10 * i}, 90, 60)`;
          // 透明な動画は右半分だけ塗る (左半分は透明)
          if (alpha) g.fillRect(80, 0, 80, 90);
          else g.fillRect(0, 0, 160, 90);
          await vs.add(i / 10, 1 / 10);
        }
        await output.finalize();
      } catch (e) {
        return { skipped: `動画を作れない (${String(e).slice(0, 80)})` };
      }
      const blob = new Blob([output.target.buffer!], { type: 'video/webm' });

      const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
      const { defaultBackground, defaultComposition, defaultMediaLayer } = await import('/src/core/types.ts');
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(160, 90);
      // 下の絵: 赤紫一色の背景
      const bgSrc = document.createElement('canvas');
      bgSrc.width = 16;
      bgSrc.height = 9;
      const bg = bgSrc.getContext('2d')!;
      bg.fillStyle = '#803060';
      bg.fillRect(0, 0, 16, 9);
      const bgBlob = await new Promise<Blob>((res) => bgSrc.toBlob((b) => res(b!), 'image/png'));
      await host.background.load({ ...defaultBackground('bg.png', 'a'.repeat(64), 'image'), dim: 0 }, bgBlob);
      const m = { ...defaultMediaLayer('v1', 'clip.webm', 'b'.repeat(64), 'video'), scale: 1 };
      await host.media.load([{ config: m, file: blob }], { exact });
      host.media.setConfigs([m]);
      host.composition = { ...defaultComposition(), order: [...defaultComposition().order, 'media:v1'] };
      const frame = (t: number) => ({ t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: 0, spectralEnergy: 0, flux: 0, bands: new Float32Array(64) });
      const tmp = document.createElement('canvas');
      tmp.width = 160;
      tmp.height = 90;
      const tg = tmp.getContext('2d')!;
      const px = (x: number): number[] => {
        tg.drawImage(canvas, 0, 0);
        return Array.from(tg.getImageData(x, 45, 1, 1).data.slice(0, 3));
      };
      const values: number[][] = [];
      const times = alpha ? [0.55] : [0.05, 0.55, 1.25];
      if (exact) {
        host.media.beginExact(times);
        for (const t of times) {
          await host.media.advanceExact();
          host.render(frame(t), {} as never);
          values.push(alpha ? [...px(40), ...px(120)] : px(80));
        }
      } else {
        for (const t of times) {
          const until = performance.now() + 2000;
          while (performance.now() < until) {
            host.render(frame(t), {} as never);
            await new Promise((res) => setTimeout(res, 60));
          }
          host.render(frame(t), {} as never);
          values.push(alpha ? [...px(40), ...px(120)] : px(80));
        }
      }
      host.dispose();
      canvas.remove();
      return { values };
    },
    { mode, exact },
  );
}

test('素材の動画 (書き出し用): 各時刻にその時刻のフレームが出る', async ({ page }) => {
  await page.goto('/');
  const r = await run(page, 'frames', true);
  test.skip('skipped' in r, 'skipped' in r ? r.skipped : '');
  if (!('values' in r)) return;
  expect(r.values.map((v) => Math.round((v[0]! - 20) / 10))).toEqual([0, 5, 12]);
});

for (const exact of [true, false]) {
  test(`透明な部分がある WebM (${exact ? '書き出し用' : 'プレビュー用'}): 透明な所は下の背景が見え、塗った所は動画の色`, async ({ page }) => {
    await page.goto('/');
    const r = await run(page, 'alpha', exact);
    test.skip('skipped' in r, 'skipped' in r ? r.skipped : '');
    if (!('values' in r)) return;
    const [lr, lg, lb, rr, rg, rb] = r.values[0]!;
    // 左 (透明) = 背景の赤紫 #803060
    expect(Math.abs(lr! - 0x80), `left ${lr},${lg},${lb}`).toBeLessThanOrEqual(8);
    expect(Math.abs(lg! - 0x30)).toBeLessThanOrEqual(8);
    expect(Math.abs(lb! - 0x60)).toBeLessThanOrEqual(8);
    // 右 (塗った所) = 動画の水色 (40, 200, 220)。VP9 の圧縮 (YUV) で色が少し変わる (書き出し用の読み方で赤が 15 ずれた)
    expect(Math.abs(rr! - 40), `right ${rr},${rg},${rb}`).toBeLessThanOrEqual(20);
    expect(Math.abs(rg! - 200)).toBeLessThanOrEqual(20);
    expect(Math.abs(rb! - 220)).toBeLessThanOrEqual(20);
  });
}
