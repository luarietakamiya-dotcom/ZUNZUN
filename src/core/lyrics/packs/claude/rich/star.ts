import type { PackBox, PackEffect, PackEnv, PackJ } from '../../types';
import { clean, union, type LayoutEnv, type Rng } from '../../design-kit';
import { easeOut } from '../../util';
import { beatHit, cap, micro, motionOf, phrases, rule, sizeOf, visible } from '../skin';
import { enterFx, exitFx, holdFx } from '../effects';
import { claudePack } from '../build';
import { firstChar, fitHero, on } from './common';
import { fillAll, glow, grain, line, moon, rng, type G } from './kit';
import { layerOf, place, richOf } from './layer';

/**
 * 星図・銀河.c — 星雲と天の川、光る節の星座、楕円の軌道、巨大な薄い字と流れ星、月と観測の格子。字は淡く光る。
 * 試作: docs/art-studies/rich-compositions.html の G1〜G4。
 */
const FONT = 'klee', BLUE = '#aac8ff', PALE = '#f1f6ff';

function stars(g: G, W: number, H: number, n: number, seed: number, rmax = 1.2): void {
  const R = rng(seed), u = Math.min(W, H) / 270; g.save();
  for (let i = 0; i < n; i++) { g.globalAlpha = 0.3 + R() * 0.7; g.fillStyle = '#fff'; g.beginPath(); g.arc(R() * W, R() * H, (0.5 + R() * rmax) * u * 1.2, 0, 7); g.fill(); }
  g.restore();
}
function node(g: G, x: number, y: number, r: number, c = BLUE): void { glow(g, x, y, r * 9, c, 0.8); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }

function paintFar(g: G, W: number, H: number, v: number, seed: number): void {
  const u = Math.min(W, H);
  fillAll(g, W, H, '#03050f');
  if (v === 0) {
    glow(g, W * 0.25, H * 0.3, u * 1.0, '#5b2a9e', 0.5); glow(g, W * 0.7, H * 0.7, u * 1.0, '#1f4fb3', 0.45); glow(g, W * 0.55, H * 0.2, u * 0.6, '#c2459b', 0.3);
    const R = rng(seed + 151); g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 1100; i++) { const t = R(), s = (R() + R() + R() - 1.5) * u * 0.26, x = t * W * 1.2 - W * 0.05, y = H * 0.85 - t * H * 0.7 + s, r = (0.4 + R() * R() * 1.5) * u / 270 * 1.2; g.globalAlpha = 0.3 + R() * 0.7; g.fillStyle = R() < 0.2 ? '#ffd9b0' : '#cfe0ff'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    g.restore();
    const pts: [number, number][] = [[0.14, 0.7], [0.27, 0.5], [0.4, 0.62], [0.5, 0.3], [0.66, 0.42], [0.82, 0.24]].map(([a, b]) => [W * a!, H * b!]);
    pts.forEach((p, i) => { if (i) line(g, pts[i - 1]![0], pts[i - 1]![1], p[0], p[1], BLUE, Math.max(1, u * 0.0045), 0.8); }); pts.forEach((p) => node(g, p[0], p[1], u * 0.01));
  } else if (v === 1) {
    glow(g, W * 0.3, H * 0.6, u * 0.96, '#4a2a9e', 0.5); glow(g, W * 0.75, H * 0.35, u * 0.9, '#1f6fd0', 0.4); stars(g, W, H, 160, seed + 161);
    const cx = W / 2, cy = H / 2, k = Math.min(W / 720, H / 270) * 1.6;
    for (const [rx, ry, a] of [[250, 80, 0.45], [175, 54, 0.6], [100, 30, 0.75]] as const) { g.save(); g.translate(cx, cy); g.rotate(-0.22); g.strokeStyle = BLUE; g.globalAlpha = a; g.lineWidth = Math.max(1, u * 0.005); g.beginPath(); g.ellipse(0, 0, rx * k, ry * k, 0, 0, 7); g.stroke(); g.restore(); }
    for (const [rx, ry, t, c] of [[250, 80, 1.2, '#ffd9b0'], [175, 54, 3.9, '#9fc2ff'], [100, 30, 5.6, '#ff9ed2']] as const) { const x = Math.cos(t) * rx * k, y = Math.sin(t) * ry * k; node(g, cx + x * Math.cos(-0.22) - y * Math.sin(-0.22), cy + x * Math.sin(-0.22) + y * Math.cos(-0.22), u * 0.015, c); }
  } else if (v === 2) {
    g.save(); g.globalAlpha = 0.07; g.fillStyle = BLUE; g.font = `900 ${u * 1.5}px "Klee One", serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('夜', W * 0.62, H * 0.58); g.restore();
    glow(g, W * 0.2, H * 0.2, u * 0.9, '#3b2a8e', 0.5); stars(g, W, H, 140, seed + 171, 1.1);
    for (const [x0, y0, x1, y1] of [[W * 0.92, H * 0.06, W * 0.6, H * 0.31], [W * 0.5, H * 0.11, W * 0.3, H * 0.26]] as const) { g.save(); const sg = g.createLinearGradient(x0, y0, x1, y1); sg.addColorStop(0, '#fff'); sg.addColorStop(1, 'rgba(255,255,255,0)'); g.strokeStyle = sg; g.lineWidth = Math.max(1.5, u * 0.008); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.restore(); }
    line(g, W * 0.32, H * 0.7, W * 0.74, H * 0.28, BLUE, Math.max(1, u * 0.0045), 0.75); node(g, W * 0.74, H * 0.28, u * 0.013, '#ffe9a8');
  } else {
    glow(g, W * 0.18, H * 0.5, u * 0.74, '#3a4a8e', 0.4); moon(g, W * 0.16, H * 0.52, u * 0.44, seed + 181);
    for (let i = 1; i < 10; i++) line(g, (W * i) / 10, 0, (W * i) / 10, H, BLUE, 1, 0.12); for (let i = 1; i < 6; i++) line(g, 0, (H * i) / 6, W, (H * i) / 6, BLUE, 1, 0.12);
    stars(g, W, H, 90, seed + 182, 1.1);
  }
  grain(g, W, H, 0.07);
}

function render(J: PackJ, env: LayoutEnv, v: number): PackBox | null {
  const { W, H } = env, u = Math.min(W, H), portrait = W < H, vis = visible(env), k = motionOf(env), seed = (env.cut.seed ?? 1) | 0;
  const text = clean(env.cut.text); if (!text) return null;
  const ph = phrases(env), rich = richOf(env), beat = beatHit(env), fc = firstChar(text);
  let box: PackBox | null = null;
  const put = (item: Record<string, unknown>) => { box = union(box, J.mainDraw(env, item)); };
  place(env, layerOf(`st:far:${v}:${W}x${H}:${seed}:${v === 2 ? fc : ''}`, W, H, (g) => paintFar(g, W, H, v, seed)), { enter: 'fade', pulse: 0.006, drift: 0.004, alpha: rich }, beat.hit, k);
  const lit = (size: number) => ({ shadow: { color: '#9fc2ffcc', blur: size * 0.4, dy: 0 } });
  const rest = [...ph.pre, ...ph.post].join(' ');

  if (v === 0) {
    const { lines, size } = fitHero(J, FONT, ph.hero, W * (portrait ? 0.86 : 0.6), H * 0.18, u * (portrait ? 0.1 : 0.15));
    put({ text: lines.join('\n'), font: FONT, size, x: W / 2, y: H * 0.82, color: PALE, track: 0.25, mi: 0, ...lit(size) });
    micro(env, rest, W / 2, H * 0.93, u * 0.026, BLUE, 0.85 * vis * (rest ? 1 : 0), { align: 'center' });
  } else if (v === 1) {
    const { lines, size } = fitHero(J, FONT, ph.hero, W * 0.4, H * 0.18, u * 0.14);
    put({ text: lines.join('\n'), font: FONT, size, x: W / 2, y: H / 2, color: '#ffffff', track: 0.2, mi: 0, ...lit(size) });
    micro(env, rest || 'ORBIT  TRACK 03', W * 0.05, H * 0.92, u * 0.026, BLUE, 0.85 * vis * (on(env) || rest ? 1 : 0));
  } else if (v === 2) {
    const { lines, size } = fitHero(J, FONT, ph.hero, W * (portrait ? 0.86 : 0.58), H * 0.2, u * (portrait ? 0.11 : 0.14));
    put({ text: lines.join('\n'), font: FONT, size, x: W * 0.07 + sizeOf(J, lines, FONT, size).w / 2, y: H * 0.74, color: PALE, track: 0.2, mi: 0, ...lit(size) });
    micro(env, `name: ${fc}`, W * 0.77, H * 0.24, u * 0.03, BLUE, 0.95 * vis * (on(env) ? 1 : 0));
    micro(env, rest, W * 0.07, H * 0.9, u * 0.026, BLUE, 0.85 * vis * (rest ? 1 : 0));
  } else {
    const { lines, size } = fitHero(J, FONT, ph.hero, W * 0.42, H * 0.22, u * 0.18), m = sizeOf(J, lines, FONT, size), cx = W * (portrait ? 0.5 : 0.58), cy = H * 0.5;
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: '#ffffff', track: 0.18, mi: 0, ...lit(size) });
    if (env.pass === 'main' && on(env)) {
      const bx = m.w / 2 + size * 0.5, by = m.h / 2 + size * 0.4, a = size * 0.35, w = Math.max(2, u * 0.008);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) { rule(env, cx + sx * bx, cy + sy * by - sy * a, cx + sx * bx, cy + sy * by, '#ffe9a8', w, 0.95 * vis); rule(env, cx + sx * bx, cy + sy * by, cx + sx * bx - sx * a, cy + sy * by, '#ffe9a8', w, 0.95 * vis); }
    }
    micro(env, `OBS  ${rest}`.trim(), W * 0.36, H * 0.92, u * 0.026, BLUE, 0.85 * vis * (on(env) || rest ? 1 : 0));
  }
  return box;
}

const effects = (J: PackJ): PackEffect[] => {
  const layoutDef = (v: number, key: string, name: string, fits: (n: number) => boolean, w: number): PackEffect => ({
    group: 'layout', key, def: { name, fits, w, portrait: 1, plan: (rng: Rng) => ({ font: FONT, side: rng.pick([-1, 1]) }), render: (env: LayoutEnv) => render(J, env, v) },
  });
  return [
    layoutDef(0, 'vscSxConst', '星座.c', () => true, 3), layoutDef(1, 'vscSxOrbit', '軌道.c', (n) => n <= 8, 1.8), layoutDef(2, 'vscSxMeteor', '流れ星と巨大な字.c', () => true, 2), layoutDef(3, 'vscSxMoon', '月と観測.c', (n) => n <= 10, 1.8),
    enterFx('vscSxRise', '星のように灯る.c', 0.55, 0.5, (q, i, _n, it, kk) => ({ a: cap(q * 1.3 - i * 0.03), s: 0.94 + 0.06 * easeOut(q), bl: (1 - q) * it.size * 0.1 * kk })),
    enterFx('vscSxStream', '流れて来る.c', 0.5, 0.4, (q, _i, _n, it, kk) => ({ dx: (1 - easeOut(q)) * it.size * 0.6 * kk, a: easeOut(q) })),
    exitFx('vscSxFade', '光が引く.c', 0.45, 0.3, (q, _i, _n, it) => ({ a: 1 - cap(q * 1.1), bl: q * it.size * 0.12 })),
    exitFx('vscSxShoot', '流れ星のように去る.c', 0.4, 0.3, (q, _i, _n, it, kk) => ({ dx: q * q * it.size * 0.8 * kk, dy: q * q * it.size * 0.3 * kk, a: 1 - cap(q * 1.3) })),
    holdFx('vscSxTwinkle', 'またたく.c', (t, amt, i, _n, _it, kk, _env: PackEnv) => ({ a: 1 - (0.5 + 0.5 * Math.sin(t * 2.2 + i * 1.7)) * 0.12 * kk * amt })),
    { group: 'cam', key: 'vscSxCam', def: { name: 'ゆっくり寄る.c', get(env: LayoutEnv) { return { s: 1 + env.pIn * 0.01, x: 0, y: 0, rot: 0 }; } } },
  ];
};

export const starClaudePack = claudePack({
  id: 'Star', name: '星図・銀河', desc: '星雲と天の川・光る節の星座・楕円の軌道・流れ星・月と観測の格子。字は淡く光る',
  fonts: { display: [FONT], body: [FONT], serif: [FONT] },
  scheme: { bg: '#03050f', fg: PALE, sub: BLUE, accent: '#ffe9a8', accent2: '#ff9ed2', dim: '#5b6a9a' },
  effects,
});
