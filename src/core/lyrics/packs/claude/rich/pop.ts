import type { PackBox, PackEffect, PackEnv, PackJ } from '../../types';
import { clean, pad, union, type LayoutEnv, type Rng } from '../../design-kit';
import { easeOut } from '../../util';
import { beatHit, cap, micro, motionOf, phrases, sideOf, sizeOf, visible } from '../skin';
import { enterFx, exitFx, holdFx, easeOutBackQ } from '../effects';
import { claudePack } from '../build';
import { fitHero, frame, on } from './common';
import { fillAll, grain, halftone, rough, splatter, starburst, type G } from './kit';
import { layerOf, place, richOf } from './layer';

/**
 * ポップ・爆発.c — 黄色の地のコミック。ハーフトーン・破れた帯・星型の爆発・シール・斜めの二分割。主役は白に太い黒縁。
 * 試作: docs/art-studies/rich-compositions.html の B1〜B4。
 */
const FONT = 'gothic_black';
const YEL = '#ffe500', INK = '#111111', PINK = '#ff3db8', CYAN = '#29e6ff', ORG = '#ff7a1a', RED = '#ff2a2a', PUR = '#7a5cff';

function paintFar(g: G, W: number, H: number, v: number, seed: number): void {
  const u = Math.min(W, H);
  if (v === 0) {
    fillAll(g, W, H, YEL); halftone(g, 0, 0, W, H, u * 0.034, INK, 0.9, (x, y) => Math.min(1, Math.max(0, 1.15 - x * 1.2 - (1 - y) * 0.1)), 0.6); halftone(g, 0, 0, W, H, u * 0.026, PINK, 0.7, (x, y) => Math.min(1, Math.max(0, x * 1.3 - 0.45 - y * 0.2)), 0.3);
    rough(g, [[-W * 0.03, H * 0.76], [W * 1.03, H * 0.33], [W * 1.03, H * 0.53], [-W * 0.03, H * 0.94]], INK, u * 0.035, seed + 31); rough(g, [[-W * 0.03, H * 0.67], [W * 1.03, H * 0.25], [W * 1.03, H * 0.31], [-W * 0.03, H * 0.73]], PINK, u * 0.025, seed + 32);
  } else if (v === 1) {
    fillAll(g, W, H, YEL); halftone(g, 0, 0, W, H, u * 0.034, ORG, 0.5, (x, y) => Math.min(1, Math.max(0, 0.9 - Math.hypot(x - 0.5, y - 0.5) * 1.4)), 0.4);
    starburst(g, W * 0.5, H * 0.5, u * 0.44, u * 0.9, 14, INK, 1, 0.1); starburst(g, W * 0.5, H * 0.5, u * 0.4, u * 0.83, 14, RED, 1, 0.1);
  } else if (v === 2) {
    fillAll(g, W, H, YEL); halftone(g, 0, 0, W, H, u * 0.037, INK, 0.25, (_x, y) => 1 - y, 0.5);
  } else {
    fillAll(g, W, H, PINK); g.save(); g.fillStyle = CYAN; g.beginPath(); g.moveTo(W * 0.62, 0); g.lineTo(W, 0); g.lineTo(W, H); g.lineTo(W * 0.38, H); g.fill(); g.restore();
    halftone(g, W * 0.3, 0, W * 0.5, H, u * 0.034, INK, 0.55, (x) => Math.min(1, Math.max(0, 1 - Math.abs(x - 0.5) * 3)), 0.9);
  }
  grain(g, W, H, v === 0 ? 0.16 : 0.14);
}
function paintNear(g: G, W: number, H: number, v: number, seed: number): void {
  const u = Math.min(W, H);
  if (v === 0) splatter(g, W * 0.9, H * 0.82, u * 0.075, INK, seed + 33, -0.5, 1.2, 70);
  else if (v === 1) splatter(g, W * 0.07, H * 0.8, u * 0.045, INK, seed + 71, -0.4, 1.1, 60);
  else if (v === 2) { const R = [PINK, CYAN, '#ffffff', ORG, PUR]; let a = seed >>> 0; const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; for (let i = 0; i < 44; i++) { g.fillStyle = R[i % 5]!; g.save(); g.translate(rnd() * W, rnd() * H); g.rotate(rnd() * 6); g.fillRect(0, 0, u * 0.03, u * 0.015); g.restore(); } }
  else { splatter(g, W * 0.08, H * 0.22, u * 0.065, INK, seed + 81, 0.2, 1, 70); splatter(g, W * 0.92, H * 0.82, u * 0.06, INK, seed + 82, 3.3, 1, 70); }
}

function render(J: PackJ, env: LayoutEnv, v: number): PackBox | null {
  const { W, H } = env, u = Math.min(W, H), portrait = W < H, side = sideOf(env), vis = visible(env), k = motionOf(env), seed = (env.cut.seed ?? 1) | 0;
  const text = clean(env.cut.text); if (!text) return null;
  const beat = beatHit(env), ph = phrases(env), rich = richOf(env), tint = side > 0 ? 1 : -1;
  let box: PackBox | null = null;
  const put = (item: Record<string, unknown>) => { box = union(box, J.mainDraw(env, item)); };
  place(env, layerOf(`pp:far:${v}:${W}x${H}:${seed}`, W, H, (g) => paintFar(g, W, H, v, seed)), { enter: 'fade', pulse: 0.01, alpha: rich }, beat.hit, k);
  place(env, layerOf(`pp:near:${v}:${W}x${H}:${seed}`, W, H, (g) => paintNear(g, W, H, v, seed)), { enter: 'zoom', alpha: rich, delay: 0.05 }, beat.hit, k);
  const outline = (size: number, extra: Record<string, unknown> = {}) => ({ stroke: size * 0.09, strokeUnder: true, strokeColor: INK, extrude: { n: 6, dx: size * 0.07, dy: size * 0.07, color: INK }, ...extra });

  if (v === 0) {
    const { lines, size } = fitHero(J, FONT, ph.hero, W * (portrait ? 0.9 : 0.7), H * 0.4, u * (portrait ? 0.3 : 0.4)), m = sizeOf(J, lines, FONT, size), cx = W * (portrait ? 0.5 : 0.56), cy = H * (portrait ? 0.38 : 0.36), ang = -8.5 * tint, at = frame(cx, cy, ang);
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: '#ffffff', rot: ang, skew: -6 * tint, mi: 0, ...outline(size, { extrude: { n: 7, dx: size * 0.08, dy: size * 0.08, color: PINK } }) });
    const tsize = size * 0.38;
    if (ph.pre.length) { const [x, y] = at(-m.w / 2 - tsize * 0.2, tsize * 0.9); put({ text: ph.pre.join(' '), font: FONT, size: tsize, x, y, color: '#ffffff', rot: ang, align: 'right', mi: 1, ...outline(tsize, { extrude: { n: 4, dx: tsize * 0.07, dy: tsize * 0.07, color: INK } }) }); }
    if (ph.post.length) { const [x, y] = at(m.w / 2, m.h / 2 + tsize * 1.3); put({ text: ph.post.join(' '), font: FONT, size: tsize, x, y, color: '#ffffff', rot: ang, align: 'right', mi: 2, ...outline(tsize, { extrude: { n: 4, dx: tsize * 0.07, dy: tsize * 0.07, color: INK } }) }); }
  } else if (v === 1) {
    const { lines, size } = fitHero(J, FONT, ph.hero, W * (portrait ? 0.82 : 0.6), H * 0.32, u * (portrait ? 0.26 : 0.34)), m = sizeOf(J, lines, FONT, size), cx = W / 2, cy = H / 2, ang = -4 * tint, at = frame(cx, cy, ang);
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: '#ffffff', rot: ang, skew: -6 * tint, mi: 0, ...outline(size) });
    const tsize = size * 0.34, rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) { const [x, y] = at(0, m.h / 2 + tsize * 1.6); put({ text: rest, font: FONT, size: tsize, x, y, color: INK, rot: ang, mi: 1 }); }
    if (on(env) && env.pass === 'main') micro(env, '!!', W * (portrait ? 0.84 : 0.88), H * 0.18, u * 0.12, INK, 0.95 * vis, { rot: 12, font: FONT });
  } else if (v === 2) {
    const chars = [...text].filter((c) => c.trim()), n = chars.length, cols = portrait ? Math.min(n, 3) : n, rowsN = Math.ceil(n / cols), pitch = Math.min((W * 0.86) / cols, (H * 0.6) / rowsN, u * 0.3), size = pitch * 0.6;
    const cols5 = [PINK, CYAN, '#ffffff', ORG, PUR];
    chars.forEach((ch, i) => {
      const row = Math.floor(i / cols), c = i % cols, cnt = Math.min(cols, n - row * cols), x = W / 2 + (c - (cnt - 1) / 2) * pitch, y = H * 0.5 + (row - (rowsN - 1) / 2) * pitch * 1.08 + (i % 2 ? 0.05 : -0.05) * pitch, a = ((i - (n - 1) / 2) * 0.09), q = easeOut(cap(env.pIn * 1.6 - i * 0.1)) * (1 - cap(env.pOut));
      const hw = pitch * 0.44 * q, rect = (dx: number, dy: number): [number, number][] => { const f = frame(x + dx, y + dy, (a * 180) / Math.PI); return [f(-hw, -hw * 1.05), f(hw, -hw * 1.05), f(hw, hw * 1.05), f(-hw, hw * 1.05)]; };
      if (env.pass === 'main') { env.poly(rect(pitch * 0.05, pitch * 0.06), '#000000', 0.35 * rich); env.poly(rect(0, 0), cols5[i % 5]!, rich); }
      const white = i % 5 === 2;
      put({ text: ch, font: FONT, size, x, y, color: white ? INK : '#ffffff', rot: (a * 180) / Math.PI, mi: i, ...(white ? {} : { stroke: size * 0.09, strokeUnder: true, strokeColor: INK }) });
    });
  } else {
    const { lines, size } = fitHero(J, FONT, ph.hero, W * 0.8, H * 0.36, u * (portrait ? 0.3 : 0.38)), m = sizeOf(J, lines, FONT, size), cx = W / 2, cy = H * 0.5;
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: '#ffffff', skew: -9 * tint, mi: 0, ...outline(size) });
    const tsize = size * 0.3, rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) put({ text: rest, font: FONT, size: tsize, x: cx, y: cy + m.h / 2 + tsize * 1.5, color: INK, mi: 1 });
  }
  micro(env, `No.${pad(env.cut.line + 1, 2)}`, W * 0.04, H * 0.93, u * 0.026, INK, 0.9 * vis * (on(env) ? 1 : 0));
  return box;
}

const effects = (J: PackJ): PackEffect[] => {
  const layoutDef = (v: number, key: string, name: string, fits: (n: number) => boolean, w: number): PackEffect => ({
    group: 'layout', key, def: { name, fits, w, portrait: 1, plan: (rng: Rng) => ({ font: FONT, side: rng.pick([-1, 1]) }), render: (env: LayoutEnv) => render(J, env, v) },
  });
  return [
    layoutDef(0, 'vscPpHalf', 'ハーフトーンと破れた帯.c', () => true, 3), layoutDef(1, 'vscPpBurst', '星型の爆発.c', () => true, 2.4), layoutDef(2, 'vscPpSticker', '色違いのシール.c', (n) => n >= 2 && n <= 7, 1.6), layoutDef(3, 'vscPpSplit', '斜めの二分割.c', () => true, 2),
    enterFx('vscPpPop', '弾んで決まる.c', 0.34, 0.35, (q, i, _n, it, kk) => { const e = easeOutBackQ(q, 2.2); return { s: 0.4 + 0.6 * e, a: cap(q * 5), rot: (1 - q) * (i % 2 ? 10 : -10) * kk, dy: (1 - q) * it.size * 0.3 * kk }; }),
    enterFx('vscPpSlide', '横から滑り込む.c', 0.32, 0.45, (q, _i, _n, it, kk) => ({ dx: -(1 - easeOut(q)) * it.size * 0.9 * kk, a: easeOut(q) })),
    exitFx('vscPpPunch', '膨らんで消える.c', 0.2, 0, (q, _i, _n, _it, kk) => ({ s: 1 + q * 0.25 * kk, a: 1 - cap(q * 1.3) })),
    exitFx('vscPpDrop', '落ちて消える.c', 0.22, 0.3, (q, i, _n, it, kk) => ({ dy: q * q * it.size * 0.8 * kk, rot: (i % 2 ? 1 : -1) * q * 12 * kk, a: 1 - cap(q * 1.2) })),
    holdFx('vscPpBounce', '拍で弾む.c', (_t, amt, _i, _n, _it, kk, env: PackEnv) => {
      const b = env.beat && env.beat.len > 0 ? env.beat : { index: Math.floor(env.lt / 0.5), since: env.lt % 0.5, len: 0.5 };
      const every = Math.max(1, Math.ceil(1 / (3 * b.len) - 1e-9));
      return { s: 1 + (b.index % every === 0 ? Math.exp(-b.since * 9) : 0) * 0.06 * kk * amt };
    }),
    { group: 'cam', key: 'vscPpCam', def: { name: '拍で小さく寄る.c', get(env: LayoutEnv) { const b = beatHit(env); return { s: 1 + b.hit * 0.015, x: 0, y: 0, rot: 0 }; } } },
  ];
};

export const popClaudePack = claudePack({
  id: 'Pop', name: 'ポップ・爆発', desc: '黄色の地のコミック。ハーフトーン・破れた帯・星型の爆発・シール・斜めの二分割。主役は白に太い黒縁',
  fonts: { display: [FONT], body: [FONT], serif: [FONT] },
  scheme: { bg: YEL, fg: '#FFFFFF', sub: INK, accent: PINK, accent2: CYAN, dim: '#fff3a0' },
  effects,
});
