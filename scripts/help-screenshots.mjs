// 「使い方」タブの画像 (src/assets/help/*.webp) を撮り直す。画面を変えたら、これで撮り直して help.ts の文も合わせる。
// 使い方: 開発サーバーを起動 (npm run dev) してから
//   node scripts/help-screenshots.mjs [chromium の場所]
// 見本の曲 (14 秒の短い音) と見本の歌詞・画像はこの中で作る (ほかの人の曲や歌詞を写さない)。
/* global document, Image, btoa -- page.evaluate の中 (ブラウザで動く所) だけで使う */
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.ZUNZUN_URL ?? 'http://localhost:5173/';
const OUT = new URL('../src/assets/help/', import.meta.url).pathname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zunzun-help-'));

/** 見本の曲: 86 BPM くらいの短い音 (14 秒、16bit モノラル WAV) */
function sampleWav() {
  const rate = 22050;
  const n = rate * 14;
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
  const beat = 60 / 86;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const p = t % beat;
    const v = p < 0.3 ? Math.sin(2 * Math.PI * 110 * t) * Math.exp(-p * 12) * 0.7 + Math.sin(2 * Math.PI * 440 * t) * 0.15 * Math.exp(-p * 4) : 0;
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2);
  }
  const file = path.join(tmp, 'sample.wav');
  fs.writeFileSync(file, buf);
  return file;
}

const browser = await chromium.launch({
  executablePath: process.argv[2] || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(BASE);
await page.waitForTimeout(500);
const pngs = {};
const clipShot = async (name, clip) => (pngs[name] = await page.screenshot({ clip }));
const elShot = async (name, locator, maxH = 2000) => {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const b = await locator.boundingBox();
  await clipShot(name, { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, maxH) });
};
const loaded = () => page.waitForFunction(async () => { const { store } = await import('/src/core/store.ts'); return store.audio.isLoaded && !!store.audio.analysis; }, null, { timeout: 120000 });

// 音楽
await page.locator('section.panel input[type="file"][accept^="audio/*"]').setInputFiles(sampleWav());
await loaded();
await page.waitForTimeout(500);
await clipShot('music', { x: 0, y: 0, width: 1280, height: 280 });
// 歌詞
await page.click('button[data-panel="lyrics"]');
await page.waitForTimeout(400);
await page.locator('textarea').first().fill('[Intro]\n\n[Aメロ]\n夜明けの色を\n覚えてる\n[サビ]\nほどけた声が\n遠くで鳴った\n[Outro]');
await page.waitForTimeout(1200);
await elShot('lyrics-steps', page.locator('[data-lyrics="steps"]'));
await elShot('lyrics-input', page.locator('.lyrics-card').nth(1), 520);
await page.locator('[data-lyrics="step-tap"]').click();
await page.waitForTimeout(1800);
await page.keyboard.press('Space');
await page.waitForTimeout(1500);
await clipShot('lyrics-tap', { x: 0, y: 50, width: 940, height: 800 });
await page.keyboard.press('Escape');
await page.evaluate(async () => (await import('/src/core/store.ts')).store.updateLyricsTiming({ lineTimes: { 0: 2, 1: 4.5, 2: 7.2, 3: 9.6 } }));
await page.click('button[data-panel="visualizer"]');
await page.click('button[data-panel="lyrics"]');
await page.waitForTimeout(1000);
await elShot('lyrics-timeline', page.locator('.lyrics-card').filter({ has: page.locator('.lyrics-timeline-box') }));
// リリックモーション (区切りで動きを変える)
await page.click('button[data-panel="motion"]');
await page.waitForTimeout(1500);
await elShot('lyric-motion', page.locator('.lyrics-card').filter({ has: page.locator('[data-motion="sections-on"]') }));
// ビジュアライザー (写真に動き)
await page.evaluate(async () => (await import('/src/core/store.ts')).store.audio.seek(7.6));
await page.click('button[data-panel="visualizer"]');
await page.waitForTimeout(500);
await page.locator('section.panel select').first().selectOption('photo-motion');
await page.waitForTimeout(1000);
if (await page.locator('[data-lyrics="motion-apply-button"]').isVisible()) await page.locator('[data-lyrics="motion-apply-button"]').click();
await page.waitForTimeout(4000);
await page.evaluate(() => document.querySelector('section.panel h2').scrollIntoView({ block: 'start' }));
await page.waitForTimeout(800);
const vb = await page.locator('section.panel h2').first().boundingBox();
await clipShot('visualizer', { x: 0, y: Math.max(0, vb.y - 4), width: 1280, height: 650 });
// 背景と素材 (見本の画像 6 枚でスライドショー)
await page.click('button[data-panel="overlay"]');
await page.waitForTimeout(500);
const imgs = await page.evaluate(() => {
  const mk = (a, b, label) => {
    const s = document.createElement('canvas');
    s.width = 320;
    s.height = 180;
    const g = s.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 320, 180);
    gr.addColorStop(0, a);
    gr.addColorStop(1, b);
    g.fillStyle = gr;
    g.fillRect(0, 0, 320, 180);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = 'bold 30px sans-serif';
    g.fillText(label, 18, 100);
    return s.toDataURL('image/png').split(',')[1];
  };
  return [['#ff5577', '#7a1030', 'サビ_01'], ['#ffaa33', '#7a3a10', 'サビ_02'], ['#3366cc', '#101a40', '01_街'], ['#33aa88', '#0f3a30', '02_空'], ['#8866dd', '#2a1050', '03_夜'], ['#cc9944', '#3a2a10', 'intro']].map(([a, b, l]) => [l, mk(a, b, l)]);
});
await page.locator('[data-background="slides-files"]').setInputFiles(imgs.map(([l, b]) => ({ name: `${l}.png`, mimeType: 'image/png', buffer: Buffer.from(b, 'base64') })));
await page.waitForTimeout(800);
await elShot('background', page.locator('.background-card').nth(1), 760);
await elShot('layers', page.locator('.layers-card'), 560);
// 設定・書き出し
await page.click('button[data-panel="settings"]');
await page.waitForTimeout(500);
await clipShot('settings', { x: 0, y: 50, width: 1280, height: 210 });
await page.click('button[data-panel="export"]');
await page.waitForTimeout(500);
await clipShot('export', { x: 0, y: 50, width: 1280, height: 290 });

// WebP にする (ブラウザの canvas で。パッケージは増やさない)。src に書くと開発サーバーがページを読み直すので、全部変換してから書く
const webps = {};
for (const [name, png] of Object.entries(pngs)) {
  const b64 = await page.evaluate(async (d) => {
    const img = new Image();
    img.src = d;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.82));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  }, 'data:image/png;base64,' + png.toString('base64'));
  webps[name] = b64;
}
await browser.close();
for (const [name, b64] of Object.entries(webps)) {
  fs.writeFileSync(path.join(OUT, `${name}.webp`), Buffer.from(b64, 'base64'));
  console.log(name);
}
fs.rmSync(tmp, { recursive: true, force: true });
