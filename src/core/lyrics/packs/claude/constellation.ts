import type { PackBox, PackEffect, PackJ } from '../types';
import { clean, pad, timecode, union, type LayoutEnv, type Rng } from '../design-kit';
import { easeInOut, easeOut } from '../util';
import { cap, decorOf, ghostGlyph, micro, motionOf, phrases, rule, sideOf, sizeOf, visible } from './skin';
import { enterFx, exitFx, holdFx } from './effects';
import { claudePack } from './build';

/**
 * 星図・観測.c — 静かな広がり。星と線と観測の書き込み。
 * 学び: 見立て（星座・軌道・観測グリッド）／巨大な薄い字／小さな文字の土台（座標・ラベル）。読む順に線が伸び、結ばれた字が星になる。
 */
const FONT = 'klee';
const first = (s: string): string => [...clean(s)].find((c) => c.trim()) ?? '';
function heroFit(J: PackJ, text: string, maxW: number, maxH: number, maxSize: number): { lines: string[]; size: number } {
  const split = J.splitLines(text, Math.max(2, Math.floor(maxW / Math.max(1, maxSize * 0.9))));
  const lines = Array.isArray(split) ? split : [split];
  return { lines, size: Math.min(maxSize, J.fitSize(lines, FONT, maxW, maxH)) };
}
/** 背景の星の粒（決まった式でまたたく）。画面全体 */
function starfield(J: PackJ, env: LayoutEnv, count: number, alpha: number): void {
  if (env.pass !== 'main' || alpha <= 0.01) return;
  const { W, H, sc } = env, u = Math.min(W, H), seed = env.cut.seed ?? 1, t = env.lt * motionOf(env);
  for (let i = 0; i < count; i++) {
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * (1 + J.r(seed, i, 71) * 2) + i));
    env.circle(W * J.r(seed, i, 72), H * J.r(seed, i, 73), u * (0.0014 + J.r(seed, i, 74) * 0.0026), sc.fg, null, 0, alpha * tw * (0.3 + J.r(seed, i, 75) * 0.7));
  }
}
function star(env: LayoutEnv, x: number, y: number, r: number, color: string, a: number): void {
  if (env.pass !== 'main' || a <= 0.01) return;
  const u = Math.min(env.W, env.H);
  env.circle(x, y, r * 1.7, color, null, 0, 0.08 * a); env.circle(x, y, r * 1.05, color, null, 0, 0.16 * a); env.circle(x, y, Math.max(1.5, r * 0.12), '#FFFFFF', null, 0, 0.95 * a);
  env.line([[x - r, y], [x + r, y]], color, Math.max(0.8, u * 0.0016), 0.6 * a); env.line([[x, y - r], [x, y + r]], color, Math.max(0.8, u * 0.0016), 0.6 * a);
}

function render(J: PackJ, env: LayoutEnv, variant: number): PackBox | null {
  const { W, H, sc } = env, u = Math.min(W, H), portrait = W < H, side = sideOf(env), decor = decorOf(env), vis = visible(env), k = motionOf(env);
  const text = clean(env.cut.text);
  if (!text) return null;
  const blue = sc.accent, gold = sc.accent2 ?? sc.accent, ph = phrases(env), reveal = easeOut(cap(env.pIn * 1.4));
  const start = Number.isFinite(env.cut.start) ? env.cut.start : 0;
  let box: PackBox | null = null;
  const put = (item: Record<string, unknown>) => { box = union(box, J.mainDraw(env, item)); };

  if (variant === 0) {
    // 星座: 字が星になり、読む順に線で結ばれる。星は字の上、字は星の下
    const chars = [...text].filter((c) => c.trim()), n = chars.length, size = Math.min(u * 0.1, (W * 0.8) / n / 1.2);
    const pts = chars.map((_, i): [number, number] => [W * (0.12 + (n > 1 ? (i / (n - 1)) * 0.76 : 0.38)), H * (0.46 + Math.sin(i * 2.1 + side) * (portrait ? 0.16 : 0.2))]);
    starfield(J, env, portrait ? 90 : 140, 0.85 * decor * vis);
    for (let i = 0; i < n - 1; i++) {
      const e = easeOut(cap(env.pIn * 2.2 - i * 0.22)); if (e <= 0) continue;
      const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!;
      env.line([[ax, ay], [ax + (bx - ax) * e, ay + (by - ay) * e]], blue, Math.max(1.2, u * 0.0032), 0.9 * decor * vis);
    }
    chars.forEach((ch, i) => {
      const [x, y] = pts[i]!, lit = easeOut(cap(env.pIn * 2.2 - i * 0.22 + 0.3)) * (1 - easeInOut(cap(env.pOut)));
      star(env, x, y, size * 0.9, gold, lit * decor);
      micro(env, `α${i + 1}`, x + size * 0.18, y - size * 0.3, u * 0.02, blue, 0.75 * lit * decor);
      put({ text: ch, font: FONT, size, x, y: y + size * 1.05, color: sc.fg, mi: i });
    });
    micro(env, `CONSTELLATION  No.${pad(env.cut.line + 1, 2)}`, W * 0.04, H * 0.07, u * 0.026, blue, 0.8 * decor * vis);
  } else if (variant === 1) {
    // 軌道: 主役は小さめに中央、まわりを同じ語の小さな字が楕円の軌道で回る
    const { lines, size } = heroFit(J, ph.hero, W * (portrait ? 0.78 : 0.5), H * 0.16, u * (portrait ? 0.11 : 0.1)), cx = W / 2, cy = H / 2;
    starfield(J, env, 70, 0.7 * decor * vis);
    const rings = [[u * 0.3, u * 0.12], [u * 0.44, u * 0.19]] as const, tilt = -0.3 * side;
    const ellipse = (rx: number, ry: number, a: number) => { const pts: [number, number][] = []; for (let i = 0; i <= 64; i++) { const t = (i / 64) * Math.PI * 2, x = Math.cos(t) * rx, y = Math.sin(t) * ry; pts.push([cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)]); } env.line(pts, blue, Math.max(1, u * 0.0022), a); };
    if (env.pass === 'main' && decor > 0.05) for (const [rx, ry] of rings) ellipse(rx * reveal, ry * reveal, 0.4 * vis);
    const chars = [...text].filter((c) => c.trim());
    chars.forEach((ch, i) => {
      const [rx, ry] = rings[i % 2]!, ang = env.lt * 0.35 * k * (i % 2 ? -1 : 1) + (i * Math.PI * 2) / chars.length, x = Math.cos(ang) * rx, y = Math.sin(ang) * ry;
      env.draw({ text: ch, font: FONT, size: u * 0.034, x: cx + x * Math.cos(tilt) - y * Math.sin(tilt), y: cy + x * Math.sin(tilt) + y * Math.cos(tilt), color: gold, alpha: 0.9 * decor * vis * reveal });
    });
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: sc.fg, mi: 0, shadow: { color: '#03060f', blur: size * 0.5, dy: 0 } });
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) micro(env, rest, cx - sizeOf(J, lines, FONT, size).w / 2, cy + size * 1.4, u * 0.03, blue, 0.85 * decor * vis);
    micro(env, `ORBIT  ${timecode(start)}`, W * 0.04, H * 0.07, u * 0.026, blue, 0.8 * decor * vis);
  } else if (variant === 2) {
    // 巨大な薄い字 + 観測の書き込み: 小さな本文から細い線が星へ伸び、ラベルが付く
    ghostGlyph(env, first(text), W * (0.5 + side * 0.12), H * 0.52, u * 1.7, FONT, blue, 0.07 * decor * vis);
    starfield(J, env, 60, 0.7 * decor * vis);
    const { lines, size } = heroFit(J, ph.hero, W * 0.55, H * 0.12, u * 0.07), m = sizeOf(J, lines, FONT, size), left = W * 0.09, y = H * 0.68, sx = W * 0.78, sy = H * 0.22;
    if (env.pass === 'main' && decor > 0.05) env.line([[left + m.w + size * 0.3, y - size * 0.2], [left + m.w + size * 0.3 + (sx - left - m.w - size * 0.3) * reveal, y - size * 0.2 + (sy - y + size * 0.2) * reveal]], blue, Math.max(1, u * 0.002), 0.7 * vis);
    star(env, sx, sy, u * 0.05, gold, reveal * decor * vis);
    micro(env, `name: ${first(text)}`, sx + u * 0.04, sy - u * 0.02, u * 0.026, blue, 0.9 * reveal * decor * vis);
    put({ text: lines.join('\n'), font: FONT, size, x: left + m.w / 2, y, color: sc.fg, mi: 0 });
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) put({ text: rest, font: FONT, size: size * 0.4, x: left, y: y + size * 1.1, color: gold, align: 'left', mi: 1 });
    micro(env, `${pad(env.cut.line + 1, 2)} / ${timecode(start)}`, W * 0.04, H * 0.93, u * 0.024, blue, 0.6 * decor * vis);
  } else {
    // 観測グリッド: 細い格子と十字、四隅の括弧。主役は小さめに中央。座標が縁に並ぶ
    const { lines, size } = heroFit(J, ph.hero, W * (portrait ? 0.8 : 0.56), H * 0.2, u * (portrait ? 0.14 : 0.13)), cx = W / 2, cy = H / 2, m = sizeOf(J, lines, FONT, size);
    starfield(J, env, 50, 0.6 * decor * vis);
    if (env.pass === 'main' && decor > 0.05) {
      for (let i = 1; i < 8; i++) env.line([[(W * i) / 8, 0], [(W * i) / 8, H * reveal]], blue, Math.max(0.8, u * 0.0012), 0.14 * vis);
      for (let i = 1; i < 6; i++) env.line([[0, (H * i) / 6], [W * reveal, (H * i) / 6]], blue, Math.max(0.8, u * 0.0012), 0.14 * vis);
      const bx = m.w / 2 + size * 0.8, by = m.h / 2 + size * 0.8, c = size * 0.5;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) env.line([[cx + sx * bx, cy + sy * by - sy * c], [cx + sx * bx, cy + sy * by], [cx + sx * bx - sx * c, cy + sy * by]], gold, Math.max(1.2, u * 0.003), 0.9 * vis * reveal);
    }
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: sc.fg, mi: 0, shadow: { color: '#03060f', blur: size * 0.4, dy: 0 } });
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) micro(env, rest, cx - m.w / 2, cy + m.h / 2 + size * 1.5, u * 0.03, blue, 0.85 * decor * vis);
    for (let i = 0; i < 8; i++) micro(env, pad(i * 45, 3), (W * i) / 8 + 4, H * 0.025 + 8, u * 0.018, blue, 0.5 * decor * vis);
    micro(env, `GRID  ${timecode(start)}`, W * 0.04, H * 0.93, u * 0.024, blue, 0.7 * decor * vis);
    void rule;
  }
  return box;
}

const effects = (J: PackJ): PackEffect[] => {
  const layoutDef = (variant: number, key: string, name: string, fits: (n: number) => boolean, w: number): PackEffect => ({
    group: 'layout', key, def: { name, fits, w, portrait: 1, plan: (rng: Rng) => ({ font: FONT, side: rng.pick([-1, 1]) }), render: (env: LayoutEnv) => render(J, env, variant) },
  });
  return [
    layoutDef(0, 'vscConstStars', '星座を結ぶ.c', (n) => n >= 2 && n <= 10, 2.4),
    layoutDef(1, 'vscConstOrbit', '軌道を回る字.c', () => true, 2),
    layoutDef(2, 'vscConstLabel', '巨大な薄い字と観測の書き込み.c', () => true, 2),
    layoutDef(3, 'vscConstGrid', '観測グリッド.c', () => true, 1.6),
    // 登場: 小さく灯って、決まった大きさになる（読む順に遅れる）
    enterFx('vscConstLight', '星のように灯る.c', 0.7, 0.6, (q, _i, _n, it, k) => ({ s: 1 - (1 - easeOut(q)) * 0.4 * k, a: easeOut(q), dy: (1 - easeOut(q)) * it.size * 0.1 * k })),
    exitFx('vscConstFade', '星が消える.c', 0.5, 0.4, (q) => ({ a: 1 - easeInOut(q) })),
    holdFx('vscConstTwinkle', '微かにまたたく.c', (t, amt, i, _n, _it, k) => ({ s: 1 + Math.sin(t * 1.4 + i * 0.9) * 0.008 * k * amt })),
  ];
};

export const constellationClaudePack = claudePack({
  id: 'Constellation', name: '星図・観測', desc: '星座・軌道・観測グリッド。字が星になり、読む順に線で結ばれる。巨大な薄い字と観測の書き込み',
  fonts: { display: [FONT], body: [FONT], serif: [FONT] },
  scheme: { bg: '#03060f', fg: '#F3F7FF', sub: '#AAC8FF', accent: '#AAC8FF', accent2: '#FFE9A8', dim: '#0a1226' },
  effects,
});
