import type { PackBox, PackEffect, PackEnv, PackJ } from '../../types';
import { clean, pad, union, type LayoutEnv, type Rng } from '../../design-kit';
import { easeOut } from '../../util';
import { beatHit, cap, micro, motionOf, phrases, rule, sizeOf, visible } from '../skin';
import { enterFx, exitFx, holdFx } from '../effects';
import { claudePack } from '../build';
import { fitHero, on } from './common';
import { aurora, bokeh, glow, grain, line, mountains, type G } from './kit';
import { layerOf, place, richOf } from './layer';

/**
 * 冬・吹雪.c — 夜の紺に雪の三層（奥の細かい雪・手前のぼけた雪）、霜の結晶、オーロラ。主役は細い明朝を字間広めに、淡く光らせる。
 * 試作: docs/art-studies/rich-compositions.html の D1〜D4。
 */
const FONT = 'mincho_light', ICE = '#bfe3ff', SNOW = '#f3f9ff', MIST = '#a9c6e3';

function paintFar(g: G, W: number, H: number, v: number, seed: number): void {
  const u = Math.min(W, H);
  const bg = v === 3 ? g.createLinearGradient(0, 0, 0, H) : v === 2 ? g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.max(W, H) * 0.6) : g.createLinearGradient(0, 0, W * 0.3, H);
  if (v === 3) { bg.addColorStop(0, '#02050f'); bg.addColorStop(1, '#0a1c34'); } else if (v === 2) { bg.addColorStop(0, '#12284a'); bg.addColorStop(1, '#03060f'); } else { bg.addColorStop(0, '#0b1a34'); bg.addColorStop(1, '#03060f'); }
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  if (v === 0) { g.save(); g.globalAlpha = 0.075; g.fillStyle = '#cfe6ff'; g.font = `900 ${u * 1.3}px "Noto Serif JP", serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('雪', W * 0.74, H * 0.58); g.restore(); }
  if (v === 2) {
    const cx = W / 2, cy = H / 2, R = u * 0.43;
    for (let a = 0; a < 6; a++) {
      const t = (a * Math.PI) / 3 - Math.PI / 2;
      line(g, cx + Math.cos(t) * u * 0.1, cy + Math.sin(t) * u * 0.1, cx + Math.cos(t) * R, cy + Math.sin(t) * R, ICE, u * 0.007, 0.85);
      for (const f of [0.45, 0.65, 0.85]) for (const s of [-1, 1]) line(g, cx + Math.cos(t) * R * f, cy + Math.sin(t) * R * f, cx + Math.cos(t) * R * (f - 0.14) - Math.sin(t) * u * 0.08 * s, cy + Math.sin(t) * R * (f - 0.14) + Math.cos(t) * u * 0.08 * s, ICE, u * 0.005, 0.75);
    }
    for (const k of [1.12, 1.3]) { g.save(); g.strokeStyle = ICE; g.globalAlpha = 0.3 / k; g.lineWidth = Math.max(1, u * 0.003); g.beginPath(); g.arc(cx, cy, R * k, 0, 7); g.stroke(); g.restore(); }
    glow(g, cx, cy, u * 0.44, '#9fcfff', 0.35);
  }
  if (v === 3) { aurora(g, W, H, seed + 11, ['#2bffa8', '#3a8bff', '#a35bff']); mountains(g, W, H, H * 0.78, H * 0.1, '#050a14', seed + 13, 1); mountains(g, W, H, H * 0.86, H * 0.07, '#02040a', seed + 14, 1); }
  bokeh(g, 90, seed + 2, ['#fff', '#cfe6ff'], u * 0.004, u * 0.014, 0.8, [0, 0, W, v === 3 ? H * 0.7 : H]);
  grain(g, W, H, 0.1);
}
/** 手前のぼけた雪＋粒の雪（縦に流す層） */
function paintSnow(g: G, W: number, H: number, v: number, seed: number): void {
  const u = Math.min(W, H);
  bokeh(g, v === 3 ? 22 : 16, seed + 5, ['#e8f4ff'], u * 0.03, u * 0.1, 0.2, [0, 0, W, H]);
  bokeh(g, 70, seed + 6, ['#fff', '#cfe6ff'], u * 0.006, u * 0.02, 0.6, [0, 0, W, H]);
}

function render(J: PackJ, env: LayoutEnv, v: number): PackBox | null {
  const { W, H } = env, u = Math.min(W, H), portrait = W < H, vis = visible(env), k = motionOf(env), seed = (env.cut.seed ?? 1) | 0;
  const text = clean(env.cut.text); if (!text) return null;
  const ph = phrases(env), rich = richOf(env), beat = beatHit(env);
  let box: PackBox | null = null;
  const put = (item: Record<string, unknown>) => { box = union(box, J.mainDraw(env, item)); };
  place(env, layerOf(`wt:far:${v}:${W}x${H}:${seed}`, W, H, (g) => paintFar(g, W, H, v, seed)), { enter: 'fade', alpha: rich }, beat.hit, k);
  place(env, layerOf(`wt:snow:${v}:${W}x${H}:${seed}`, W, H, (g) => paintSnow(g, W, H, v, seed)), { enter: 'fade', scrollY: 0.045, alpha: rich, delay: 0.05 }, 0, k);
  const lit = (size: number) => ({ shadow: { color: '#9fcfffaa', blur: size * 0.45, dy: 0 } });

  if (v === 0) {
    const { lines, size } = fitHero(J, FONT, ph.hero, W * (portrait ? 0.84 : 0.7), H * 0.34, u * (portrait ? 0.15 : 0.22)), m = sizeOf(J, lines, FONT, size);
    put({ text: lines.join('\n'), font: FONT, size, x: W / 2, y: H * 0.5, color: SNOW, track: 0.18, mi: 0, ...lit(size) });
    rule(env, W * 0.18, H * 0.5 + m.h / 2 + size * 0.45, W * 0.82, H * 0.5 + m.h / 2 + size * 0.45, ICE, Math.max(1, u * 0.002), 0.7 * vis);
    const rest = [...ph.pre, ...ph.post].join('　');
    if (rest) put({ text: rest, font: FONT, size: size * 0.3, x: W / 2, y: H * 0.5 + m.h / 2 + size * 0.95, color: MIST, track: 0.2, mi: 1 });
    micro(env, 'WINTER', W / 2, H * 0.88, u * 0.024, MIST, 0.8 * vis * (on(env) ? 1 : 0));
  } else if (v === 1) {
    const n = [...ph.hero].length, size = Math.min(u * (portrait ? 0.13 : 0.12), (H * 0.8) / Math.max(1, n) / 1.1), x = W * (portrait ? 0.62 : 0.74);
    put({ text: ph.hero, font: FONT, size, x, y: H * 0.5, color: SNOW, vertical: true, track: 0.1, mi: 0, ...lit(size) });
    if (on(env)) rule(env, x - size * 1.1, H * 0.1, x - size * 1.1, H * 0.9, ICE, Math.max(1, u * 0.002), 0.6 * vis);
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) put({ text: rest, font: FONT, size: size * 0.32, x: x - size * 1.6, y: H * 0.5, color: MIST, align: 'right', mi: 1 });
    micro(env, `DEC ${pad(env.cut.line + 1, 2)}`, W * 0.06, H * 0.9, u * 0.024, MIST, 0.8 * vis * (on(env) ? 1 : 0));
  } else if (v === 2) {
    const { lines, size } = fitHero(J, FONT, ph.hero, W * 0.5, H * 0.22, u * 0.1);
    put({ text: lines.join('\n'), font: FONT, size, x: W / 2, y: H / 2, color: '#ffffff', track: 0.12, mi: 0, ...lit(size) });
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) put({ text: rest, font: FONT, size: size * 0.32, x: W / 2, y: H * 0.5 + u * 0.28, color: MIST, track: 0.2, mi: 1 });
    micro(env, 'CRYSTAL', W / 2, H * 0.93, u * 0.024, MIST, 0.8 * vis * (on(env) ? 1 : 0));
  } else {
    const { lines, size } = fitHero(J, FONT, ph.hero, W * 0.78, H * 0.3, u * (portrait ? 0.14 : 0.18)), m = sizeOf(J, lines, FONT, size);
    put({ text: lines.join('\n'), font: FONT, size, x: W / 2, y: H * 0.5, color: SNOW, track: 0.2, mi: 0, shadow: { color: '#7fffd0aa', blur: size * 0.5, dy: 0 } });
    const rest = [...ph.pre, ...ph.post].join(' ');
    micro(env, rest || 'AURORA  69.6°N', W / 2, H * 0.5 + m.h / 2 + size * 0.5, u * 0.026, '#a9e3d6', 0.9 * vis * (on(env) || rest ? 1 : 0));
  }
  return box;
}

const effects = (J: PackJ): PackEffect[] => {
  const layoutDef = (v: number, key: string, name: string, fits: (n: number) => boolean, w: number): PackEffect => ({
    group: 'layout', key, def: { name, fits, w, portrait: 1, plan: (rng: Rng) => ({ font: FONT, side: rng.pick([-1, 1]) }), render: (env: LayoutEnv) => render(J, env, v) },
  });
  return [
    layoutDef(0, 'vscWxBlizzard', '吹雪と中央の主役.c', () => true, 3), layoutDef(1, 'vscWxVertical', '縦組みと降る雪.c', (n) => n <= 8, 2), layoutDef(2, 'vscWxCrystal', '氷の結晶.c', (n) => n <= 8, 1.6), layoutDef(3, 'vscWxAurora', 'オーロラの空.c', () => true, 1.8),
    enterFx('vscWxFade', '雪のように現れる.c', 0.5, 0.4, (q, i, _n, it, kk) => ({ a: cap(q * 1.4 - i * 0.04), dy: -(1 - easeOut(q)) * it.size * 0.25 * kk, bl: (1 - q) * it.size * 0.1 })),
    enterFx('vscWxDrift', '横へにじむ.c', 0.5, 0.5, (q, _i, _n, it, kk) => ({ dx: -(1 - easeOut(q)) * it.size * 0.3 * kk, a: easeOut(q) })),
    exitFx('vscWxMelt', '溶けて消える.c', 0.4, 0.3, (q, _i, _n, it) => ({ a: 1 - cap(q * 1.1), bl: q * it.size * 0.12 })),
    exitFx('vscWxFall', '雪と一緒に落ちる.c', 0.5, 0.4, (q, i, _n, it, kk) => ({ dy: q * q * it.size * 0.7 * kk, a: 1 - cap(q * 1.2 + i * 0.02) })),
    holdFx('vscWxBreath', '息づく光.c', (t, amt, _i, _n, _it, kk, _env: PackEnv) => ({ s: 1 + Math.sin(t * 1.4) * 0.008 * kk * amt })),
    { group: 'cam', key: 'vscWxCam', def: { name: 'ゆっくり寄る.c', get(env: LayoutEnv) { return { s: 1 + env.pIn * 0.012, x: 0, y: 0, rot: 0 }; } } },
  ];
};

export const winterRichClaudePack = claudePack({
  id: 'WinterX', name: '冬・吹雪', desc: '夜の紺に三層の雪・霜の結晶・オーロラ。主役は細い明朝を字間広めに、淡く光らせる',
  fonts: { display: [FONT], body: [FONT], serif: [FONT] },
  scheme: { bg: '#050a14', fg: SNOW, sub: MIST, accent: ICE, accent2: '#7fffd0', dim: '#6f8fb0' },
  effects,
});
