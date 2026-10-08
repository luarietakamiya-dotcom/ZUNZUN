import type { MotionPack, PackBox, PackEffect, PackEnv, PackJ } from '../types';
import { clean, type LayoutEnv, type Rng } from '../design-kit';
import { easeInOut, easeOut } from '../util';
import { claudePack } from './build';
import { cap, decorOf, motionOf } from './skin';
import { snapIn } from './mv/kit';
import { sectionAt, type Section } from '../../sections';

/**
 * 月と羽根・字幕.c — 字幕エリア（画面の下 77〜93 %）だけを使う MV 用のリリックモーション。
 *  - 1 文字ずつ上か下から、少しずつずらして差し込む（前の文字が終わる前に次が始まる）。上下は 1 語ごとに替える。
 *  - 差し込みは透明から。定位置に近づいた側から文字が見えてくる（文字全体が薄く見えるのではない）。
 *  - 差し込みが終わった文字から羽根が舞い散る。
 *  - 月は先頭の文字の左上にかかって止まる（横には動かさない）。文字にかかった部分は透かす。イントロは三日月、サビは満月、など区切りで満ち欠けが変わる。
 * 描くものは字幕の帯からはみ出さない（clip）。決定論: 乱数は J.r（カットの seed）だけ。
 */
const FONT = 'shippori';
export const MOONFEATHER_ID = 'MoonFeather';
export const MOONFEATHER_STYLE_KEY = `vs-${MOONFEATHER_ID.toLowerCase()}.c`;
const BAND = { x: 0.06, y: 0.77, w: 0.88, h: 0.16 };
const KANJI = /[㐀-鿿々〆]/, KANA = /[぀-ヿ・ー]/, LATIN = /[A-Za-z0-9]/;

/** 区切りの種類ごとの月の明るさ（0..1）と、満ちていく向きか */
const PHASES: Record<string, [number, boolean]> = {
  intro: [0.12, true], verse: [0.3, true], prechorus: [0.62, true], chorus: [1, true],
  bridge: [0.5, false], interlude: [0.38, false], outro: [0.1, false], other: [0.3, true],
};

/** 段取りの各カットに月の満ち欠けを付ける。区切りの見出しが無い曲は、曲の進み具合で満ちて欠ける */
export function prepareMoonPlan(plan: { cuts: unknown[] }, sections: readonly Section[], duration: number): void {
  for (const value of plan.cuts) {
    const cut = value as Record<string, unknown> & { start?: number; params?: Record<string, unknown> };
    const t = Number(cut.start ?? 0);
    const params = (cut.params ??= {});
    const k = sectionAt(sections, t);
    let moon: [number, boolean];
    if (k >= 0) moon = PHASES[sections[k]!.kind] ?? PHASES.other!;
    else {
      const p = duration > 0 ? cap(t / duration) : 0;
      moon = p < 0.6 ? [0.12 + 0.88 * (p / 0.6), true] : [1 - 0.9 * ((p - 0.6) / 0.4), false];
    }
    params.moon = moon[0]; params.waxing = moon[1];
    if (cut.layout === 'title' || cut.layout === 'interlude') {
      const showTitle = (params as Record<string, unknown>).showTitle;
      if (cut.layout === 'interlude') cut.text = showTitle ? (params as Record<string, unknown>).titleText : '';
      Object.assign(cut, { layout: 'vscMfCenter', params: { ...params, font: FONT } });
    }
    Object.assign(cut, { cam: 'vscMfCam', camP: {}, decor: [], bg: 'none', trans: 'none', morph: null });
  }
  // 前のカットの月の形（phaseOf の値）を覚える。描くときに、そこから今の形へなめらかに満ち欠けさせる
  const sorted = (plan.cuts as { start?: number; params?: Record<string, unknown> }[]).slice().sort((a, b) => Number(a.start ?? 0) - Number(b.start ?? 0));
  let prev: number | null = null;
  for (const c of sorted) {
    const ph = phaseOf(Number(c.params?.moon ?? 0.5), c.params?.waxing !== false);
    c.params!.moonFrom = prev ?? ph; prev = ph;
  }
}

/** 月の形を 1 つの数にする: 0 = 新月 → 1 = 満月（満ちていく）→ 2 = 新月（欠けていく） */
export const phaseOf = (illum: number, waxing: boolean): number => (waxing ? cap(illum) : 2 - cap(illum));
const fromPhase = (ph: number): [number, boolean] => (ph <= 1 ? [cap(ph), true] : [cap(2 - ph), false]);

/** 最大 2 行。文字を省略しない */
export function lines(text: string): string[] {
  const chars = [...clean(text)];
  if (chars.length < 14) return [chars.join('')];
  const mid = Math.ceil(chars.length / 2);
  const cands = chars.flatMap((c, i) => (/[ 、。，,]/.test(c) && i > chars.length * 0.3 && i < chars.length * 0.7 ? [i + 1] : []));
  const at = cands.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0] ?? mid;
  return [chars.slice(0, at).join('').trim(), chars.slice(at).join('').trim()];
}

interface Glyph { ch: string; x: number; y: number; size: number; word: number; dir: -1 | 1; }

/** 文字の並び（1 語ごとに上下の向きを決める） */
export function layGlyphs(J: PackJ, rows: string[], size: number, W: number, H: number, seed: number): Glyph[] {
  const out: Glyph[] = [];
  const cls = (c: string) => (KANJI.test(c) ? 'k' : KANA.test(c) ? 'h' : LATIN.test(c) ? 'l' : 'o');
  let word = -1, prev = '', prevDir: -1 | 1 = 1;
  const rowH = size * 1.42, y0 = H * (BAND.y + BAND.h / 2) - ((rows.length - 1) * rowH) / 2;
  rows.forEach((row, ri) => {
    const items: { ch: string; s: number; w: number; word: number; dir: -1 | 1 }[] = [];
    for (const ch of [...row]) {
      if (ch === ' ') { prev = ''; items.push({ ch, s: size, w: size * 0.4, word: -1, dir: 1 }); continue; }
      const c = cls(ch);
      if (c !== prev || c === 'o') {
        word++; prev = c;
        // 漢字・英字の語は決まった乱数で上下、かなの語は前の語と逆向きにする
        prevDir = c === 'k' || c === 'l' ? (J.r(seed, word, 11) > 0.5 ? 1 : -1) : (prevDir === 1 ? -1 : 1);
      }
      const s = size * (c === 'k' ? 1.16 : 1);
      const w = J.measure({ text: ch, font: FONT, size: s }).w + size * 0.06;
      items.push({ ch, s, w, word, dir: prevDir });
    }
    const total = items.reduce((a, g) => a + g.w, 0);
    let x = W / 2 - total / 2;
    for (const g of items) {
      if (g.ch !== ' ') out.push({ ch: g.ch, x: x + g.w / 2, y: y0 + ri * rowH, size: g.s, word: g.word, dir: g.dir });
      x += g.w;
    }
  });
  return out;
}

let scratch: HTMLCanvasElement | null = null;
const scratchOf = (w: number, h: number): CanvasRenderingContext2D | null => {
  if (typeof document === 'undefined') return null;
  scratch ??= document.createElement('canvas');
  if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
  const g = scratch.getContext('2d');
  if (!g || typeof g.clearRect !== 'function' || typeof g.createLinearGradient !== 'function') return null;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.globalCompositeOperation = 'source-over';
  return g;
};

/** 月（満ち欠け・位置・不透明度）。欠けた側は地球照でかすかに見える。明るい側には海（暗い模様）とクレーター */
function drawMoon(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, illum: number, waxing: boolean, a: number, seed: number, J: PackJ): void {
  if (a <= 0.01) return;
  g.save(); g.globalAlpha = a; g.translate(cx, cy); if (!waxing) g.scale(-1, 1);
  // 地球照（欠けた側の、ごく淡い円）
  const dark = g.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.2, 0, 0, r);
  dark.addColorStop(0, 'rgba(150,165,190,0.16)'); dark.addColorStop(1, 'rgba(90,100,125,0.1)');
  g.fillStyle = dark; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  const t = (1 - 2 * cap(illum)) * r;
  g.beginPath(); g.moveTo(0, -r); g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  if (Math.abs(t) < 0.5) g.lineTo(0, -r); else g.ellipse(0, 0, Math.abs(t), r, 0, Math.PI / 2, -Math.PI / 2, t > 0);
  g.closePath();
  g.shadowColor = 'rgba(255,240,200,0.5)'; g.shadowBlur = r * 0.2;
  const gr = g.createRadialGradient(-r * 0.25, -r * 0.2, r * 0.1, 0, 0, r * 1.05); gr.addColorStop(0, '#fffbec'); gr.addColorStop(1, '#e4d6a6');
  g.fillStyle = gr; g.fill(); g.shadowBlur = 0;
  g.clip();
  // 海（大きく淡い暗い模様）
  for (let i = 0; i < 4; i++) {
    const x = (J.r(seed, i, 31) - 0.45) * r * 1.1, y = (J.r(seed, i, 32) - 0.55) * r * 1.1, rr = r * (0.22 + J.r(seed, i, 33) * 0.25);
    g.fillStyle = 'rgba(140,128,96,0.18)'; g.beginPath(); g.ellipse(x, y, rr, rr * (0.7 + J.r(seed, i, 34) * 0.4), J.r(seed, i, 35) * 3, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 7; i++) { // 淡いクレーター
    const x = (J.r(seed, i, 21) - 0.5) * r * 1.5, y = (J.r(seed, i, 22) - 0.5) * r * 1.5, cr = r * (0.05 + J.r(seed, i, 23) * 0.1);
    g.fillStyle = 'rgba(150,135,95,0.18)'; g.beginPath(); g.arc(x, y, cr, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,252,240,0.35)'; g.lineWidth = Math.max(0.5, r * 0.012); g.beginPath(); g.arc(x - cr * 0.12, y - cr * 0.12, cr, 3.6, 5.6); g.stroke();
  }
  g.restore();
}

/** 小さな光の粒（4 つの角の星）。着地と、月の光がなでる先頭に使う */
function drawGlint(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, color: string): void {
  if (a <= 0.01) return;
  g.save(); g.globalAlpha = a; g.fillStyle = color; g.translate(x, y);
  g.beginPath(); g.moveTo(0, -r); g.quadraticCurveTo(0, 0, r, 0); g.quadraticCurveTo(0, 0, 0, r); g.quadraticCurveTo(0, 0, -r, 0); g.quadraticCurveTo(0, 0, 0, -r); g.fill();
  g.restore();
}

/** 羽根 1 枚: 細い軸と、左右で幅の違う羽弁。羽弁には斜めの切れ込み（羽枝）を数本入れる */
function drawFeather(g: CanvasRenderingContext2D, x: number, y: number, len: number, ang: number, a: number, color: string): void {
  if (a <= 0.01) return;
  g.save(); g.translate(x, y); g.rotate(ang);
  const L = len / 2, w = len * 0.16;
  g.globalAlpha = a * 0.9; g.fillStyle = color;
  g.beginPath(); g.moveTo(-L, 0);
  g.bezierCurveTo(-L * 0.5, -w * 1.25, L * 0.45, -w * 1.1, L, -w * 0.08);
  g.bezierCurveTo(L * 0.5, w * 0.9, -L * 0.4, w * 0.95, -L * 0.82, w * 0.12);
  g.closePath(); g.fill();
  // 羽枝の切れ込み（背景が透ける細い隙間）
  g.globalCompositeOperation = 'destination-out'; g.lineWidth = Math.max(0.6, len * 0.012); g.strokeStyle = '#000';
  for (const t of [-0.35, 0.05, 0.4]) { g.beginPath(); g.moveTo(L * t, -w * 0.05); g.lineTo(L * (t + 0.22), -w * 1.1); g.stroke(); }
  g.globalCompositeOperation = 'source-over';
  // 軸
  g.globalAlpha = a; g.strokeStyle = color; g.lineWidth = Math.max(0.8, len * 0.022);
  g.beginPath(); g.moveTo(-L * 1.12, w * 0.22); g.quadraticCurveTo(0, -w * 0.05, L * 0.95, -w * 0.1); g.stroke();
  g.restore();
}

const DUR_IN = 0.62;
const GOLD = '#F2DFA0';

/** 羽根 1 枚ぶんの動き（文字の位置から、age 秒たったとき）。着地の羽根と、退場で文字が羽根になるときに使う */
function featherAt(J: PackJ, seed: number, i: number, f: number, gx: number, gy: number, gsize: number, size: number, age: number, life: number, burst: number) {
  const r = (n: number) => J.r(seed, i, f * 7 + n);
  const p = age / life, side = r(2) < 0.5 ? -1 : 1, drift = side * (2 + r(3) * 2.6) * size * burst;
  const x = gx + drift * (1 - Math.pow(1 - p, 3)) + Math.sin(age * 2.6 + r(4) * 6.28) * size * 0.35;
  const y = gy - gsize * 0.4 - (0.3 + r(5) * 0.5) * size * Math.sin(Math.min(1, p * 1.6) * Math.PI) + p * p * size * 1.1;
  const ang = side * 0.4 + Math.sin(age * 2.2 + r(6) * 6.28) * 0.7 + p * side * 1.2;
  return { x, y, ang, len: size * (0.85 + r(7) * 0.4), a: Math.min(1, age * 5) * Math.pow(1 - p, 0.7) };
}

function render(J: PackJ, env: LayoutEnv): PackBox | null {
  const { W, H, ctx } = env, text = clean(env.cut.text);
  if (!text) return null;
  const u = Math.min(W, H), bx = W * BAND.x, by = H * BAND.y, bw = W * BAND.w, bh = H * BAND.h;
  const box: PackBox = { x0: bx, y0: by, x1: bx + bw, y1: by + bh };
  if (env.pass !== 'main') return box;
  const k = motionOf(env), decor = decorOf(env), seed = Number(env.cut.seed ?? 1) | 0, lt = env.lt;
  const rows = lines(text), maxSize = Math.min(u * (W < H ? 0.085 : 0.066), H * 0.056);
  const fit = J.fitSize(rows, FONT, bw * 0.96, bh * 0.92, { lead: 1.42 });
  const size = Math.min(maxSize, fit / 1.16);
  const glyphs = layGlyphs(J, rows, size, W, H, seed), n = glyphs.length;
  const dur = Math.max(0.5, env.cut.dur), vis = easeOut(cap(env.pIn)) * (1 - easeInOut(cap(env.pOut)));
  const stagger = Math.min(0.09, (0.5 * dur) / Math.max(1, n)), din = k === 0 ? 0.001 : Math.max(0.3, Math.min(DUR_IN, dur * 0.35));
  const landed = (i: number) => i * stagger + din, entryEnd = landed(n - 1);
  const fg = env.sc.fg, feather = env.sc.accent2 ?? env.sc.fg;
  // 主役の語（漢字のいちばん多い語）は月の色。1 語だけの行は強調しない
  const words = new Map<number, number>();
  glyphs.forEach((g) => words.set(g.word, (words.get(g.word) ?? 0) + (KANJI.test(g.ch) ? 10 : 1)));
  let hero = -1, best = -1;
  if (words.size > 1) for (const [w, sc] of words) if (sc > best) { best = sc; hero = w; }
  // 退場: 文字が 1 字ずつ羽根になって散る（終わりの outLen 秒）
  const outLen = Math.min(0.7, dur * 0.25), exitStart = dur - outLen, sx = Math.min(0.035, (outLen * 0.5) / Math.max(1, n));
  const exitQ = (i: number) => (k === 0 ? cap(env.pOut) : cap((lt - exitStart - i * sx) / 0.28));
  // 止まったあとの 1 回の変化: 月の光が文字の上を左から右へなでる
  const sheenT = entryEnd + Math.min(0.35, Math.max(0, (exitStart - entryEnd) * 0.2)), sheenD = 0.75;
  const sheenP = k === 0 ? -1 : (lt - sheenT) / sheenD;
  const xs = glyphs.map((g) => g.x), x0 = Math.min(...xs) - size, x1 = Math.max(...xs) + size;
  // 月の満ち欠け: 前の行の形から、行の頭の 0.8 秒でなめらかに
  const ph = phaseOf(Number(env.cut.params.moon ?? 0.5), env.cut.params.waxing !== false), ph0 = Number(env.cut.params.moonFrom ?? ph);
  const [moonIllum, waxing] = fromPhase(k === 0 ? ph : ph0 + (ph - ph0) * easeInOut(cap(lt / 0.8)));

  ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
  try {
    // 月: 先頭の文字の左上にかかる位置に止める（横には動かさない）。文字にかかった部分は透かして抜く
    const first = glyphs[0], r = bh * 0.4;
    if (first) {
      const mx = first.x - first.size * 0.5, my = Math.max(by + r * 1.04, first.y - first.size * 0.5), pad = Math.ceil(r * 0.5), dim = Math.ceil(r * 2 + pad * 2);
      const sg = scratchOf(dim, dim);
      if (sg) {
        drawMoon(sg, dim / 2, dim / 2, r, moonIllum, waxing, 1, seed, J);
        const hx = dim / 2 + (first.x - mx), hy = dim / 2 + (first.y - my), hr = first.size * 0.78;
        const hole = sg.createRadialGradient(hx, hy, hr * 0.35, hx, hy, hr);
        hole.addColorStop(0, 'rgba(0,0,0,0.88)'); hole.addColorStop(1, 'rgba(0,0,0,0)');
        sg.globalCompositeOperation = 'destination-out'; sg.fillStyle = hole; sg.fillRect(0, 0, dim, dim);
        ctx.save(); ctx.globalAlpha = 0.82 * vis; ctx.drawImage(scratch as HTMLCanvasElement, mx - dim / 2, my - dim / 2); ctx.restore();
      } else drawMoon(ctx, mx, my, r, moonIllum, waxing, 0.5 * vis, seed, J);
    }
    if (k > 0 && decor > 0.02) {
      const per = decor > 0.6 ? 3 : 2;
      glyphs.forEach((gl, i) => {
        // 着地の羽根（文字の下に描く）
        for (let f = 0; f < per; f++) {
          const age = lt - landed(i) - f * 0.09, life = 1.4 + J.r(seed, i, f * 7 + 1) * 0.8;
          if (age < 0 || age > life || lt > exitStart + i * sx) continue;
          const fe = featherAt(J, seed, i, f, gl.x, gl.y, gl.size, size, age, life, 1);
          drawFeather(ctx, fe.x, fe.y, fe.len, fe.ang, fe.a * decor * vis, feather);
        }
        // 退場: 文字が羽根になる（2 枚、速く遠くへ）
        const eq = exitQ(i);
        if (eq > 0) for (let f = 0; f < 2; f++) {
          const age = (lt - exitStart - i * sx) * 1.6, fe = featherAt(J, seed + 77, i, f, gl.x, gl.y + gl.size * 0.3, gl.size, size, Math.max(0, age), 1.1, 1.3);
          drawFeather(ctx, fe.x, fe.y, fe.len * 1.1, fe.ang, fe.a * decor * Math.min(1, eq * 4), feather);
        }
        // 着地の瞬間の光の粒（2 つ、0.45 秒）
        const ga = lt - landed(i);
        if (ga >= 0 && ga < 0.45) for (let f = 0; f < 2; f++) {
          const q = ga / 0.45, side = f ? 1 : -1;
          drawGlint(ctx, gl.x + side * gl.size * (0.35 + q * 0.3), gl.y - gl.size * (0.45 + q * 0.25), size * 0.09 * (1 - q * 0.6), (1 - q) * 0.9 * decor, GOLD);
        }
      });
    }
    // 文字: 上か下から差し込む。定位置に近づいた側から見えてくる。少し行き過ぎて止まる
    glyphs.forEach((gl, i) => {
      const q = k === 0 ? 1 : cap((lt - i * stagger) / din), e = snapIn(q), m = 1 - Math.pow(1 - q, 3), eq = exitQ(i);
      const a = (1 - eq) * (k === 0 ? vis : 1);
      if (a <= 0.01) return;
      const dy = gl.dir * (1 - e) * size * 1.15 * k - eq * gl.size * 0.35 * k, x = gl.x, y = gl.y + dy;
      const scale = 1 - eq * 0.12, gsize = gl.size * scale;
      const color = gl.word === hero ? GOLD : fg;
      const cw = Math.ceil(gl.size * 1.7), ch = Math.ceil(gl.size * 1.9);
      const sg = q < 1 ? scratchOf(cw, ch) : null, target = sg ?? ctx;
      const ox = sg ? cw / 2 : x, oy = sg ? ch / 2 : y;
      target.save();
      target.font = (J as unknown as { fontCSS(f: string, s: number): string }).fontCSS(FONT, gsize);
      target.textAlign = 'center'; target.textBaseline = 'middle';
      target.shadowColor = 'rgba(0,0,0,0.6)'; target.shadowBlur = gl.size * 0.09; target.shadowOffsetY = gl.size * 0.03;
      target.fillStyle = color; if (!sg) target.globalAlpha = a;
      target.fillText(gl.ch, ox, oy);
      target.restore();
      if (sg) {
        // 進む側（上から来る字は下側、下から来る字は上側）から先に見えるマスク
        const mk = sg.createLinearGradient(0, 0, 0, ch);
        for (let st = 0; st <= 6; st++) {
          const uu = st / 6, v = gl.dir === -1 ? 1.5 * m - (1 - uu) * 0.5 : 1.5 * m - uu * 0.5;
          mk.addColorStop(uu, `rgba(0,0,0,${cap(v).toFixed(3)})`);
        }
        sg.globalCompositeOperation = 'destination-in'; sg.fillStyle = mk; sg.fillRect(0, 0, cw, ch);
        // 縦のぶれの残像（来た方向へ 2 枚、薄く）
        ctx.save();
        for (let t = 2; t >= 1; t--) { ctx.globalAlpha = a * 0.18 * (1 - m) / t; ctx.drawImage(scratch as HTMLCanvasElement, x - cw / 2, y - ch / 2 + gl.dir * size * 0.22 * t * k); }
        ctx.globalAlpha = a; ctx.drawImage(scratch as HTMLCanvasElement, x - cw / 2, y - ch / 2); ctx.restore();
      } else if (sheenP > 0 && sheenP < 1.3) {
        // 月の光がなでる: 光の帯の近くの文字だけ、淡い金色を重ねる
        const hx = x0 + (x1 - x0) * sheenP, d = (x - hx) / (size * 1.4), glow = Math.exp(-d * d) * 0.55 * decor;
        if (glow > 0.01) {
          ctx.save(); ctx.globalAlpha = glow * a; ctx.globalCompositeOperation = 'lighter';
          ctx.font = (J as unknown as { fontCSS(f: string, s: number): string }).fontCSS(FONT, gsize); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = GOLD; ctx.fillText(gl.ch, x, y); ctx.restore();
        }
      }
    });
    // 光の帯の先頭の小さなきらめき
    if (decor > 0.02 && sheenP > 0 && sheenP < 1) {
      const hx = x0 + (x1 - x0) * sheenP, top = Math.min(...glyphs.map((g) => g.y - g.size * 0.55));
      drawGlint(ctx, hx, top, size * 0.16, Math.sin(sheenP * Math.PI) * 0.9 * decor, GOLD);
    }
  } finally { ctx.restore(); }
  return box;
}

const effects = (J: PackJ): PackEffect[] => {
  const layoutDef = (key: string, name: string): PackEffect => ({
    group: 'layout', key, def: { name, fits: () => true, w: 1, portrait: 1, plan: (_rng: Rng) => ({ font: FONT }), render: (env: LayoutEnv) => render(J, env) },
  });
  const still = (_env: PackEnv): Record<string, never> => ({});
  return [
    layoutDef('vscMfCenter', '先頭の文字に月がかかる.c'),
    { group: 'enter', key: 'vscMfIn', def: { name: '字幕・差し込み（構図が描く）.c', inDur: (dur: number) => Math.min(0.5, dur * 0.3), apply: still } },
    { group: 'hold', key: 'vscMfHold', def: { name: '字幕・静止.c', apply: still } },
    { group: 'exit', key: 'vscMfOut', def: { name: '字幕・退場（構図が描く）.c', outDur: (dur: number) => Math.min(0.7, dur * 0.25), apply: still } },
    { group: 'cam', key: 'vscMfCam', def: { name: 'カメラ固定.c', get: () => ({ s: 1, x: 0, y: 0, rot: 0 }) } },
  ];
};

export const moonFeatherClaudePack: MotionPack = claudePack({
  id: MOONFEATHER_ID, name: '月と羽根・字幕', desc: '字幕の帯だけを使う。1 文字ずつ上下から差し込み、羽根が舞い、月が文字の後ろを横切る。区切りで月が満ち欠けする',
  fonts: { display: [FONT], body: [FONT], serif: [FONT] },
  scheme: { bg: '#05070f', fg: '#F6F0E2', sub: '#CFC8B8', accent: '#F3E4B0', accent2: '#EFE6D2', dim: '#1a1f2c' },
  effects,
});
