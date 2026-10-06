import type { PackBox, PackEffect, PackJ } from '../types';
import { clean, pad, union, type LayoutEnv, type Rng } from '../design-kit';
import { easeInOut, easeOut } from '../util';
import { cap, decorOf, ghostGlyph, local, micro, motionOf, phrases, rule, sideOf, sizeOf, visible } from './skin';
import { enterFx, exitFx, holdFx } from './effects';
import { claudePack } from './build';

/**
 * 冬・雪.c — 静けさ。雪と結晶と余白。
 * 学び: 巨大な薄い字（雪に埋もれた字）／縦組みと横組みの切り替え／階段／小さな文字の土台。ゆっくり降り、止まる。
 */
const FONT = 'shippori';
const SMALL = 'mincho_light';
const first = (s: string): string => [...clean(s)].find((c) => c.trim()) ?? '';
function heroFit(J: PackJ, font: string, text: string, maxW: number, maxH: number, maxSize: number, track = 0): { lines: string[]; size: number } {
  const split = J.splitLines(text, Math.max(2, Math.floor(maxW / Math.max(1, maxSize * 0.9))));
  const lines = Array.isArray(split) ? split : [split];
  return { lines, size: Math.min(maxSize, J.fitSize(lines, font, maxW, maxH, { track })) };
}
/** 降る雪（決まった式。拍や乱数に依存しない）。画面全体に */
function snow(J: PackJ, env: LayoutEnv, count: number, alpha: number): void {
  if (env.pass !== 'main' || alpha <= 0.01) return;
  const { W, H, sc } = env, u = Math.min(W, H), seed = env.cut.seed ?? 1, t = env.lt * motionOf(env);
  for (let i = 0; i < count; i++) {
    const depth = 0.35 + J.r(seed, i, 41) * 0.65, x = W * J.r(seed, i, 42) + Math.sin(t * 0.5 + i) * u * 0.015 * depth, y = ((J.r(seed, i, 43) + t * 0.035 * depth) % 1) * H;
    env.circle(x, y, u * (0.0016 + 0.0042 * depth), sc.fg, null, 0, alpha * depth);
  }
}

function render(J: PackJ, env: LayoutEnv, variant: number): PackBox | null {
  const { W, H, sc } = env, u = Math.min(W, H), portrait = W < H, side = sideOf(env), decor = decorOf(env), vis = visible(env), k = motionOf(env);
  const text = clean(env.cut.text);
  if (!text) return null;
  const ice = sc.accent, ph = phrases(env), reveal = easeOut(cap(env.pIn * 1.4));
  let box: PackBox | null = null;
  const put = (item: Record<string, unknown>) => { box = union(box, J.mainDraw(env, item)); };

  if (variant === 0) {
    // 降る: 主役は縦組みで右の 3 分の 1 に。補助は横組みで左へ（縦横の切り替え）。雪は画面全体
    const heroLen = [...ph.hero].length, vsize = Math.min(u * 0.13, (H * 0.74) / Math.max(1, heroLen) / 1.1);
    const hx = W * (portrait ? 0.7 : 0.68);
    snow(J, env, portrait ? 55 : 70, 0.8 * decor * vis);
    rule(env, hx - vsize * 1.1, H * 0.12, hx - vsize * 1.1, H * 0.12 + H * 0.76 * reveal, ice, u * 0.0022, 0.55 * decor * vis);
    put({ text: ph.hero, font: FONT, size: vsize, x: hx, y: H * 0.14, color: sc.fg, vertical: true, align: 'left', track: 0.12, mi: 0 });
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) put({ text: rest, font: SMALL, size: Math.max(u * 0.03, vsize * 0.4), x: hx - vsize * 1.6, y: H * 0.5, color: sc.sub ?? sc.fg, align: 'right', track: 0.18, mi: 1 });
    micro(env, `WINTER  No.${pad(env.cut.line + 1, 2)}`, W * 0.04, H * 0.07, u * 0.026, sc.sub ?? sc.fg, 0.7 * decor * vis);
  } else if (variant === 1) {
    // 結晶: 中心から 6 方向に伸びる氷の線（枝つき）。主役は小さめに中央。結晶はゆっくり回る
    const { lines, size } = heroFit(J, FONT, ph.hero, W * (portrait ? 0.78 : 0.5), H * 0.18, u * (portrait ? 0.12 : 0.11), 0.1);
    const R = u * (portrait ? 0.4 : 0.36) * reveal, cx = W / 2, cy = H / 2, rot = env.lt * 0.04 * k;
    if (env.pass === 'main' && decor > 0.05) {
      for (let a = 0; a < 6; a++) {
        const ang = rot + (a * Math.PI) / 3 - Math.PI / 2, dx = Math.cos(ang), dy = Math.sin(ang);
        env.line([[cx + dx * R * 0.22, cy + dy * R * 0.22], [cx + dx * R, cy + dy * R]], ice, Math.max(1, u * 0.0028), 0.7 * vis);
        for (const f of [0.5, 0.74]) for (const s of [-1, 1]) env.line([[cx + dx * R * f, cy + dy * R * f], [cx + dx * R * (f - 0.14) - dy * R * 0.15 * s, cy + dy * R * (f - 0.14) + dx * R * 0.15 * s]], ice, Math.max(1, u * 0.002), 0.55 * vis);
      }
      env.circle(cx, cy, R * 1.12, null, ice, Math.max(1, u * 0.0018), 0.3 * vis);
      env.circle(cx, cy, R * 1.26, null, ice, Math.max(1, u * 0.0012), 0.16 * vis);
    }
    snow(J, env, 28, 0.6 * decor * vis);
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: sc.fg, track: 0.1, mi: 0, shadow: { color: '#050a14', blur: size * 0.5, dy: 0 } });
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) put({ text: rest, font: SMALL, size: size * 0.32, x: cx, y: cy + R * 1.5, color: sc.sub ?? sc.fg, track: 0.2, mi: 1 });
    micro(env, `CRYSTAL  ${pad(env.cut.line + 1, 2)}`, W * 0.04, H * 0.07, u * 0.026, sc.sub ?? sc.fg, 0.7 * decor * vis);
  } else if (variant === 2) {
    // 雪に埋もれた巨大な薄い字 + 小さな本文（満たす・空けるの「空ける」側）
    ghostGlyph(env, first(text), W * (0.5 - side * 0.14), H * 0.52, u * 1.7, FONT, sc.fg, 0.07 * decor * vis);
    const { lines, size } = heroFit(J, SMALL, ph.hero, W * 0.6, H * 0.12, u * 0.07, 0.25), m = sizeOf(J, lines, SMALL, size, 0.25), left = W * (portrait ? 0.1 : 0.12), y = H * 0.72;
    rule(env, 0, y - size * 1.2, left + m.w * reveal, y - size * 1.2, ice, u * 0.002, 0.55 * decor * vis);
    snow(J, env, 24, 0.7 * decor * vis);
    put({ text: lines.join('\n'), font: SMALL, size, x: left + m.w / 2, y, color: sc.fg, track: 0.25, mi: 0 });
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) put({ text: rest, font: SMALL, size: size * 0.4, x: left + m.w + size * 0.6, y: y + size * 0.18, color: sc.sub ?? sc.fg, align: 'left', track: 0.2, mi: 1 });
    micro(env, `${pad(env.cut.line + 1, 2)}`, W * 0.04, H * 0.93, u * 0.026, sc.sub ?? sc.fg, 0.6 * decor * vis);
  } else {
    // 階段: 文字が左上から右下へ、1 段ずつ降りる。各段に短い線と番号
    const chars = [...text].filter((c) => c.trim()), n = chars.length, size = Math.min(u * 0.12, (portrait ? W * 0.8 : W * 0.7) / n / 1.05, (H * 0.7) / n / 0.95);
    const dx = (portrait ? W * 0.78 : W * 0.72) / Math.max(1, n - 1) * (n > 1 ? 1 : 0), dy = (H * 0.62) / Math.max(1, n - 1) * (n > 1 ? 1 : 0), x0 = W * (portrait ? 0.12 : 0.14), y0 = H * 0.2;
    snow(J, env, 30, 0.6 * decor * vis);
    chars.forEach((ch, i) => {
      const x = x0 + i * dx, y = y0 + i * dy, a = easeOut(cap(env.pIn * 1.6 - i * 0.07)) * (1 - easeInOut(cap(env.pOut)));
      rule(env, x - size * 0.6, y + size * 0.62, x + size * 0.6 + dx * 0.4, y + size * 0.62, ice, u * 0.0022, 0.6 * decor * a);
      micro(env, pad(i + 1, 2), x + size * 0.62, y - size * 0.1, u * 0.02, sc.sub ?? sc.fg, 0.7 * decor * a);
      put({ text: ch, font: FONT, size, x, y, color: sc.fg, mi: i });
    });
    micro(env, 'STAIRS', W * 0.04, H * 0.07, u * 0.026, sc.sub ?? sc.fg, 0.7 * decor * vis);
    void local;
  }
  return box;
}

const effects = (J: PackJ): PackEffect[] => {
  const layoutDef = (variant: number, key: string, name: string, fits: (n: number) => boolean, w: number): PackEffect => ({
    group: 'layout', key, def: { name, fits, w, portrait: 1, plan: (rng: Rng) => ({ font: FONT, side: rng.pick([-1, 1]) }), render: (env: LayoutEnv) => render(J, env, variant) },
  });
  return [
    layoutDef(0, 'vscWinterFall', '縦組みと降る雪.c', () => true, 3),
    layoutDef(1, 'vscWinterCrystal', '結晶と小さな主役.c', () => true, 2),
    layoutDef(2, 'vscWinterGhost', '雪に埋もれた巨大な字.c', () => true, 2),
    layoutDef(3, 'vscWinterStairs', '階段を降りる文字.c', (n) => n >= 3 && n <= 10, 1.4),
    // 登場: 上からゆっくり舞い降り、減速して止まる（左右の揺れが小さくなる）
    enterFx('vscWinterLand', '舞い降りて止まる.c', 1.0, 0.5, (q, i, _n, it, k) => { const e = easeInOut(q); return { dy: -(1 - e) * it.size * 0.7 * k, dx: Math.sin(i * 1.9 + q * 6) * it.size * (1 - e) * 0.18 * k, a: e }; }),
    exitFx('vscWinterMelt', '雪のようにほどける.c', 0.7, 0.4, (q, i, _n, it, k) => ({ dy: q * it.size * 0.35 * k, dx: Math.sin(i * 1.9) * q * it.size * 0.2 * k, a: 1 - easeInOut(q) })),
    holdFx('vscWinterFloat', '微かに漂う.c', (t, amt, i, _n, it, k) => ({ dy: Math.sin(t * 0.8 + i * 0.7) * it.size * 0.012 * k * amt })),
  ];
};

export const winterClaudePack = claudePack({
  id: 'Winter', name: '冬・雪', desc: '静けさ。縦組みと降る雪、結晶、雪に埋もれた巨大な字、階段。ゆっくり降り、止まる',
  fonts: { display: [FONT], body: [SMALL], serif: [SMALL] },
  scheme: { bg: '#050a14', fg: '#F3F9FF', sub: '#A9C6E3', accent: '#BFE3FF', accent2: '#7FB2E5', dim: '#0b1424' },
  effects,
});
