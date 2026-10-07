import type { PackBox, PackEffect, PackEnv, PackJ } from '../../types';
import { clean, pad, union, type LayoutEnv, type Rng } from '../../design-kit';
import { easeOut } from '../../util';
import { beatHit, cap, decorOf, micro, motionOf, phrases, sideOf, sizeOf, visible } from '../skin';
import { enterFx, exitFx, holdFx } from '../effects';
import { claudePack } from '../build';
import { brush, focus, grain, rough, splatter, fillAll, type G } from './kit';
import { layerOf, place, richOf } from './layer';

/**
 * ハイパー・飛沫.c — 質感つきの派手さ。黒地にピンクとシアンのインクの飛沫・かすれた筆跡・集中線。主役は傾けて硬い影を重ねる。
 * 試作: docs/art-studies/rich-compositions.html の A1〜A4。背景の質感はカットごとに 1 枚へ描いて使い回す（rich/layer.ts）。
 */
const FONT = 'gothic_black';
const PINK = '#ff3db8', CYAN = '#29e6ff', INK = '#07070b';
const first = (s: string): string => [...clean(s)].find((c) => c.trim()) ?? '';
function heroFit(J: PackJ, text: string, maxW: number, maxH: number, maxSize: number): { lines: string[]; size: number } {
  // まず 1 行で収まるか。大きさが上限の 55 % 以上なら折り返さない（短い文が不必要に折れて小さくならない）
  const one = J.fitSize([text], FONT, maxW, maxH);
  if (one >= maxSize * 0.55) return { lines: [text], size: Math.min(maxSize, one) };
  const split = J.splitLines(text, Math.max(2, Math.ceil([...text].length / 2)));
  const lines = Array.isArray(split) ? split : [split];
  return { lines, size: Math.min(maxSize, J.fitSize(lines, FONT, maxW, maxH)) };
}

/** 背景の層（遠い）と、飛沫・筆跡の層（近い）を描く。座標は設計サイズ（W×H）の割合 */
function paintFar(g: G, W: number, H: number, v: number, seed: number, glyph: string): void {
  const u = Math.min(W, H);
  fillAll(g, W, H, INK);
  if (v === 0) focus(g, W * 0.46, H * 0.5, '#ffffff', 90, u * 0.14, Math.max(W, H) * 0.6, 0.06, seed + 5);
  else if (v === 1) focus(g, W * 0.5, H * 0.5, PINK, 70, u * 0.16, Math.max(W, H) * 0.6, 0.07, seed + 6);
  else if (v === 3) { g.save(); g.globalAlpha = 0.13; g.fillStyle = PINK; g.font = `900 ${u * 1.5}px "Noto Sans JP", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.transform(1, 0, -0.2, 1, 0, 0); g.fillText(glyph, (W * 0.66) + u * 0.1, H * 0.56); g.restore(); focus(g, W * 0.7, H * 0.5, CYAN, 50, u * 0.2, Math.max(W, H) * 0.6, 0.05, seed + 7); }
  grain(g, W, H, 0.12);
}
function paintNear(g: G, W: number, H: number, v: number, seed: number): void {
  const u = Math.min(W, H), s = seed;
  if (v === 0) {
    splatter(g, W * 0.04, H * 0.33, u * 0.17, PINK, s + 11, 0.12, 0.7, 120); brush(g, -W * 0.02, H * 0.55, W * 0.32, H * 0.44, u * 0.13, PINK, s + 21, 0.95); brush(g, 0, H * 0.93, W * 0.28, H * 0.86, u * 0.08, PINK, s + 22, 0.8);
    splatter(g, W * 0.97, H * 0.98, u * 0.16, CYAN, s + 12, Math.PI + 0.1, 0.7, 120); brush(g, W * 1.02, H * 0.81, W * 0.55, H * 0.93, u * 0.13, CYAN, s + 23, 0.95); brush(g, W, H * 0.37, W * 0.72, H * 0.44, u * 0.075, CYAN, s + 24, 0.8);
  } else if (v === 1) {
    rough(g, [[-W * 0.03, H * 0.53], [W * 1.03, H * 0.19], [W * 1.03, H * 0.51], [-W * 0.03, H * 0.83]], PINK, u * 0.04, s + 41);
    rough(g, [[-W * 0.03, H * 0.49], [W * 1.03, H * 0.16], [W * 1.03, H * 0.19], [-W * 0.03, H * 0.52]], CYAN, u * 0.025, s + 42, 0.95);
    splatter(g, W * 0.07, H * 0.85, u * 0.05, CYAN, s + 43, -0.4, 1.1, 70);
  } else if (v === 2) {
    brush(g, -W * 0.01, H * 0.15, W * 0.22, H * 0.11, u * 0.045, CYAN, s + 51, 0.9); brush(g, W * 1.01, H * 0.87, W * 0.7, H * 0.9, u * 0.05, PINK, s + 52, 0.9); splatter(g, W * 0.97, H * 0.22, u * 0.05, CYAN, s + 53, Math.PI, 0.8, 70);
  } else {
    splatter(g, W * 0.98, H * 0.15, u * 0.08, CYAN, s + 61, 2.8, 0.8, 80); brush(g, -W * 0.01, H * 0.87, W * 0.3, H * 0.79, u * 0.074, PINK, s + 62, 0.95);
  }
}

function render(J: PackJ, env: LayoutEnv, v: number): PackBox | null {
  const { W, H } = env, u = Math.min(W, H), portrait = W < H, side = sideOf(env), decor = decorOf(env), vis = visible(env), k = motionOf(env), seed = (env.cut.seed ?? 1) | 0;
  const text = clean(env.cut.text); if (!text) return null;
  const rich = richOf(env), beat = beatHit(env), ph = phrases(env);
  let box: PackBox | null = null;
  const put = (item: Record<string, unknown>) => { box = union(box, J.mainDraw(env, item)); };
  const far = layerOf(`hx:far:${v}:${W}x${H}:${seed}:${first(text)}`, W, H, (g) => paintFar(g, W, H, v, seed, first(text)));
  const near = layerOf(`hx:near:${v}:${W}x${H}:${seed}`, W, H, (g) => paintNear(g, W, H, v, seed));
  place(env, far, { enter: 'fade', pulse: 0.012, alpha: rich }, beat.hit, k);
  place(env, near, { enter: v === 1 ? 'slideL' : 'slideR', dist: 0.14, pulse: 0.03, drift: 0.004, alpha: rich, delay: 0.05 }, beat.hit, k);
  const tint = side > 0 ? 1 : -1;
  const extr = (size: number, col = PINK) => ({ n: 8, dx: size * 0.075 * tint, dy: size * 0.065, color: col });

  if (v === 0) {
    const { lines, size } = heroFit(J, ph.hero, W * (portrait ? 0.9 : 0.8), H * (portrait ? 0.32 : 0.46), u * (portrait ? 0.3 : 0.36));
    const m = sizeOf(J, lines, FONT, size), cx = W * (portrait ? 0.5 : 0.46), cy = H * (portrait ? 0.46 : 0.5);
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: '#ffffff', skew: -16 * tint, rot: -2.3 * tint, extrude: extr(size), mi: 0 });
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) micro(env, rest, cx + m.w * 0.18, cy + m.h / 2 + size * 0.5, size * 0.17, CYAN, 0.95 * vis * (decor > 0.05 ? 1 : 0), { track: 0.5 });
    for (let i = 0; i < 7; i++) if (env.pass === 'main' && decor > 0.05) env.line([[cx - m.w / 2 - size * 0.4 + i * u * 0.011, cy], [cx - m.w / 2 - size * 0.4 + i * u * 0.011, cy + u * 0.022]], PINK, Math.max(1.5, u * 0.003), 0.9 * vis);
  } else if (v === 1) {
    const { lines, size } = heroFit(J, ph.hero, W * (portrait ? 0.86 : 0.72), H * 0.36, u * (portrait ? 0.27 : 0.32));
    const m = sizeOf(J, lines, FONT, size), cx = W * 0.5, cy = H * 0.5, rot = -10 * tint;
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: '#ffffff', skew: -12 * tint, rot, extrude: { n: 7, dx: size * 0.05 * tint, dy: size * 0.07, color: '#5a0f40' }, mi: 0 });
    const tsize = size * 0.26, rad = (rot * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
    const at = (dx: number, dy: number): [number, number] => [cx + dx * c - dy * s, cy + dx * s + dy * c];
    if (ph.post.length) { const [x, y] = at(m.w / 2, m.h / 2 + tsize * 1.4); put({ text: ph.post.join(' '), font: FONT, size: tsize, x, y, color: CYAN, rot, align: 'right', mi: 1 }); }
    if (ph.pre.length) { const [x, y] = at(-m.w / 2, -(m.h / 2 + tsize * 1.2)); put({ text: ph.pre.join(' '), font: FONT, size: tsize, x, y, color: CYAN, rot, align: 'left', mi: 2 }); }
  } else if (v === 2) {
    const { lines, size } = heroFit(J, ph.hero, W * 0.84, H * 0.3, u * 0.28), cx = W * 0.5, cy = H * 0.5, rows = 3;
    for (let i = -rows; i <= rows; i++) {
      if (!i || env.pass !== 'main' || decor <= 0.05) continue;
      const d = Math.abs(i), a = (0.55 - d * 0.1) * vis * easeOut(cap(env.pIn * 1.6 - d * 0.15)) * rich;
      env.draw({ text: lines.join('\n'), font: FONT, size, x: cx + i * size * 0.07, y: cy + i * size * 0.46, color: i < 0 ? CYAN : PINK, alpha: a, fill: false, stroke: Math.max(1.5, u * 0.003), skew: -12 * tint });
    }
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: '#ffffff', skew: -12 * tint, extrude: extr(size), mi: 0 });
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) micro(env, rest, W * 0.06, H * 0.92, u * 0.026, CYAN, 0.9 * vis * (decor > 0.05 ? 1 : 0), { track: 0.5 });
  } else {
    const { lines, size } = heroFit(J, ph.hero, W * 0.6, H * 0.22, u * (portrait ? 0.15 : 0.2)), cx = W * (portrait ? 0.5 : 0.3), cy = H * (portrait ? 0.7 : 0.62);
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: '#ffffff', skew: -14 * tint, extrude: { n: 5, dx: size * 0.06 * tint, dy: size * 0.06, color: PINK }, mi: 0 });
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) micro(env, rest, cx - sizeOf(J, lines, FONT, size).w / 2, cy + size * 0.95, size * 0.2, CYAN, 0.9 * vis * (decor > 0.05 ? 1 : 0), { track: 0.5 });
    if (decor > 0.05 && env.pass === 'main') for (let i = 0; i < 12; i++) env.line([[W * 0.04 + i * u * 0.012, H * 0.07], [W * 0.04 + i * u * 0.012, H * 0.07 + (i % 4 ? u * 0.012 : u * 0.026)]], CYAN, Math.max(1.5, u * 0.003), 0.9 * vis);
    micro(env, `No.${pad(env.cut.line + 1, 2)}`, W * 0.04, H * 0.13, u * 0.024, CYAN, 0.8 * vis * (decor > 0.05 ? 1 : 0));
  }
  return box;
}

const effects = (J: PackJ): PackEffect[] => {
  const layoutDef = (v: number, key: string, name: string, w: number): PackEffect => ({
    group: 'layout', key, def: { name, fits: () => true, w, portrait: 1, plan: (rng: Rng) => ({ font: FONT, side: rng.pick([-1, 1]) }), render: (env: LayoutEnv) => render(J, env, v) },
  });
  return [
    layoutDef(0, 'vscHxImpact', '衝撃（集中線と飛沫）.c', 3), layoutDef(1, 'vscHxSlab', '破れた斜めの帯.c', 2.4), layoutDef(2, 'vscHxEcho', '輪郭の反復.c', 1.8), layoutDef(3, 'vscHxGhost', '巨大な薄い字.c', 1.6),
    enterFx('vscHxSlam', '叩きつけ.c', 0.3, 0.3, (q, i, _n, it, kk) => { const e = 1 - (1 - q) ** 4; return { s: 1 + (1 - e) * 1.1 * kk, a: cap(e * 6), rot: (1 - e) * (i % 2 ? 7 : -7) * kk, dy: -(1 - e) * it.size * 0.22 * kk }; }),
    enterFx('vscHxSweep', '横から滑り込む.c', 0.34, 0.5, (q, _i, _n, it, kk) => ({ dx: -(1 - easeOut(q)) * it.size * 0.8 * kk, a: easeOut(q) })),
    exitFx('vscHxDrop', '主役が落ちる.c', 0.2, 0, (q, i, _n, it, kk) => ({ s: 1 - q * 0.12 * kk, dy: q * q * it.size * 0.5 * kk, a: 1 - cap(q * 1.3), rot: (i % 2 ? 1 : -1) * q * 8 * kk })),
    exitFx('vscHxSlice', '切れてずれる.c', 0.22, 0, (q, i, _n, it, kk) => ({ dx: (i % 2 ? 1 : -1) * q * it.size * 0.7 * kk, a: 1 - cap(q * 1.2) })),
    holdFx('vscHxBeat', '拍で脈打つ.c', (_t, amt, _i, _n, _it, kk, env: PackEnv) => {
      const b = env.beat && env.beat.len > 0 ? env.beat : { index: Math.floor(env.lt / 0.5), since: env.lt % 0.5, len: 0.5 };
      const every = Math.max(1, Math.ceil(1 / (3 * b.len) - 1e-9));
      return { s: 1 + (b.index % every === 0 ? Math.exp(-b.since * 11) : 0) * 0.04 * kk * amt };
    }),
  ];
};

export const splashClaudePack = claudePack({
  id: 'HyperX', name: 'ハイパー・飛沫', desc: 'インクの飛沫・かすれた筆跡・集中線。傾けた主役に硬い影。質感つき（背景はカットごとに 1 枚描いて使い回す）',
  fonts: { display: [FONT], body: [FONT], serif: [FONT] },
  scheme: { bg: INK, fg: '#FFFFFF', sub: '#FFFFFF', accent: PINK, accent2: CYAN, dim: '#15151c' },
  effects,
});
