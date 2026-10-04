// ビジュアライザーを選ぶカードのサムネイル (src/assets/thumbs/<id>.webp) を、実際に 1 コマ描いて作る。
// 使い方: 開発サーバー (npm run dev -- --port 5173) を起動して、`node scripts/make-thumbs.mjs`。
// 環境変数 PW_CHROMIUM に、Chromium の場所を指定できる。ビジュアライザーを足した・見た目を変えたときにやり直す。
/* global document, setTimeout -- page.evaluate の中 (ブラウザで動く所) だけで使う */
import { Buffer } from 'node:buffer';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('src/assets/thumbs');
const URL = process.env.THUMB_URL ?? 'http://localhost:5173/';
const W = 400, H = 225;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.goto(URL);
const ids = await page.evaluate(async () => {
  const { visualizerRegistry } = await import('/src/visualizers/index.ts');
  return visualizerRegistry.list().map((m) => m.id).filter((id) => id !== 'none' && !id.startsWith('_'));
});
for (const id of ids) {
  const url = await page.evaluate(async ({ id, W, H }) => {
    const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
    const { visualizerRegistry } = await import('/src/visualizers/index.ts');
    const { defaultCommonParams } = await import('/src/core/types.ts');
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; document.body.appendChild(canvas);
    const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
    host.resize(W, H);
    const params = { ...defaultCommonParams(), intensity: 0.9, sensitivity: 0.9 };
    await host.setPreset(visualizerRegistry.get(id), 20260927, params);
    await new Promise((r) => setTimeout(r, 1500)); // 画像 (写真・街並み) の読み込みを待つ
    const frames = 150; // 5 秒。120 BPM の強い拍・低音・曲調は激しめ (見栄えのする状態)
    for (let i = 0; i < frames; i++) {
      const t = i / 30; const bp = (t % 0.5) / 0.5;
      host.render({ t, dt: 1 / 30, bass: 0.35 + 0.5 * Math.exp(-bp * 5), mid: 0.5, high: 0.55, rms: 0.5, peak: 0.7, beat: Math.exp(-bp * 5), beatIndex: Math.floor(t / 0.5), spectralEnergy: 0.5, flux: 0.5,
        bands: new Float32Array(64).map((_, k) => 0.75 * (1 - k / 80) * (0.7 + 0.3 * Math.sin(k * 0.7 + t * 5))),
        song: { mood: 0.8, section: 0, sectionStart: 0, sectionCount: 3 } }, params);
    }
    const out = canvas.toDataURL('image/webp', 0.82);
    host.dispose(); canvas.remove();
    return out;
  }, { id, W, H });
  fs.writeFileSync(path.join(OUT, `${id}.webp`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(id, Math.round(fs.statSync(path.join(OUT, `${id}.webp`)).size / 1024), 'KB');
}
await browser.close();
