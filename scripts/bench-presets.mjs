// ビジュアライザーごとの描画の重さを測る (2026-10-04 公開前の確認)。1 コマの描画 (640×360・pixelRatio 1) にかかる時間を、重い順に出す。
// 使い方: 開発サーバー (npm run dev -- --port 5173) を起動して、`PW_CHROMIUM=... node scripts/bench-presets.mjs`
// GPU が無い環境 (ソフトウェア描画) で測ると、絶対値は実機より大きく出る。見るのは「ほかと比べて突出して重いものがないか」。
/* global document, performance -- page.evaluate の中 (ブラウザで動く所) だけで使う */
import { chromium } from 'playwright';

const URL = process.env.THUMB_URL ?? 'http://localhost:5173/';
const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage();
await page.goto(URL);
const res = await page.evaluate(async () => {
  const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
  const { visualizerRegistry } = await import('/src/visualizers/index.ts');
  const { defaultCommonParams } = await import('/src/core/types.ts');
  const out = [];
  const ids = visualizerRegistry.list().map((m) => m.id).filter((id) => !id.startsWith('_'));
  const W = 640, H = 360;
  for (const id of ids) {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; document.body.appendChild(canvas);
    const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
    host.resize(W, H);
    const params = { ...defaultCommonParams() };
    const t0 = performance.now();
    await host.setPreset(visualizerRegistry.get(id), 1, params);
    const init = performance.now() - t0;
    const tmp = document.createElement('canvas'); tmp.width = 4; tmp.height = 4; const g = tmp.getContext('2d');
    const frame = (i) => host.render({ t: i / 30, dt: 1 / 30, bass: 0.5, mid: 0.5, high: 0.5, rms: 0.5, peak: 0.6, beat: i % 15 === 0 ? 1 : 0, beatIndex: Math.floor(i / 15), spectralEnergy: 0.5, flux: 0.5, bands: new Float32Array(64).fill(0.5), song: { mood: 0.8, section: 0, sectionStart: 0, sectionCount: 3 } }, params);
    for (let i = 0; i < 5; i++) { frame(i); g.drawImage(canvas, 0, 0); } // 温める (シェーダーの最初のコンパイル)
    const t1 = performance.now();
    const N = 20;
    for (let i = 0; i < N; i++) { frame(5 + i); g.drawImage(canvas, 0, 0, 4, 4); g.getImageData(0, 0, 1, 1); }
    out.push({ id, initMs: Math.round(init), frameMs: Math.round((performance.now() - t1) / N) });
    host.dispose(); canvas.remove();
  }
  return out;
});
res.sort((a, b) => b.frameMs - a.frameMs);
for (const r of res) console.log(r.id.padEnd(16), '準備', String(r.initMs).padStart(5), 'ms   1 コマ', String(r.frameMs).padStart(5), 'ms (640×360・ソフトウェア描画)');
await b.close();
