import type { PackBox, PackEffect, PackJ } from '../types';
import { clean, pad, union, type LayoutEnv, type Rng } from '../design-kit';
import { easeInOut, easeOut } from '../util';
import { cap, decorOf, ghostGlyph, local, micro, motionOf, phrases, rule, sideOf, sizeOf, visible } from './skin';
import { enterFx, exitFx, holdFx, easeOutBackQ } from './effects';
import { claudePack } from './build';

/**
 * 夏・波.c — 海の光。軽く、明るく、流れる。
 * 学び: 見立て（波の帯・シール・泡）／色面（太陽の円盤・水面）／巨大な薄い字／密度の緩急。文字は大きくしない。
 */
const FONT = 'round';
const first = (s: string): string => [...clean(s)].find((c) => c.trim()) ?? '';
function heroFit(J: PackJ, text: string, maxW: number, maxH: number, maxSize: number): { lines: string[]; size: number } {
  const split = J.splitLines(text, Math.max(2, Math.floor(maxW / Math.max(1, maxSize * 0.9))));
  const lines = Array.isArray(split) ? split : [split];
  return { lines, size: Math.min(maxSize, J.fitSize(lines, FONT, maxW, maxH)) };
}
/** 波の帯（画面の端から端まで。下の端まで塗る） */
function waveBand(env: LayoutEnv, yBase: number, amp: number, wl: number, phase: number, color: string, alpha: number): void {
  if (env.pass !== 'main' || alpha <= 0.01) return;
  const { W, H } = env, pts: [number, number][] = [];
  const n = 48;
  for (let i = 0; i <= n; i++) { const x = (W * i) / n; pts.push([x, yBase + Math.sin((x / wl) * Math.PI * 2 + phase) * amp]); }
  pts.push([W, H * 1.02], [0, H * 1.02]);
  env.poly(pts, color, alpha);
}

function render(J: PackJ, env: LayoutEnv, variant: number): PackBox | null {
  const { W, H, sc } = env, u = Math.min(W, H), portrait = W < H, side = sideOf(env), decor = decorOf(env), vis = visible(env), k = motionOf(env);
  const text = clean(env.cut.text);
  if (!text) return null;
  const sea = sc.accent, sun = sc.accent2 ?? sc.accent, phase = env.lt * 1.3 * k + Number(env.cut.params.phase ?? 0);
  const ph = phrases(env);
  let box: PackBox | null = null;
  const put = (item: Record<string, unknown>) => { box = union(box, J.mainDraw(env, item)); };
  const reveal = easeOut(cap(env.pIn * 1.5));

  if (variant === 0) {
    // 波の帯の上に文字。帯は画面の下 3 分の 1 を、位相をずらして 3 枚重ねる。太陽は右上の小さな円盤
    const { lines, size } = heroFit(J, ph.hero, W * (portrait ? 0.86 : 0.72), H * 0.26, u * (portrait ? 0.2 : 0.19));
    const m = sizeOf(J, lines, FONT, size), cx = W * 0.5, cy = H * (portrait ? 0.4 : 0.42);
    if (decor > 0.05) {
      env.circle(W * (0.5 + side * 0.32), H * 0.2, u * 0.085 * reveal, sun, null, 0, 0.95 * vis);
      env.circle(W * (0.5 + side * 0.32), H * 0.2, u * 0.125 * reveal, null, sun, Math.max(1, u * 0.003), 0.45 * vis);
    }
    waveBand(env, H * 0.72, u * 0.022, W * 0.55, phase, sea, 0.28 * decor * vis * reveal);
    waveBand(env, H * 0.78, u * 0.026, W * 0.42, phase * 1.2 + 1.7, sea, 0.38 * decor * vis * reveal);
    waveBand(env, H * 0.86, u * 0.03, W * 0.34, phase * 0.8 + 3.1, '#0A3B66', 0.9 * decor * vis * reveal);
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: sc.fg, mi: 0, shadow: { color: '#00203a99', blur: size * 0.12, dy: size * 0.04 } });
    const tsize = size * 0.28;
    if (ph.post.length) put({ text: ph.post.join(' '), font: FONT, size: tsize, x: cx + m.w / 2, y: cy + m.h / 2 + tsize * 1.3, color: sun, align: 'right', mi: 1 });
    if (ph.pre.length) put({ text: ph.pre.join(' '), font: FONT, size: tsize, x: cx - m.w / 2, y: cy - m.h / 2 - tsize * 1.2, color: sea, align: 'left', mi: 2 });
    micro(env, `SUMMER  No.${pad(env.cut.line + 1, 2)}`, W * 0.04, H * 0.07, u * 0.026, sc.sub ?? sc.fg, 0.8 * decor * vis);
    micro(env, '26.2°N  127.7°E', W * 0.96 - u * 0.3, H * 0.93, u * 0.022, sc.sub ?? sc.fg, 0.6 * decor * vis);
  } else if (variant === 1) {
    // シール: 白い台紙に載った主役（少し傾く）。後ろに大きな太陽の円盤。語尾は水色のタグ
    const { lines, size } = heroFit(J, ph.hero, W * (portrait ? 0.74 : 0.56), H * 0.24, u * (portrait ? 0.18 : 0.17));
    const m = sizeOf(J, lines, FONT, size), cx = W * 0.5 + side * W * 0.02, cy = H * 0.48, ang = -4 * side;
    if (decor > 0.05) env.circle(W * (0.5 - side * 0.2), H * 0.55, u * 0.3 * easeOut(cap(env.pIn * 1.3)), sun, null, 0, 0.92 * vis);
    const hw = m.w / 2 + size * 0.55, hh = m.h / 2 + size * 0.42, grow = easeOut(cap(env.pIn * 1.7));
    const card = (dx: number, dy: number): [number, number][] => [local(cx + dx, cy + dy, ang, -hw * grow, -hh), local(cx + dx, cy + dy, ang, hw * grow, -hh), local(cx + dx, cy + dy, ang, hw * grow, hh), local(cx + dx, cy + dy, ang, -hw * grow, hh)];
    env.poly(card(size * 0.07, size * 0.08), '#00203a', 0.35 * vis);
    env.poly(card(0, 0), '#FFFFFF', 0.98 * vis);
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: '#06304a', rot: ang, mi: 0 });
    const tsize = size * 0.3;
    const tags = [...ph.pre, ...ph.post].join(' ');
    if (tags) {
      const [tx, ty] = local(cx, cy, ang, hw * 0.92, hh + tsize * 1.1);
      put({ text: tags, font: FONT, size: tsize, x: tx, y: ty, color: sc.fg, rot: ang, align: 'right', mi: 1 });
    }
    waveBand(env, H * 0.9, u * 0.02, W * 0.4, phase, sea, 0.7 * decor * vis);
    micro(env, `SUMMER  No.${pad(env.cut.line + 1, 2)}`, W * 0.04, H * 0.07, u * 0.026, sc.sub ?? sc.fg, 0.8 * decor * vis);
  } else if (variant === 2) {
    // 水平線: 巨大な薄い字と、水平線に半分沈む太陽、水面の反射の縞。本文は水平線の上に小さく
    const horizon = H * (portrait ? 0.62 : 0.6), R = u * 0.2, sx = W * (0.5 + side * 0.18);
    ghostGlyph(env, first(text), W * 0.5, H * 0.58, u * 1.5, FONT, sea, 0.07 * decor * vis);
    if (decor > 0.05) {
      env.circle(sx, horizon, R * easeOut(cap(env.pIn * 1.3)), sun, null, 0, 0.95 * vis);
      env.rect(0, horizon, W, H - horizon, '#031a2e', 0.97 * vis);
      for (let i = 0; i < 7; i++) { const y = horizon + u * (0.018 + i * 0.022), w = R * 1.7 * (1 - i * 0.11) * (1 + Math.sin(phase + i) * 0.08); env.rect(sx - w / 2, y, w, Math.max(1.5, u * 0.007), sun, (0.7 - i * 0.09) * vis); }
    }
    rule(env, 0, horizon, W * reveal, horizon, sc.fg, u * 0.003, 0.8 * decor * vis);
    const { lines, size } = heroFit(J, ph.hero, W * 0.6, H * 0.14, u * (portrait ? 0.11 : 0.1));
    const m = sizeOf(J, lines, FONT, size), left = W * 0.08;
    put({ text: lines.join('\n'), font: FONT, size, x: left + m.w / 2, y: horizon - size * 1.2, color: sc.fg, mi: 0, shadow: { color: '#00203a99', blur: size * 0.1, dy: size * 0.03 } });
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) put({ text: rest, font: FONT, size: size * 0.32, x: left + m.w + size * 0.3, y: horizon - size * 0.75, color: sun, align: 'left', mi: 1 });
    micro(env, `HORIZON  ${pad(env.cut.line + 1, 2)}`, W * 0.04, H * 0.07, u * 0.026, sc.sub ?? sc.fg, 0.8 * decor * vis);
  } else {
    // 泡: 文字が 1 つずつ泡に入って浮かぶ（2〜7 字）。泡は拍ではなくゆっくり揺れる
    const chars = [...text].filter((c) => c.trim()), n = chars.length, cols = portrait ? Math.min(n, 3) : n, rowsN = Math.ceil(n / cols);
    const pitch = Math.min((W * 0.86) / cols, (H * 0.56) / rowsN, u * 0.3), r = pitch * 0.42, size = r * 1.05;
    chars.forEach((ch, i) => {
      const row = Math.floor(i / cols), c = i % cols, cnt = Math.min(cols, n - row * cols);
      const bob = Math.sin(phase * 0.8 + i * 1.7) * u * 0.018 * k, x = W / 2 + (c - (cnt - 1) / 2) * pitch, y = H * 0.5 + (row - (rowsN - 1) / 2) * pitch * 1.05 + bob;
      const a = easeOut(cap(env.pIn * 1.6 - i * 0.1)) * (1 - easeInOut(cap(env.pOut)));
      env.circle(x, y, r, '#FFFFFF', null, 0, 0.1 * a * (decor > 0.05 ? 1 : 0.4));
      env.circle(x, y, r, null, '#FFFFFF', Math.max(1.2, u * 0.003), 0.7 * a);
      env.circle(x - r * 0.38, y - r * 0.42, r * 0.12, '#FFFFFF', null, 0, 0.8 * a);
      put({ text: ch, font: FONT, size, x, y, color: sc.fg, mi: i });
    });
    waveBand(env, H * 0.88, u * 0.02, W * 0.4, phase, sea, 0.6 * decor * vis);
    micro(env, `BUBBLE  ${pad(n, 2)}`, W * 0.04, H * 0.07, u * 0.026, sc.sub ?? sc.fg, 0.8 * decor * vis);
  }
  return box;
}

const effects = (J: PackJ): PackEffect[] => {
  const layoutDef = (variant: number, key: string, name: string, fits: (n: number) => boolean, w: number): PackEffect => ({
    group: 'layout', key, def: { name, fits, w, portrait: 1, plan: (rng: Rng) => ({ font: FONT, side: rng.pick([-1, 1]), phase: rng.range(0, 6) }), render: (env: LayoutEnv) => render(J, env, variant) },
  });
  return [
    layoutDef(0, 'vscSummerWave', '波の帯の上に文字.c', () => true, 3),
    layoutDef(1, 'vscSummerSticker', 'シールと太陽.c', () => true, 2),
    layoutDef(2, 'vscSummerHorizon', '水平線の太陽.c', () => true, 2),
    layoutDef(3, 'vscSummerBubble', '泡に入る文字.c', (n) => n >= 2 && n <= 7, 1.4),
    // 登場: 水面から跳ね上がり、少し行き過ぎて戻る（語ごとに遅れる）
    enterFx('vscSummerSplash', '水面から跳ね上がる.c', 0.5, 0.45, (q, i, _n, it, k) => { const e = easeOutBackQ(q, 1.8); return { dy: (1 - e) * it.size * 0.9 * k * (i % 2 ? 1 : 0.8), s: 0.7 + 0.3 * e, a: cap(q * 4) }; }),
    exitFx('vscSummerWash', '波にさらわれる.c', 0.5, 0.4, (q, i, _n, it, k) => ({ dx: q * it.size * (1.2 + (i % 3) * 0.3) * k, dy: Math.sin(i * 1.3) * q * it.size * 0.3 * k, a: 1 - q })),
    holdFx('vscSummerBob', '波に揺れる.c', (t, amt, i, _n, it, k) => ({ dy: Math.sin(t * 2.2 - i * 0.55) * it.size * 0.06 * k * amt, rot: Math.cos(t * 2.2 - i * 0.55) * 1.6 * k * amt })),
  ];
};

export const summerClaudePack = claudePack({
  id: 'Summer', name: '夏・波', desc: '海の光。波の帯・シール・水平線・泡。主役は小さめに、色面と巨大な薄い字で画面を作る',
  fonts: { display: [FONT], body: [FONT], serif: [FONT] },
  scheme: { bg: '#031a2e', fg: '#F6FFFF', sub: '#9FE8FF', accent: '#35D0FF', accent2: '#FFC857', dim: '#062a45' },
  effects,
});
