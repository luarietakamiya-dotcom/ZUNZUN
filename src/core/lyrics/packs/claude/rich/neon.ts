import type { PackBox, PackEffect, PackEnv, PackJ } from '../../types';
import { clean, pad, union, type LayoutEnv, type Rng } from '../../design-kit';
import { easeOut } from '../../util';
import { beatHit, cap, micro, motionOf, phrases, sizeOf, visible } from '../skin';
import { enterFx, exitFx, holdFx } from '../effects';
import { claudePack } from '../build';
import { fitHero, on } from './common';
import { bars, fillAll, glow, grain, line, radar, rng, scan, vignette, type G } from './kit';
import { layerOf, place, richOf } from './layer';

/**
 * 端末・ネオン.c — 遠近の格子の床とネオンの色ずれ、CRT のログと反転ブロック、文字の雨、HUD。
 * 試作: docs/art-studies/rich-compositions.html の F1〜F4。
 */
const NEON = 'gothic_black', DOT = 'dot', PINKN = '#ff2a6d', CY = '#00e5ff', GRN = '#58d9a8', AMB = '#ffb454', MAG = '#ff2a9d';

function paintFar(g: G, W: number, H: number, v: number, seed: number, text: string): void {
  const u = Math.min(W, H);
  if (v === 0) {
    fillAll(g, W, H, '#04030a'); const hy = H * 0.58;
    glow(g, W / 2, hy, Math.max(W, H) * 0.45, MAG, 0.4); glow(g, W / 2, hy, u * 0.45, '#7a5cff', 0.5);
    for (let i = -14; i <= 14; i++) line(g, W / 2 + i * W * 0.014, hy, W / 2 + i * W * 0.125, H + 10, MAG, Math.max(1, u * 0.004), 0.55);
    for (let k = 1; k < 9; k++) { const y = hy + Math.pow(k / 9, 2.1) * (H - hy); line(g, 0, y, W, y, MAG, Math.max(1, u * 0.003), 0.5); }
    line(g, 0, hy, W, hy, '#ffd1f0', Math.max(1.5, u * 0.005), 0.9); scan(g, W, H, 0.25, Math.max(3, u * 0.012));
  } else if (v === 1) {
    fillAll(g, W, H, '#020805'); const R = rng(seed + 121), rows = 9, sz = Math.max(8, u * 0.034);
    g.save(); g.font = `${sz}px "DotGothic16", monospace`; g.textBaseline = 'top'; g.fillStyle = GRN;
    for (let i = 0; i < rows; i++) { g.globalAlpha = 0.28 + i * 0.05; g.fillText(`[${10 + i}:${String(Math.floor(R() * 60)).padStart(2, '0')}] ok  line ${100 + i}  ${text.slice(0, 14)}`, W * 0.05, H * 0.1 + i * sz * 1.7); }
    g.restore(); glow(g, W / 2, H / 2, Math.max(W, H) * 0.5, GRN, 0.1); scan(g, W, H, 0.35, Math.max(3, u * 0.01)); vignette(g, W, H, 0.85);
  } else if (v === 2) {
    fillAll(g, W, H, '#020805');
  } else {
    fillAll(g, W, H, '#031016'); glow(g, W / 2, H / 2, Math.max(W, H) * 0.5, '#00bcd4', 0.16);
    radar(g, W * 0.82, H * 0.5, u * 0.26, CY); bars(g, W * 0.08, H * 0.62, 18, u * 0.026, u * 0.22, CY, seed + 141);
    for (const [sx, sy] of [[W * 0.03, H * 0.07], [W * 0.97, H * 0.07], [W * 0.97, H * 0.93], [W * 0.03, H * 0.93]] as [number, number][]) { const dx = sx < W / 2 ? 1 : -1, dy = sy < H / 2 ? 1 : -1; line(g, sx, sy, sx + dx * u * 0.15, sy, CY, u * 0.009, 0.9); line(g, sx, sy, sx, sy + dy * u * 0.15, CY, u * 0.009, 0.9); }
    line(g, 0, H * 0.5, W, H * 0.5, CY, 1, 0.18); scan(g, W, H, 0.2, Math.max(3, u * 0.01));
  }
  grain(g, W, H, 0.1);
}
/** 文字の雨（縦に流す層） */
function paintRain(g: G, W: number, H: number, seed: number, text: string): void {
  const R = rng(seed + 131), chars = [...text, ...'WON'].filter((c) => c.trim()), sz = Math.max(9, Math.min(W, H) * 0.045), cols = Math.floor(W / (sz * 1.4));
  g.save(); g.font = `${sz}px "DotGothic16", monospace`; g.textBaseline = 'top';
  for (let c = 0; c < cols; c++) { const x = (c + 0.2) * sz * 1.4, h = R() * H; for (let r = 0; r < 12; r++) { g.globalAlpha = 0.12 + (r / 12) * 0.5; g.fillStyle = r === 11 ? '#eafff6' : GRN; g.fillText(chars[(c + r * 3) % chars.length]!, x, (h + r * sz * 1.15) % H); } }
  g.restore();
}

function render(J: PackJ, env: LayoutEnv, v: number): PackBox | null {
  const { W, H } = env, u = Math.min(W, H), portrait = W < H, vis = visible(env), k = motionOf(env), seed = (env.cut.seed ?? 1) | 0;
  const text = clean(env.cut.text); if (!text) return null;
  const ph = phrases(env), rich = richOf(env), beat = beatHit(env), flick = env.lt % 4 < 0.12 ? 0.6 : 1;
  let box: PackBox | null = null;
  const put = (item: Record<string, unknown>) => { box = union(box, J.mainDraw(env, item)); };
  place(env, layerOf(`nx:far:${v}:${W}x${H}:${seed}:${JSON.stringify(text)}`, W, H, (g) => paintFar(g, W, H, v, seed, text)), { enter: 'fade', alpha: rich }, beat.hit, k);
  if (v === 2) place(env, layerOf(`nx:rain:${W}x${H}:${seed}:${JSON.stringify(text)}`, W, H, (g) => paintRain(g, W, H, seed, text)), { enter: 'fade', scrollY: 0.22, alpha: rich }, 0, k);
  const rest = [...ph.pre, ...ph.post].join(' ');

  if (v === 0) {
    const { lines, size } = fitHero(J, NEON, ph.hero, W * (portrait ? 0.9 : 0.74), H * 0.3, u * (portrait ? 0.2 : 0.26)), cx = W / 2, cy = H * 0.34, jit = size * 0.04 * (0.5 + beat.hit);
    if (on(env)) { for (const [dx, col] of [[-jit, PINKN], [jit, CY]] as [number, string][]) J.mainDraw(env, { text: lines.join('\n'), font: NEON, size, x: cx + dx, y: cy, color: col, alpha: 0.9 * flick, blend: 'lighter', mi: 0 }); }
    put({ text: lines.join('\n'), font: NEON, size, x: cx, y: cy, color: '#eaffff', alpha: flick, mi: 0, shadow: { color: '#00e5ffcc', blur: size * 0.3, dy: 0 } });
    micro(env, `STATUS: ONLINE  ${rest}`.trim(), W * 0.05, H * 0.93, u * 0.026, CY, 0.95 * vis * (on(env) || rest ? 1 : 0));
  } else if (v === 1) {
    const { lines, size } = fitHero(J, DOT, ph.hero, W * 0.7, H * 0.2, u * 0.16), m = sizeOf(J, lines, DOT, size), left = W * 0.05, top = H * 0.56;
    if (env.pass === 'main') { env.rect(left - size * 0.2, top - size * 0.15, m.w + size * 0.5, m.h + size * 0.3, GRN, vis * rich); env.rect(left, H * 0.9, (W - left * 2) * (0.2 + 0.8 * env.pIn), u * 0.012, GRN, vis * rich); }
    put({ text: lines.join('\n'), font: DOT, size, x: left + size * 0.05 + m.w / 2, y: top + m.h / 2, color: '#021a12', mi: 0 });
    micro(env, rest, W / 2, H * 0.8, u * 0.028, AMB, 0.95 * vis * (rest ? 1 : 0), { align: 'center' });
  } else if (v === 2) {
    const { lines, size } = fitHero(J, DOT, ph.hero, W * 0.6, H * 0.22, u * 0.17);
    if (env.pass === 'main') { env.rect(W * 0.18, H * 0.34, W * 0.64, H * 0.32, '#020805', 0.92 * vis * rich); env.rect(W * 0.18, H * 0.66, W * 0.64, u * 0.007, GRN, 0.95 * vis * rich); }
    put({ text: lines.join('\n'), font: DOT, size, x: W / 2, y: H * 0.5, color: '#eafff6', track: 0.08, mi: 0, shadow: { color: '#58d9a8cc', blur: size * 0.3, dy: 0 } });
    micro(env, rest, W / 2, H * 0.74, u * 0.028, AMB, 0.95 * vis * (rest ? 1 : 0), { align: 'center' });
  } else {
    const { lines, size } = fitHero(J, NEON, ph.hero, W * (portrait ? 0.8 : 0.5), H * 0.22, u * 0.15);
    put({ text: lines.join('\n'), font: NEON, size, x: W * (portrait ? 0.5 : 0.42), y: H * 0.38, color: '#eaffff', track: 0.08, mi: 0, shadow: { color: '#00e5ffcc', blur: size * 0.3, dy: 0 } });
    micro(env, `SYS 98%   LAT 12ms   ${rest}`.trim(), W * 0.08, H * 0.12, u * 0.026, CY, 0.95 * vis * (on(env) || rest ? 1 : 0));
    micro(env, `TRACK ${pad(env.cut.line + 1, 2)} / 12`, W * 0.08, H * 0.52, u * 0.026, AMB, 0.9 * vis * (on(env) ? 1 : 0));
  }
  return box;
}

const effects = (J: PackJ): PackEffect[] => {
  const layoutDef = (v: number, key: string, name: string, fits: (n: number) => boolean, w: number): PackEffect => ({
    group: 'layout', key, def: { name, fits, w, portrait: 1, plan: (rng: Rng) => ({ font: NEON, side: rng.pick([-1, 1]) }), render: (env: LayoutEnv) => render(J, env, v) },
  });
  return [
    layoutDef(0, 'vscNxFloor', 'ネオンの床.c', () => true, 3), layoutDef(1, 'vscNxLog', 'CRT のログと反転.c', (n) => n <= 14, 2), layoutDef(2, 'vscNxRain', '文字の雨.c', (n) => n <= 14, 1.8), layoutDef(3, 'vscNxHud', 'HUD.c', () => true, 1.8),
    enterFx('vscNxBoot', '起動する.c', 0.3, 0.5, (q, i, _n, it, kk) => ({ a: q < 0.15 ? 0 : (Math.floor(q * 14 + i) % 3 === 0 ? 0.5 : 1) * cap(q * 3), dx: (1 - q) * it.size * 0.12 * kk * (i % 2 ? 1 : -1) })),
    enterFx('vscNxScanIn', '走査で出る.c', 0.34, 0.3, (q, _i, _n, it, kk) => ({ a: cap(q * 4), dy: -(1 - easeOut(q)) * it.size * 0.4 * kk })),
    exitFx('vscNxGlitch', '帯がずれて消える.c', 0.22, 0.3, (q, i, _n, it, kk) => ({ dx: (i % 2 ? 1 : -1) * q * it.size * 0.35 * kk, a: 1 - cap(q * 1.3) })),
    exitFx('vscNxOff', '電源が落ちる.c', 0.2, 0, (q, _i, _n, _it, kk) => ({ sy: 1 - q * 0.9 * kk, a: 1 - cap(q * 1.4) })),
    holdFx('vscNxHum', '微かなゆらぎ.c', (t, amt, i, _n, it, kk, _env: PackEnv) => ({ dx: Math.sin(t * 31 + i) * it.size * 0.004 * kk * amt })),
    { group: 'cam', key: 'vscNxCam', def: { name: '静止.c', get() { return { s: 1, x: 0, y: 0, rot: 0 }; } } },
  ];
};

export const neonClaudePack = claudePack({
  id: 'Neon', name: '端末・ネオン', desc: '遠近の格子の床とネオンの色ずれ・CRT のログ・文字の雨・HUD',
  fonts: { display: [NEON], body: [DOT], serif: [DOT] },
  scheme: { bg: '#04030a', fg: '#eaffff', sub: GRN, accent: CY, accent2: PINKN, dim: '#2a6f5a' },
  effects,
});
