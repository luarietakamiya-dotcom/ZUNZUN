import type { PackBox, PackEffect, PackEnv, PackItem, PackJ } from '../types';
import { clean, pad, timecode, union, type LayoutEnv, type Rng } from '../design-kit';
import { easeInOut, easeOut, staggered } from '../util';
import { cap, decorOf, ghostGlyph, micro, motionOf, phrases, rule, sizeOf, visible } from './skin';
import { claudePack } from './build';

/**
 * ゴシック・祈り.c — 黒と白だけ。静かで鋭い余韻。
 * 学び（docs/LYRIC_MOTION_RESEARCH.md）: 巨大な薄い字 + 小さな本文／ドロップキャップ／小さな文字の野／満たす・空ける（密度の緩急）。
 * 派手に動かさず、登場に 1 つの出来事（光が通る・線が引かれる）を置き、あとは止める。文字は大きくしない。
 */
const FONT = 'tokumin';
const first = (s: string): string => [...clean(s)].find((c) => c.trim()) ?? '';

function heroFit(J: PackJ, text: string, maxW: number, maxH: number, maxSize: number, track = 0): { lines: string[]; size: number } {
  const split = J.splitLines(text, Math.max(2, Math.floor(maxW / Math.max(1, maxSize * 0.95))));
  const lines = Array.isArray(split) ? split : [split];
  return { lines, size: Math.min(maxSize, J.fitSize(lines, FONT, maxW, maxH, { track })) };
}

/** 光の柱（登場のあいだに画面を一度だけ横切り、そのあと消える）。細い帯を重ねて濃淡を作る */
function lightColumn(env: LayoutEnv, color: string, strength: number): void {
  if (env.pass !== 'main' || strength <= 0.01) return;
  const { W, H } = env, x = -W * 0.14 + (W * 1.28) * easeInOut(cap(env.pIn)), after = 1 - cap((env.lt - env.cut.inDur) / 0.5);
  const a0 = strength * after * (1 - easeInOut(cap(env.pOut)));
  if (a0 <= 0.01) return;
  const stepW = W * 0.028;
  for (let s = -6; s <= 6; s++) env.rect(x + s * stepW - stepW / 2, 0, stepW, H, color, 0.16 * a0 * Math.exp(-((s / 3.4) ** 2)));
  env.rect(x - 1, 0, 2, H, color, 0.55 * a0);
}

function render(J: PackJ, env: LayoutEnv, variant: number): PackBox | null {
  const { W, H, sc } = env, u = Math.min(W, H), portrait = W < H, decor = decorOf(env), vis = visible(env);
  const text = clean(env.cut.text);
  if (!text) return null;
  const white = sc.fg, dim = sc.sub ?? sc.fg;
  const ph = phrases(env);
  let box: PackBox | null = null;
  const put = (item: Record<string, unknown>) => { box = union(box, J.mainDraw(env, item)); };
  const side = Number(env.cut.params.side ?? 1) < 0 ? -1 : 1;

  if (variant === 0) {
    // 光が読む: 読まれる前の「文字の野」（小さく薄い反復）と、横切る光。字は光が通ると現れ、字間が詰まる
    const { lines, size } = heroFit(J, text, W * (portrait ? 0.86 : 0.74), H * 0.3, u * (portrait ? 0.15 : 0.12), 0.06);
    const cy = H * 0.52, rows = portrait ? 18 : 14, field = `${text}\u3000`.repeat(18);
    for (let r = 0; r < rows; r++) micro(env, field, -W * 0.02 - (r % 2) * u * 0.05, H * (0.05 + (r / (rows - 1)) * 0.9), u * 0.024, white, 0.07 * decor * vis, { font: FONT });
    lightColumn(env, '#fff3e0', decor > 0.05 ? 1 : 0.55);
    rule(env, W * 0.12, cy + size * 0.78, W * 0.88, cy + size * 0.78, white, u * 0.002, 0.38 * decor * vis);
    put({ text: lines.join('\n'), font: FONT, size, x: W / 2, y: cy, color: white, track: 0.06, mi: 0, shadow: { color: '#000000', blur: size * 0.35, dy: 0 } });
    micro(env, `${pad(env.cut.line + 1, 2)}`, W * 0.05, H * 0.93, u * 0.026, dim, 0.6 * decor * vis);
  } else if (variant === 1) {
    // ドロップキャップ: 先頭の 1 字だけが大きく、残りは縦組みの小さな列
    const head = first(text), rest = [...text].filter((c) => c.trim()).slice(1).join('');
    const capSize = Math.min(u * (portrait ? 0.46 : 0.52), W * 0.4), cx = W * (portrait ? 0.32 : 0.3), cy = H * 0.5;
    const restSize = Math.min(u * 0.085, (H * 0.62) / Math.max(1, [...rest].length) / 1.05);
    ghostGlyph(env, head, cx, cy, capSize * 1.9, FONT, white, 0.045 * decor * vis);
    put({ text: head, font: FONT, size: capSize, x: cx, y: cy, color: white, mi: 0, shadow: { color: '#000000', blur: capSize * 0.1, dy: 0 } });
    rule(env, W * (portrait ? 0.6 : 0.56), H * 0.16, W * (portrait ? 0.6 : 0.56), H * 0.16 + H * 0.68 * easeOut(cap(env.pIn * 1.3)), white, u * 0.003, 0.7 * decor * vis);
    if (rest) put({ text: rest, font: FONT, size: restSize, x: W * (portrait ? 0.7 : 0.66), y: H * 0.2, color: white, vertical: true, align: 'left', track: 0.12, mi: 1 });
    micro(env, 'Ⅰ', W * (portrait ? 0.6 : 0.56) + u * 0.02, H * 0.14, u * 0.03, dim, 0.7 * decor * vis);
  } else if (variant === 2) {
    // 巨大な薄い字 + 小さな 1 行: 暗闇に小さな本文。満たす・空けるの「空ける」側
    const head = first(text), { lines, size } = heroFit(J, text, W * 0.74, H * 0.1, u * 0.07, 0.28);
    ghostGlyph(env, head, W * (0.5 + side * 0.12), H * 0.5, u * 1.7, FONT, white, 0.06 * decor * vis);
    const cy = H * 0.66, m = sizeOf(J, lines, FONT, size, 0.28);
    rule(env, W / 2 - m.w / 2, cy - size * 1.3, W / 2 - m.w / 2 + m.w * easeOut(cap(env.pIn * 1.2)), cy - size * 1.3, white, u * 0.0022, 0.6 * decor * vis);
    put({ text: lines.join('\n'), font: FONT, size, x: W / 2, y: cy, color: white, track: 0.28, mi: 0 });
    // 小さな十字（祈りの印）
    const arm = u * 0.018, x = W / 2, y = H * 0.14;
    if (env.pass === 'main') { env.line([[x, y - arm], [x, y + arm * 1.6]], white, Math.max(0.8, u * 0.002), 0.8 * decor * vis); env.line([[x - arm * 0.7, y - arm * 0.2], [x + arm * 0.7, y - arm * 0.2]], white, Math.max(0.8, u * 0.002), 0.8 * decor * vis); }
    micro(env, timecode(Number.isFinite(env.cut.start) ? env.cut.start : 0), W * 0.05, H * 0.93, u * 0.024, dim, 0.55 * decor * vis);
  } else {
    // 十字: 縦棒と横棒を引き、主役を縦組みで縦棒の右に、補助を横組みで横棒の左下に置く（矩形が交わらない配置）
    const barX = W * (portrait ? 0.7 : 0.68), top = H * 0.1, bottom = H * 0.9, crossY = H * 0.34, bw = Math.max(2, u * 0.012);
    const grow = easeOut(cap(env.pIn * 1.4)) * (1 - easeOut(cap(env.pOut * 2)));
    if (decor > 0.05 && env.pass === 'main') {
      env.rect(barX - bw / 2, top, bw, (bottom - top) * grow, white, 0.85);
      const arm0 = barX - W * (portrait ? 0.2 : 0.2), arm1 = barX + W * (portrait ? 0.14 : 0.14);
      env.rect(arm0, crossY - bw / 2, (arm1 - arm0) * grow, bw, white, 0.85);
    }
    const heroText = ph.hero, glyphN = [...heroText].length, vsize = Math.min(u * 0.1, (H * 0.74) / Math.max(1, glyphN) / 1.1);
    put({ text: heroText, font: FONT, size: vsize, x: barX + bw / 2 + vsize * 0.95, y: top + H * 0.04, color: white, vertical: true, align: 'left', track: 0.1, mi: 0 });
    const others = [...ph.pre, ...ph.post], hsize = Math.max(u * 0.026, Math.min(u * 0.04, vsize * 0.4, W * 0.3 / Math.max(1, [...others.join('')].length)));
    if (others.length) put({ text: others.join('　'), font: FONT, size: hsize, x: barX - bw / 2 - hsize * 1.2, y: H * 0.64, color: dim, align: 'right', track: 0.16, mi: 1 });
    micro(env, 'Ⅰ', barX + bw + u * 0.01, top - u * 0.012, u * 0.03, dim, 0.7 * decor * vis);
  }
  return box;
}

const gothicEffects = (J: PackJ): PackEffect[] => {
  const strength = (env: PackEnv) => cap(env.fx.motion ?? 0.7);
  const layoutDef = (variant: number, name: string, w: number) => ({
    group: 'layout' as const, key: `vscGothic${['Light', 'Cap', 'Ghost', 'Cross'][variant]}`, def: {
      name, fits: () => true, w, portrait: 1,
      plan: (rng: Rng) => ({ font: FONT, side: rng.pick([-1, 1]) }),
      render: (env: LayoutEnv) => render(J, env, variant),
    },
  });
  return [
    layoutDef(0, '光が読む.c', 2),
    layoutDef(1, 'ドロップキャップ（先頭の 1 字）.c', 1.4),
    layoutDef(2, '巨大な薄い字 + 小さな 1 行.c', 1.6),
    layoutDef(3, '十字（縦組みと横組み）.c', 1.2),
    // 登場: 字間が詰まりながら現れる。下から上げない
    { group: 'enter', key: 'vscGothicRise', def: { name: '字間が詰まって現れる.c', inDur: (dur: number) => Math.min(1.0, dur * 0.4), apply(env: PackEnv, it: PackItem, p: number) {
      const k = strength(env);
      it.charFns.push((i, _g, n) => { const q = easeInOut(staggered(cap(p), i, n, 0.55)); return { dx: -(i - (n - 1) / 2) * it.size * 0.3 * (1 - q) * k, a: q }; });
    } } },
    // 退場: 字間が広がりながら消える
    { group: 'exit', key: 'vscGothicWiden', def: { name: '字間が広がって消える.c', outDur: (dur: number) => Math.min(0.6, dur * 0.3), apply(env: PackEnv, it: PackItem, p: number) {
      const k = strength(env), q = easeInOut(cap(p));
      it.charFns.push((i, _g, n) => ({ dx: (i - (n - 1) / 2) * it.size * 0.22 * q * k, a: 1 - q }));
    } } },
    // 表示中: 止める。ごく小さく息をするだけ
    { group: 'hold', key: 'vscGothicStill', def: { name: '静止（微かな呼吸）.c', apply(env: PackEnv, it: PackItem, amt: number) {
      const k = amt * strength(env);
      it.charFns.push(() => ({ s: 1 + Math.sin(env.lt * 1.1) * 0.004 * k }));
    } } },
    { group: 'cam', key: 'vscGothicCam', def: { name: 'ゆっくり寄る.c', get(env: LayoutEnv) {
      const k = motionOf(env), progress = cap(env.lt / Math.max(0.01, env.cut.dur));
      return { s: 1 + easeInOut(progress) * 0.02 * k, x: 0, y: 0, rot: 0 };
    } } },
  ];
};

export const gothicClaudePack = claudePack({
  id: 'Gothic', name: 'ゴシック・祈り', desc: '黒と白だけ。光が読み、字間が詰まる。巨大な薄い字と小さな本文の対比',
  fonts: { display: [FONT], body: [FONT], serif: [FONT] },
  scheme: { bg: '#050505', fg: '#F4EFE6', sub: '#9A958C', accent: '#F4EFE6', accent2: '#9A958C', dim: '#141414' },
  effects: gothicEffects,
});
