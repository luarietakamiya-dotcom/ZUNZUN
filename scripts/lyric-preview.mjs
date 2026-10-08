// 歌詞モーションの「動きの見本」を作る（静止画では動きの良し悪しが分からないため。2026-10-08 姫の了承）。
// スタイルごとに、合成したリズム（キック・ハイハット・ベース）に合わせた数秒の動画 (WebM: VP9 + Opus) と、
// 1 行ぶんの動きを 1/12 秒ごとに並べたコマ送りの画像 (PNG) を書き出す。歌詞は見本用の自作の文。
//
// 使い方: 開発サーバー (npm run dev -- --port 5173) を起動して
//   node scripts/lyric-preview.mjs <出力フォルダ> <スタイルのキー...> [--sec 16] [--bpm 120] [--port] [--fps 30]
// 例: node scripts/lyric-preview.mjs /tmp/preview vs-moonfeather.c vs-subtitle.g --sec 12
// 環境変数: PW_CHROMIUM = Chromium の場所、LYRIC_FONTS = @fontsource のフォルダ (外へ書体を取りに行けない環境で使う)、
//           PREVIEW_URL = 開発サーバーの URL。
// この環境の Chromium は H.264 を書き出せないので WebM にする (iPhone は iOS 17.4 以降の Safari で再生できる)。
/* global document, AudioBuffer, performance, btoa -- page.evaluate の中 (ブラウザで動く所) だけで使う */
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const SEC = Number(opt('--sec', '16')), BPM = Number(opt('--bpm', '120')), FPS = Number(opt('--fps', '30')), PORTRAIT = flag('--port');
const [OUT, ...STYLES] = args;
if (!OUT || STYLES.length === 0) { console.error('使い方: node scripts/lyric-preview.mjs <出力フォルダ> <スタイルのキー...> [--sec 16] [--bpm 120] [--port]'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const URL_ = process.env.PREVIEW_URL ?? 'http://localhost:5173/';

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('ページのエラー:', String(e).slice(0, 300)));

// 書体: LYRIC_FONTS があれば手元の書体ファイルを使い、外の Google Fonts は止める
const FD = process.env.LYRIC_FONTS;
let fontCss = '';
if (FD) {
  const packs = [['dela-gothic-one', '400'], ['kaisei-tokumin', '800'], ['dotgothic16', '400'], ['zen-old-mincho', '900'], ['noto-serif-jp', '300'], ['noto-serif-jp', '500'], ['noto-serif-jp', '700'], ['klee-one', '600'], ['noto-sans-jp', '900'], ['noto-sans-jp', '700'], ['noto-sans-jp', '500'], ['noto-sans-jp', '300'], ['m-plus-rounded-1c', '800'], ['shippori-mincho-b1', '800']];
  for (const [n, w] of packs) {
    const f = path.join(FD, n, `${w}.css`);
    if (fs.existsSync(f)) fontCss += fs.readFileSync(f, 'utf8').replace(/url\(\.\/files\/([^)]+)\)/g, (_m, file) => `url(${URL_}__fonts/${n}/${file})`);
  }
  await page.route('**/__fonts/**', (route) => {
    const p = path.join(FD, new URL(route.request().url()).pathname.replace('/__fonts/', ''));
    if (fs.existsSync(p)) route.fulfill({ body: fs.readFileSync(p), contentType: p.endsWith('woff2') ? 'font/woff2' : 'font/woff', headers: { 'access-control-allow-origin': '*' } });
    else route.abort();
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
}
await page.goto(URL_);
if (fontCss) await page.addStyleTag({ content: fontCss });

for (const style of STYLES) {
  const t0 = Date.now();
  const res = await page.evaluate(async ({ style, SEC, BPM, FPS, PORTRAIT }) => {
    const mb = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/deps/mediabunny')) ?? 'mediabunny');
    const { analyzeSamples } = await import('/src/core/audio/analyze.ts');
    const A = await import('/src/core/lyrics/jizura-adapter.ts');
    const { defaultLyrics } = await import('/src/core/types.ts');
    const W = PORTRAIT ? 720 : 1280, H = PORTRAIT ? 1280 : 720;
    // 合成のリズム: 4 つ打ちのキック・裏のハイハット・小節ごとのベース
    const sr = 48000, n = Math.round(sr * SEC), beat = 60 / BPM;
    const buf = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr });
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    for (let i = 0; i < n; i++) {
      const t = i / sr, bt = t % beat, off = (t + beat / 2) % beat, bar = Math.floor(t / (beat * 4));
      const kick = Math.exp(-bt * 28) * Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-bt * 40)) * bt);
      const hat = Math.exp(-off * 90) * rnd() * 0.25;
      const bass = 0.18 * Math.sin(2 * Math.PI * [55, 55, 49, 41.2][bar % 4] * t) * (0.6 + 0.4 * Math.exp(-bt * 6));
      L[i] = R[i] = (kick * 0.7 + hat + bass) * 0.7;
    }
    const analysis = analyzeSamples(L, sr);
    // 見本の歌詞 (自作)。2 小節ごとに 1 行
    const lines = ['月明かりの下で', '名前を呼んだ', 'ほどけた声が/遠くで鳴った', '夜を越えて', 'Midnight 光の向こうへ', 'まだ終われない'];
    const bar2 = beat * 8, times = {}, ends = {};
    lines.forEach((_, i) => { times[String(i)] = 0.5 + i * bar2; ends[String(i)] = 0.5 + (i + 1) * bar2 - 0.15; });
    const lyrics = { ...defaultLyrics(), text: lines.join('\n'), motion: { ...defaultLyrics().motion, style }, timing: { ...defaultLyrics().timing, lineTimes: times, lineEnds: ends } };
    const m = await A.LyricMotion.create(lyrics, A.buildJizuraAudio(analysis, null), { projectSeed: 41, width: W, height: H, fps: FPS });
    await document.fonts.ready;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    // 背景: 暗い映像の代わり (ゆっくり動く柔らかい光)。歌詞が実際の映像の上でどう見えるかの目安
    const frame = (t) => {
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#141a26'); gr.addColorStop(1, '#07090e');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      const lx = W * (0.3 + 0.2 * Math.sin(t * 0.3)), ly = H * (0.35 + 0.1 * Math.cos(t * 0.23));
      const rg = g.createRadialGradient(lx, ly, 0, lx, ly, Math.max(W, H) * 0.6); rg.addColorStop(0, 'rgba(90,110,160,0.35)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
      m.render(g, t);
    };
    // 動画 (WebM)
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.WebMOutputFormat(), target });
    const video = new mb.CanvasSource(canvas, { codec: 'vp9', bitrate: 5e6 });
    const audio = new mb.AudioBufferSource({ codec: 'opus', bitrate: 128e3 });
    output.addVideoTrack(video, { frameRate: FPS }); output.addAudioTrack(audio);
    await output.start();
    await audio.add(buf);
    const frames = Math.round(SEC * FPS);
    for (let i = 0; i < frames; i++) { frame(i / FPS); await video.add(i / FPS, 1 / FPS); }
    await output.finalize();
    const webm = new Uint8Array(target.buffer);
    let bin = ''; for (let i = 0; i < webm.length; i += 0x8000) bin += String.fromCharCode(...webm.subarray(i, i + 0x8000));
    // コマ送り: 2 行目の始まりの少し前から 1/12 秒ごとに 36 コマ (3 秒)
    const cols = 6, rows = 6, tw = PORTRAIT ? 180 : 320, th = PORTRAIT ? 320 : 180, start = times['1'] - 0.25;
    const sheet = document.createElement('canvas'); sheet.width = tw * cols; sheet.height = (th + 14) * rows;
    const sg = sheet.getContext('2d'); sg.fillStyle = '#000'; sg.fillRect(0, 0, sheet.width, sheet.height);
    for (let k = 0; k < cols * rows; k++) {
      const t = start + k / 12; frame(t);
      const x = (k % cols) * tw, y = Math.floor(k / cols) * (th + 14);
      sg.drawImage(canvas, x, y, tw, th); sg.fillStyle = '#9aa'; sg.font = '10px sans-serif'; sg.fillText(`${(t - times['1']).toFixed(2)}s`, x + 3, y + th + 11);
    }
    return { webm: btoa(bin), png: sheet.toDataURL('image/png').split(',')[1], layouts: [...new Set(m.plan.cuts.filter((c) => c.line >= 0).map((c) => c.layout))] };
  }, { style, SEC, BPM, FPS, PORTRAIT });
  const base = path.join(OUT, `${style}${PORTRAIT ? '-port' : ''}`);
  fs.writeFileSync(`${base}.webm`, Buffer.from(res.webm, 'base64'));
  fs.writeFileSync(`${base}-strip.png`, Buffer.from(res.png, 'base64'));
  console.log(`${style}: ${base}.webm (${(fs.statSync(`${base}.webm`).size / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} 秒) 構図: ${res.layouts.join(', ')}`);
}
await browser.close();
