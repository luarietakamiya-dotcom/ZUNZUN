import type { MotionPack, PackBox, PackEffect, PackEnv, PackJ } from '../types';
import { clean, type LayoutEnv, type Rng } from '../design-kit';
import { claudePack } from './build';
import { motionOf } from './skin';
import { advances, blindsClip, clamp01, fontOf, paperLayer, snapIn, TONES, withTrail, type Tone } from './mv/kit';
import { richOf } from './rich/layer';

/**
 * 紙と朱.c — 全画面の MV 用リリック。docs/REFERENCE_MV_ANALYSIS.md の「共通する作り方」で作る（見本の写しではない）。
 *  - 色は 生成り・墨・朱 の 3 色だけ。行ごとに背景の全面がこの中で切り替わる（同じ色が続かない）。紙の粒・染み。
 *  - 書体は明朝（Shippori Mincho）と筆（Yuji Syuku）の 2 系統。影・光・縁取りは使わない。
 *  - 1 行を丸ごと 1 カットで見せる（mv-lines.ts）。語ごとに速く入り（約 0.16 秒、ぶれの残像つき）止まる。
 *  - 止まったあとに 1 回、形が変わる: 帯が入る / 枠が消えて字が散る / 巨大な字が背景に沈む。
 *  - 行の終わりは帯のワイプ（ブラインド）で消える。
 * 決定論: 乱数は使わない（行番号と seed から決める）。
 */
export const SHU_ID = 'Shu';
export const SHU_STYLE_KEY = `vs-${SHU_ID.toLowerCase()}.c`;
const MINCHO = 'shippori', BRUSH = 'brush';
const KANJI = /[㐀-鿿々〆]/;
const DIN = 0.16;

/** 行ごとの地の色（隣り合う行は必ず違う色） */
export const toneOf = (line: number): Tone => (['paper', 'shu', 'ink'] as const)[(((line * 2) % 3) + 3) % 3]!;

/** 段取りの整え: 曲名・間奏のカードを自分の構図へ。カメラ・背景・飾り・つなぎはエンジンのものを使わない */
export function prepareShuPlan(plan: { cuts: unknown[] }): void {
  for (const value of plan.cuts) {
    const cut = value as Record<string, unknown> & { params?: Record<string, unknown> };
    if (cut.layout === 'title' || cut.layout === 'interlude') {
      const p = cut.params ?? {};
      if (cut.layout === 'interlude') cut.text = p.showTitle ? p.titleText : '';
      Object.assign(cut, { layout: 'vscShuRow', params: { ...p, font: MINCHO }, words: [String(cut.text ?? '')] });
    }
    Object.assign(cut, { cam: 'vscShuCam', camP: {}, decor: [], bg: 'none', trans: 'none', morph: null });
  }
  // 行と行の短いすき間は詰める（地の色がそのまま次の行の地へ切り替わる＝ハードカット）。
  // 長い間（0.8 秒以上）の前と最後の行だけ、帯のワイプで消える（params.tail）
  const cuts = (plan.cuts as { start: number; end: number; dur: number; line: number; params?: Record<string, unknown> }[]).slice().sort((a, b) => a.start - b.start);
  cuts.forEach((c, i) => {
    const next = cuts[i + 1], gap = next ? next.start - c.end : Infinity;
    if (gap > 0 && gap < 0.8) { c.end = next!.start; c.dur = c.end - c.start; }
    (c.params ??= {}).tail = !(gap < 0.8);
  });
}

interface Glyph { ch: string; word: number; x: number; y: number; size: number; t0: number; }

/** 語の区切り（エンジンの words。本文と合わなければ 1 語として扱う） */
function wordsOf(env: LayoutEnv, text: string): string[] {
  const w = (env.cut.words ?? []).map((s) => clean(s)).filter(Boolean);
  return w.length && w.join('').replace(/\s/g, '') === text.replace(/\s/g, '') ? w : [text];
}
/** 主役の語: 漢字のいちばん多い語（同じなら長い方） */
function heroOf(words: string[]): number {
  let best = 0, score = -1;
  words.forEach((w, i) => { const s = [...w].filter((c) => KANJI.test(c)).length * 10 + [...w].length; if (s > score) { score = s; best = i; } });
  return words.length > 1 ? best : -1;
}
/** 語ごとの入りの時刻（文字数に比例して詰め、行の前半 45 % に収める）。文字ごとに 0.035 秒ずらす */
function times(words: string[], dur: number): number[][] {
  const ws: number[] = [0];
  words.forEach((w) => ws.push(ws[ws.length - 1]! + [...w].length * 0.045 + 0.14));
  const f = Math.min(1, (dur * 0.45) / Math.max(0.01, ws[ws.length - 1]!));
  return words.map((w, i) => [...w].map((_, j) => (ws[i]! + j * 0.035) * f));
}

function drawChar(g: CanvasRenderingContext2D, J: PackJ, ch: string, x: number, y: number, size: number, font: string, color: string): void {
  g.font = fontOf(J, font, size); g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, x, y);
}

function render(J: PackJ, env: LayoutEnv, v: number): PackBox | null {
  const { W, H } = env, g = env.ctx, text = clean(env.cut.text);
  if (!text) return null;
  const box: PackBox = { x0: 0, y0: 0, x1: W, y1: H };
  if (env.pass !== 'main' || typeof g.fillText !== 'function') return box;
  const u = Math.min(W, H), portrait = W < H, k = motionOf(env), lt = env.lt, dur = Math.max(0.6, env.cut.dur);
  const line = env.cut.line | 0, tone = toneOf(line), T = TONES[tone], rich = richOf(env);
  const words = wordsOf(env, text), hero = heroOf(words), tt = times(words, dur);
  const entryEnd = Math.max(...tt.flat()) + DIN;
  const tf = entryEnd + Math.min(0.6, 0.25 * Math.max(0, dur - entryEnd)), morph = k === 0 ? 1 : snapIn(clamp01((lt - tf) / 0.3));
  const outLen = Math.min(0.18, dur * 0.12), exitQ = k === 0 || !env.cut.params.tail ? 0 : clamp01((lt - (dur - outLen)) / outLen);
  const enter = (t0: number): number => (k === 0 ? 1 : clamp01((lt - t0) / DIN));
  // 背景を塗らない（装飾 0）ときは、映像の上でも読めるよう墨の地の色を使う
  const fg = rich > 0.02 ? T.fg : TONES.ink.fg, accent = rich > 0.02 ? T.accent : TONES.ink.accent;

  g.save();
  if (exitQ > 0) blindsClip(g, W, H, exitQ);
  if (rich > 0.02) { const layer = paperLayer(W, H, tone, (env.cut.seed ?? 1) | 0); if (layer && typeof g.drawImage === 'function') { g.globalAlpha = rich; g.drawImage(layer, 0, 0, W, H); g.globalAlpha = 1; } }

  const latin = /[A-Za-z]/.test(text);
  if (v === 0 || (v === 1 && latin)) {
    // 帯: 1 行を横一列（長ければ 2 段）。主役の語は 1.45 倍。止まったあと、主役の語の後ろに朱（朱の地では墨）の帯が入る
    const scale = (w: number) => (w === hero ? 1.45 : 1);
    const rowsOf = (n: number): number[][] => { if (n === 1) return [words.map((_, i) => i)]; const half = Math.ceil(words.length / 2); return [words.slice(0, half).map((_, i) => i), words.slice(half).map((_, i) => i + half)]; };
    const unit = (ws: number[]) => ws.reduce((a, w) => a + advances(g, J, MINCHO, 100 * scale(w), [...words[w]!], 0.06).reduce((x, y) => x + y, 0), 0) / 100;
    let rows = rowsOf(1), s = Math.min(u * (portrait ? 0.1 : 0.12), (W * 0.84) / unit(rows[0]!));
    if (s < u * 0.055 && words.length > 1) { rows = rowsOf(2); s = Math.min(u * (portrait ? 0.1 : 0.12), ...rows.map((r) => (W * 0.84) / unit(r))); }
    const rowH = s * 1.75, glyphs: Glyph[] = [];
    let hx0 = Infinity, hx1 = -Infinity, hy = 0;
    rows.forEach((r, ri) => {
      const y = H * 0.5 + (ri - (rows.length - 1) / 2) * rowH;
      let x = W / 2 - (unit(r) * s) / 2;
      for (const w of r) {
        const cs = [...words[w]!], size = s * scale(w), adv = advances(g, J, MINCHO, size, cs, 0.06);
        cs.forEach((ch, j) => { const cx = x + adv[j]! / 2; glyphs.push({ ch, word: w, x: cx, y, size, t0: tt[w]![j]! }); if (w === hero) { hx0 = Math.min(hx0, x); hx1 = Math.max(hx1, x + adv[j]!); hy = y; } x += adv[j]!; });
      }
    });
    if (hero >= 0 && morph > 0) {
      const hs = s * 1.45, bx0 = hx0 - hs * 0.18, bw = (hx1 - hx0 + hs * 0.36) * morph;
      g.fillStyle = tone === 'shu' ? TONES.ink.bg : accent; g.fillRect(bx0, hy - hs * 0.66, bw, hs * 1.32);
    }
    for (const gl of glyphs) {
      const p = enter(gl.t0); if (p <= 0) continue;
      const under = hero >= 0 && gl.word === hero && morph > 0 && gl.x < hx0 - s * 0.26 + (hx1 - hx0 + s * 0.52) * morph;
      const color = under ? TONES.paper.bg : fg;
      g.globalAlpha = clamp01(p * 3);
      withTrail(g, p, (q) => [gl.x + (1 - snapIn(q)) * s * 1.6 * k, gl.y], (x, y) => drawChar(g, J, gl.ch, x, y, gl.size, MINCHO, color));
      g.globalAlpha = 1;
    }
  } else if (v === 1) {
    // 枠: 1 字ずつ細い枠が出て、字が縦の切れ目から現れる。止まったあと、枠が消えて字が上下に散る
    const chars = [...text.replace(/\s/g, '')], flat = tt.flat(), n = chars.length;
    const per = n > 9 && !portrait ? Math.ceil(n / 2) : portrait ? Math.min(n, 5) : n, rowsN = Math.ceil(n / per);
    const s = Math.min(u * 0.13, (W * 0.86) / (per * 1.52), (H * 0.62) / (rowsN * 1.9)), cell = s * 1.3, pitch = s * 1.52;
    const firstKanji = chars.findIndex((c) => KANJI.test(c));
    chars.forEach((ch, i) => {
      const t0 = flat[i] ?? 0, p = enter(t0), q = k === 0 ? 1 : clamp01((lt - t0 - 0.06) / 0.12);
      if (p <= 0) return;
      const r = Math.floor(i / per), c = i % per, cnt = Math.min(per, n - r * per);
      const x = W / 2 + (c - (cnt - 1) / 2) * pitch, y0 = H / 2 + (r - (rowsN - 1) / 2) * s * 1.9, y = y0 + (i % 2 ? 1 : -1) * s * 0.42 * morph * k;
      const fa = 1 - morph, fsz = cell * (1 + (1 - snapIn(p)) * 0.35);
      if (fa > 0.01) { g.save(); g.globalAlpha = 0.85 * fa * clamp01(p * 2.5); g.strokeStyle = fg; g.lineWidth = Math.max(1.2, s * 0.035); g.strokeRect(x - fsz / 2, y0 - fsz / 2, fsz, fsz); g.restore(); }
      if (q > 0) {
        g.save(); g.beginPath(); const hh = cell * snapIn(q); g.rect(x - cell, y - hh / 2, cell * 2, hh); g.clip();
        drawChar(g, J, ch, x, y, s, MINCHO, i === firstKanji ? accent : fg); g.restore();
      }
    });
  } else {
    // 巨字: 筆の 1 字が画面からはみ出す大きさで右から入る。小さな 1 行が左に並ぶ。止まったあと、巨字は背景に沈み、細い罫が入る
    const chars = [...text.replace(/\s/g, '')], gi = Math.max(0, chars.findIndex((c) => KANJI.test(c))), gch = chars[gi]!;
    const G = portrait ? W * 0.95 : H * 1.05, gx = portrait ? W * 0.62 : W * 0.72, gy = portrait ? H * 0.66 : H * 0.56;
    const gp = k === 0 ? 1 : clamp01(lt / 0.22), ga = 0.92 - 0.78 * morph, gs = 1 + 0.05 * morph;
    g.save(); g.globalAlpha = ga * clamp01(gp * 3);
    withTrail(g, gp, (q) => [gx + (1 - snapIn(q)) * W * 0.4 * k, gy], (x, y) => { g.save(); g.translate(x, y); g.scale(gs, gs); drawChar(g, J, gch, 0, 0, G, BRUSH, tone === 'shu' ? TONES.ink.bg : accent); g.restore(); }, 0.3);
    g.restore();
    const unitW = advances(g, J, MINCHO, 100, chars, 0.08).reduce((a, b) => a + b, 0) / 100;
    const s = Math.min(u * 0.09, (W * (portrait ? 0.84 : 0.56)) / unitW), adv = advances(g, J, MINCHO, s, chars, 0.08);
    const x0 = W * 0.08, y = portrait ? H * 0.3 : H * 0.5, flat = tt.flat();
    let x = x0;
    chars.forEach((ch, i) => {
      const t0 = 0.12 + (flat[i] ?? 0), p = enter(t0), cx = x + adv[i]! / 2; x += adv[i]!;
      if (p <= 0) return;
      g.globalAlpha = clamp01(p * 3);
      withTrail(g, p, (q) => [cx, y + (1 - snapIn(q)) * s * 0.8 * k], (xx, yy) => drawChar(g, J, ch, xx, yy, s, MINCHO, fg));
      g.globalAlpha = 1;
    });
    if (morph > 0) { g.fillStyle = tone === 'shu' ? TONES.ink.bg : accent; g.fillRect(x0, y + s * 0.78, (x - x0) * morph, Math.max(1.5, s * 0.045)); }
  }
  g.restore();
  return box;
}

const effects = (J: PackJ): PackEffect[] => {
  const layoutDef = (v: number, key: string, name: string, fits: (n: number) => boolean, w: number): PackEffect => ({
    group: 'layout', key, def: { name, fits, w, portrait: 1, plan: (_rng: Rng) => ({ font: MINCHO }), render: (env: LayoutEnv) => render(J, env, v) },
  });
  const still = (_env: PackEnv): Record<string, never> => ({});
  return [
    layoutDef(0, 'vscShuRow', '帯が入る.c', () => true, 3), layoutDef(1, 'vscShuFrame', '枠が消えて散る.c', (n) => n >= 2 && n <= 14, 2), layoutDef(2, 'vscShuGiant', '巨大な筆の字.c', () => true, 2),
    { group: 'enter', key: 'vscShuIn', def: { name: '速い入り（構図が描く）.c', inDur: (dur: number) => Math.min(0.3, dur * 0.2), apply: still } },
    { group: 'hold', key: 'vscShuHold', def: { name: '静止.c', apply: still } },
    { group: 'exit', key: 'vscShuOut', def: { name: '帯のワイプ（構図が描く）.c', outDur: (dur: number) => Math.min(0.2, dur * 0.12), apply: still } },
    { group: 'cam', key: 'vscShuCam', def: { name: 'カメラ固定.c', get: () => ({ s: 1, x: 0, y: 0, rot: 0 }) } },
  ];
};

export const shuClaudePack: MotionPack = claudePack({
  id: SHU_ID, name: '紙と朱', desc: '生成り・墨・朱の 3 色。明朝と筆の 2 書体。語ごとに速く入って止まり、帯・枠・巨字が 1 回形を変える。全画面の MV 用',
  fonts: { display: [MINCHO], body: [MINCHO], serif: [BRUSH] },
  scheme: { bg: TONES.ink.bg, fg: TONES.ink.fg, sub: '#bdb5a8', accent: TONES.ink.accent, accent2: TONES.paper.bg, dim: '#2a2622' },
  effects,
});
