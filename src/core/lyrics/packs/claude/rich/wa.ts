import type { PackBox, PackEffect, PackEnv, PackJ } from '../../types';
import { clean, union, type LayoutEnv, type Rng } from '../../design-kit';
import { easeOut } from '../../util';
import { beatHit, cap, micro, motionOf, phrases, visible } from '../skin';
import { enterFx, exitFx, holdFx } from '../effects';
import { claudePack } from '../build';
import { firstChar, fitHero } from './common';
import { brush, fillAll, grain, mountains, rng, rough, splatter, type G } from './kit';
import { layerOf, place, richOf } from './layer';

/**
 * 和・墨.c — 生成りの紙、かすれた墨の帯、朱の円と判、水墨の山と月、破れた和紙の帯。主役は墨の太い明朝。
 * 試作: docs/art-studies/rich-compositions.html の H1〜H4。
 */
const FONT = 'tokumin', PAPER = '#efe8d8', INK = '#14110f', RED = '#d3321f';

function seal(g: G, x: number, y: number, s: number, ch: string): void {
  g.fillStyle = RED; g.fillRect(x, y, s, s); g.fillStyle = PAPER; g.font = `900 ${s * 0.7}px "Noto Serif JP", serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, x + s / 2, y + s / 2 + s * 0.04);
}
function paintFar(g: G, W: number, H: number, v: number, seed: number, ch: string): void {
  const u = Math.min(W, H);
  if (v === 2) { const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, PAPER); bg.addColorStop(1, '#d9d0bd'); g.fillStyle = bg; g.fillRect(0, 0, W, H); } else fillAll(g, W, H, PAPER);
  grain(g, W, H, 0.3, 'multiply');
  if (v === 0) {
    const R0 = rng(seed + 81); g.save(); g.fillStyle = RED; g.globalAlpha = 0.95; g.beginPath();
    for (let i = 0; i <= 40; i++) { const t = (i / 40) * Math.PI * 2, r = u * 0.33 * (0.97 + R0() * 0.06); g.lineTo(W * 0.74 + Math.cos(t) * r, H * 0.48 + Math.sin(t) * r); } g.fill(); g.restore();
    brush(g, W * 0.02, H * 0.78, W * 0.7, H * 0.66, u * 0.125, INK, seed + 82, 0.94); brush(g, W * 0.3, H * 0.9, W * 0.98, H * 0.8, u * 0.055, INK, seed + 83, 0.85);
    seal(g, W * 0.52, H * 0.12, u * 0.1, ch);
  } else if (v === 1) {
    brush(g, W * 0.83, H * 0.03, W * 0.8, H * 0.97, u * 0.15, INK, seed + 91, 0.95); splatter(g, W * 0.74, H * 0.3, u * 0.04, INK, seed + 92, 3.0, 1.1, 60); splatter(g, W * 0.9, H * 0.82, u * 0.033, INK, seed + 93, 0.4, 1.1, 50);
    seal(g, W * 0.38, H * 0.7, u * 0.13, ch);
  } else if (v === 2) {
    g.save(); g.fillStyle = '#fbf6ea'; g.globalAlpha = 0.95; g.beginPath(); g.arc(W * 0.7, H * 0.32, u * 0.19, 0, 7); g.fill(); g.restore();
    mountains(g, W, H, H * 0.5, H * 0.11, '#8b8678', seed + 101, 0.55, 12); mountains(g, W, H, H * 0.62, H * 0.09, '#4f4b43', seed + 102, 0.75, 12); mountains(g, W, H, H * 0.76, H * 0.075, INK, seed + 103, 0.95, 12);
    brush(g, W * 0.05, H * 0.2, W * 0.5, H * 0.18, u * 0.03, INK, seed + 104, 0.7); seal(g, W * 0.2, H * 0.78, u * 0.09, ch);
  } else {
    const R = rng(seed + 111); g.save(); g.strokeStyle = 'rgba(120,100,70,0.25)';
    for (let i = 0; i < 120; i++) { const x = R() * W, y = R() * H, a = R() * 6, l = u * 0.05; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } g.restore();
    rough(g, [[-W * 0.03, H * 0.24], [W * 1.03, H * 0.15], [W * 1.03, H * 0.43], [-W * 0.03, H * 0.53]], RED, u * 0.033, seed + 112);
    rough(g, [[-W * 0.03, H * 0.59], [W * 1.03, H * 0.52], [W * 1.03, H * 0.79], [-W * 0.03, H * 0.87]], INK, u * 0.033, seed + 113);
    seal(g, W * 0.86, H * 0.8, u * 0.11, ch); splatter(g, W * 0.1, H * 0.9, u * 0.033, INK, seed + 114, -0.3, 1.1, 50);
  }
  grain(g, W, H, 0.1);
}

function render(J: PackJ, env: LayoutEnv, v: number): PackBox | null {
  const { W, H } = env, u = Math.min(W, H), portrait = W < H, vis = visible(env), k = motionOf(env), seed = (env.cut.seed ?? 1) | 0;
  const text = clean(env.cut.text); if (!text) return null;
  const ph = phrases(env), rich = richOf(env), beat = beatHit(env), fc = firstChar(text);
  let box: PackBox | null = null;
  const put = (item: Record<string, unknown>) => { box = union(box, J.mainDraw(env, item)); };
  place(env, layerOf(`wa:far:${v}:${W}x${H}:${seed}:${fc}`, W, H, (g) => paintFar(g, W, H, v, seed, fc)), { enter: v === 1 ? 'wipeR' : 'fade', pulse: 0.004, alpha: rich }, beat.hit, k);
  const rest = [...ph.pre, ...ph.post].join(' ');
  const sub = (x: number, y: number, col: string, a = 0.85) => micro(env, rest, x, y, u * 0.028, col, a * vis * (rest ? 1 : 0), { align: 'left' });

  if (v === 0) {
    const { lines, size } = fitHero(J, FONT, ph.hero, W * (portrait ? 0.84 : 0.4), H * 0.4, u * (portrait ? 0.2 : 0.26));
    put({ text: lines.join('\n'), font: FONT, size, x: W * (portrait ? 0.5 : 0.36), y: H * (portrait ? 0.3 : 0.4), color: INK, track: 0.06, mi: 0 });
    sub(W * 0.04, H * 0.93, INK);
  } else if (v === 1) {
    const n = [...ph.hero].length, size = Math.min(u * 0.2, (H * 0.84) / Math.max(1, n) / 1.1);
    put({ text: ph.hero, font: FONT, size, x: W * 0.5, y: H * 0.48, color: INK, vertical: true, mi: 0 });
    sub(W * 0.08, H * 0.9, INK);
  } else if (v === 2) {
    const n = [...ph.hero].length, size = Math.min(u * 0.14, (H * 0.8) / Math.max(1, n) / 1.1);
    put({ text: ph.hero, font: FONT, size, x: W * 0.12, y: H * 0.45, color: INK, vertical: true, mi: 0 });
    micro(env, rest, W * 0.5, H * 0.92, u * 0.028, PAPER, 0.9 * vis * (rest ? 1 : 0), { align: 'center' });
  } else {
    const { lines, size } = fitHero(J, FONT, ph.hero, W * 0.82, H * 0.24, u * 0.2);
    put({ text: lines.join('\n'), font: FONT, size, x: W / 2, y: H * 0.36, color: PAPER, rot: -1, track: 0.12, mi: 0 });
    micro(env, rest, W / 2, H * 0.7, u * 0.04, PAPER, 0.95 * vis * (rest ? 1 : 0), { align: 'center' });
  }
  return box;
}

const effects = (J: PackJ): PackEffect[] => {
  const layoutDef = (v: number, key: string, name: string, fits: (n: number) => boolean, w: number): PackEffect => ({
    group: 'layout', key, def: { name, fits, w, portrait: 1, plan: (rng: Rng) => ({ font: FONT, side: rng.pick([-1, 1]) }), render: (env: LayoutEnv) => render(J, env, v) },
  });
  return [
    layoutDef(0, 'vscWaCircle', '朱の円と墨.c', () => true, 3), layoutDef(1, 'vscWaVertical', '縦の墨.c', (n) => n <= 8, 2), layoutDef(2, 'vscWaMount', '水墨の山と月.c', (n) => n <= 10, 1.8), layoutDef(3, 'vscWaBand', '和紙の帯.c', () => true, 1.8),
    enterFx('vscWaInk', '墨がにじむ.c', 0.42, 0.45, (q, i, _n, it, kk) => ({ a: cap(q * 1.5 - i * 0.03), s: 1.08 - 0.08 * easeOut(q), bl: (1 - q) * it.size * 0.12 * kk })),
    enterFx('vscWaBrush', '筆で書き下ろす.c', 0.5, 0.7, (q, _i, _n, it, kk) => ({ dy: -(1 - easeOut(q)) * it.size * 0.3 * kk, a: cap(q * 2.2) })),
    exitFx('vscWaFade', '薄れて消える.c', 0.4, 0.3, (q, _i, _n, it) => ({ a: 1 - cap(q * 1.1), bl: q * it.size * 0.1 })),
    exitFx('vscWaSplit', '散って消える.c', 0.3, 0.4, (q, i, _n, it, kk) => ({ dx: (i % 2 ? 1 : -1) * q * it.size * 0.3 * kk, dy: q * it.size * 0.2 * kk, a: 1 - cap(q * 1.3) })),
    holdFx('vscWaStill', '静かに息づく.c', (t, amt, _i, _n, _it, kk, _env: PackEnv) => ({ s: 1 + Math.sin(t * 1.1) * 0.005 * kk * amt })),
    { group: 'cam', key: 'vscWaCam', def: { name: '静止.c', get() { return { s: 1, x: 0, y: 0, rot: 0 }; } } },
  ];
};

export const waClaudePack = claudePack({
  id: 'Wa', name: '和・墨', desc: '生成りの紙・かすれた墨・朱の円と判・水墨の山と月・破れた和紙の帯。主役は墨の太い明朝',
  fonts: { display: [FONT], body: [FONT], serif: [FONT] },
  scheme: { bg: PAPER, fg: INK, sub: '#4f4b43', accent: RED, accent2: '#8b8678', dim: '#b5ab97' },
  effects,
});
