import { expect, test, type Page } from '@playwright/test';

/**
 * 背景の動画 (core/render/background-video.ts) の E2E。
 * フレームごとに色を変えた 2 秒・10fps の WebM (VP9) をページの中で Mediabunny で作り、背景として描いて、
 * 画面の真ん中の色から「どのフレームが出ているか」を読む (フレーム i の赤 = 20 + 10i)。
 * - 書き出し用 (exact): 各時刻にその時刻のフレームが出る。くり返す / 最後の絵で止める。2 回やって同じ
 * - プレビュー用: 曲が止まっているときは、その時刻のフレームに合わせる
 * H.264 はこの環境 (ヘッドレス Chromium) で作れないので VP9 を使う。VP9 を作れないブラウザではスキップする。
 */

test.describe.configure({ timeout: 180_000 });

const FPS = 10;
const FRAMES = 20;
const redOf = (i: number): number => 20 + 10 * i;
/** 圧縮で色が少し変わるので、フレームの読み取りは色の差がいちばん小さいもの */
const frameOfRed = (r: number): number => Math.round((r - 20) / 10);

async function readFrames(page: Page, opts: { exact: boolean; loop: boolean; times: number[] }): Promise<number[] | { skipped: string }> {
  return page.evaluate(
    async ({ exact, loop, times, FPS, FRAMES }) => {
      const mb = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/deps/mediabunny')) ?? 'mediabunny');
      if (!(await mb.canEncodeVideo('vp9', { width: 160, height: 90, bitrate: 500_000 }))) return { skipped: 'VP9 を作れないブラウザ' };
      // 試験用の動画: フレーム i は赤 20 + 10i の単色
      const src = document.createElement('canvas');
      src.width = 160;
      src.height = 90;
      const g = src.getContext('2d')!;
      const output = new mb.Output({ format: new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
      const vs = new mb.CanvasSource(src, { codec: 'vp9', bitrate: 800_000, keyFrameInterval: 1 });
      output.addVideoTrack(vs, { frameRate: FPS });
      await output.start();
      for (let i = 0; i < FRAMES; i++) {
        g.fillStyle = `rgb(${20 + 10 * i}, 90, 60)`;
        g.fillRect(0, 0, 160, 90);
        await vs.add(i / FPS, 1 / FPS);
      }
      await output.finalize();
      const blob = new Blob([output.target.buffer!], { type: 'video/webm' });

      const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
      const { defaultBackground, defaultCommonParams } = await import('/src/core/types.ts');
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(160, 90);
      const settings = { ...defaultBackground('frames.webm', 'a'.repeat(64), 'video' as const), dim: 0, loop };
      await host.background.load(settings, blob, { exact });
      const params = defaultCommonParams() as ReturnType<typeof defaultCommonParams> & Record<string, unknown>;
      const frame = (t: number) => ({ t, dt: 1 / 60, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: 0, spectralEnergy: 0, flux: 0, bands: new Float32Array(64) });
      const tmp = document.createElement('canvas');
      tmp.width = 160;
      tmp.height = 90;
      const tg = tmp.getContext('2d')!;
      const red = (): number => {
        tg.drawImage(canvas, 0, 0);
        return tg.getImageData(80, 45, 1, 1).data[0]!;
      };
      const out: number[] = [];
      if (exact) {
        host.background.beginExact(times);
        for (const t of times) {
          await host.background.advanceExact();
          host.render(frame(t), params);
          out.push(red());
        }
      } else {
        // プレビュー: 同じ時刻で描き続ける (= 曲が止まっている) と、その時刻に合わせる
        for (const t of times) {
          const until = performance.now() + 1500;
          let r = -1;
          while (performance.now() < until) {
            host.render(frame(t), params);
            await new Promise((res) => setTimeout(res, 50));
            host.render(frame(t), params);
            const now = red();
            if (now === r) break;
            r = now;
          }
          out.push(red());
        }
      }
      host.dispose();
      canvas.remove();
      return out;
    },
    { ...opts, FPS, FRAMES },
  );
}

test('背景の動画 (書き出し用): 各時刻にその時刻のフレームが出る。くり返し / 最後の絵で止める。2 回やって同じ', async ({ page }) => {
  await page.goto('/');
  const times = [0.05, 0.55, 1.25, 1.95, 2.35, 3.05];
  const loop = await readFrames(page, { exact: true, loop: true, times });
  test.skip('skipped' in loop, 'VP9 を作れないブラウザ');
  if ('skipped' in loop) return;
  // 2 秒の動画: 2.35 → 0.35 秒 (フレーム 3)、3.05 → 1.05 秒 (フレーム 10)
  expect(loop.map(frameOfRed)).toEqual([0, 5, 12, 19, 3, 10]);
  const again = await readFrames(page, { exact: true, loop: true, times });
  expect(again).toEqual(loop);
  const hold = await readFrames(page, { exact: true, loop: false, times });
  expect((hold as number[]).map(frameOfRed)).toEqual([0, 5, 12, 19, 19, 19]);
  // 色の読み取りがずれていないこと (圧縮の誤差は ±5 まで)
  loop.forEach((r, k) => expect(Math.abs(r - redOf([0, 5, 12, 19, 3, 10][k]!))).toBeLessThanOrEqual(5));
});

test('背景の動画 (プレビュー用): 曲が止まっているときは、その時刻のフレームに合わせる', async ({ page }) => {
  await page.goto('/');
  const r = await readFrames(page, { exact: false, loop: true, times: [1.25, 0.55, 2.35] });
  test.skip('skipped' in r, 'VP9 を作れないブラウザ');
  if ('skipped' in r) return;
  // ブラウザの動画のシークはコマの境目の扱いが実装によって違うので ±1 フレームまで
  const got = r.map(frameOfRed);
  [12, 5, 3].forEach((want, k) => expect(Math.abs(got[k]! - want)).toBeLessThanOrEqual(1));
});
