import type { PackBox, PackEffect, PackEnv, PackItem, PackJ } from '../types';
import { clean, glyphs, pad, timecode, union, type LayoutEnv, type Rng } from '../design-kit';
import { easeOut, staggered } from '../util';
import { beatHit, cap, decorOf, ghostGlyph, local, micro, phrases, rule, sideOf, sizeOf, visible } from './skin';
import { claudePack } from './build';

/**
 * ハイパー・ビート.c — 拍で色面と文字が殴り合うポスター。
 * 学び（docs/LYRIC_MOTION_RESEARCH.md）: 主従（主役と、ずっと小さな語尾）／色面と斜めの帯／反復の積み上げ／キー／巨大な薄い字／小さな文字の土台。
 * 文字を大きくして埋めない。主役は 1 つ、語尾は主役の 25 % 前後で主役の縁に揃える。
 */
const FONT = 'dela';
const TILT = 6;

type Fit = { lines: string[]; size: number };
function heroFit(J: PackJ, text: string, maxW: number, maxH: number, maxSize: number): Fit {
  const split = J.splitLines(text, Math.max(2, Math.floor(maxW / Math.max(1, maxSize * 0.9))));
  const lines = Array.isArray(split) ? split : [split];
  const size = Math.min(maxSize, J.fitSize(lines, FONT, maxW, maxH));
  return { lines, size };
}
const first = (s: string): string => [...clean(s)].find((c) => c.trim()) ?? '';

/** 色面（斜めの帯）。本文の下に敷く。装飾が 0 のときは出さない */
function slab(env: LayoutEnv, cx: number, cy: number, ang: number, w: number, h: number, side: 1 | -1, size: number, color: string, alpha: number): void {
  if (env.pass !== 'main' || alpha <= 0.02) return;
  const reveal = easeOut(cap(env.pIn * 1.8)) * (1 - easeOut(cap(env.pOut * 2.4)));
  if (reveal <= 0.01) return;
  const half = h / 2 + size * 0.3, reach = Math.max(env.W, env.H) * 1.2, slant = half * 0.45;
  const near = w / 2 + size * 0.5;
  // 画面の外から流れ込む。reveal が 1 で、片側は画面の外へはみ出す
  const a = side > 0 ? -reach : near - (near + reach) * reveal;
  const b = side > 0 ? -reach + (near + reach) * reveal : reach;
  const pts: [number, number][] = [local(cx, cy, ang, a + slant, -half), local(cx, cy, ang, b + slant, -half), local(cx, cy, ang, b - slant, half), local(cx, cy, ang, a - slant, half)];
  env.poly(pts, color, alpha);
}

function render(J: PackJ, env: LayoutEnv, variant: number): PackBox | null {
  const { W, H, sc } = env, u = Math.min(W, H), portrait = W < H, side = sideOf(env), decor = decorOf(env), vis = visible(env);
  const text = clean(env.cut.text);
  if (!text) return null;
  const ang = -TILT * side, pink = sc.accent, cyan = sc.accent2 ?? sc.accent;
  const ph = phrases(env), heroText = ph.hero;
  const beat = beatHit(env);
  let box: PackBox | null = null;
  const put = (item: Record<string, unknown>) => { box = union(box, J.mainDraw(env, item)); };

  if (variant === 0) {
    // スラブ: 主役を傾いた色面に載せ、語尾を主役の右下の縁に揃える
    const { lines, size } = heroFit(J, heroText, W * (portrait ? 0.84 : 0.66), H * (portrait ? 0.24 : 0.3), u * (portrait ? 0.25 : 0.23));
    const m = sizeOf(J, lines, FONT, size);
    const cx = W * 0.5 + side * W * 0.012 + side * size * 0.05 * beat.hit, cy = H * (portrait ? 0.46 : 0.5);
    ghostGlyph(env, first(heroText), W * (0.5 - side * 0.24), H * 0.9, u * 1.35, FONT, pink, 0.07 * decor * vis);
    slab(env, cx, cy, ang, m.w, m.h, side, size, pink, 0.95 * (decor > 0.05 ? 1 : 0));
    // 小さな文字の土台: 帯の下に主役の語を細かく反復
    const strip = `${heroText}  `.repeat(10);
    for (let k = 0; k < 3; k++) {
      const [sx, sy] = local(cx, cy, ang, -m.w / 2, m.h / 2 + size * 0.5 + k * u * 0.032);
      micro(env, strip, sx, sy, u * 0.022, cyan, (0.55 - k * 0.14) * decor * vis, { rot: ang });
    }
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: sc.fg, rot: ang, mi: 0, shadow: { color: '#00000099', blur: size * 0.05, dy: size * 0.025 } });
    // 語尾: 主役の 25 % の大きさ。主役の右下の縁に揃え、2 つ目は左上の縁に揃える
    const tsize = size * 0.26;
    if (ph.post.length) { const [tx, ty] = local(cx, cy, ang, m.w / 2, m.h / 2 + tsize * 1.35); put({ text: ph.post.join(' '), font: FONT, size: tsize, x: tx, y: ty, color: cyan, rot: ang, align: 'right', mi: 1 }); }
    if (ph.pre.length) { const [tx, ty] = local(cx, cy, ang, -m.w / 2, -(m.h / 2 + tsize * 1.2)); put({ text: ph.pre.join(' '), font: FONT, size: tsize, x: tx, y: ty, color: cyan, rot: ang, align: 'left', mi: 2 }); }
    micro(env, `No.${pad(env.cut.line + 1, 2)}`, W * 0.04, H * 0.07, u * 0.026, cyan, 0.75 * decor * vis);
    micro(env, timecode(Number.isFinite(env.cut.start) ? env.cut.start : 0), W * 0.96 - u * 0.2, H * 0.07, u * 0.026, cyan, 0.6 * decor * vis);
    for (let i = 0; i < 4; i++) env.rect(W * 0.04 + i * u * 0.035, H * 0.93, u * 0.022, u * 0.022, pink, (beat.index % 4 === i ? 0.95 : 0.25) * decor * vis);
  } else if (variant === 1) {
    // 積み上げ: 同じ語を輪郭で積み、中央の 1 行だけが実体。最後に語尾が縁に付く
    const rows = glyphs(text) > 10 ? 3 : portrait ? 4 : 5, mid = Math.floor(rows / 2);
    const { lines, size } = heroFit(J, text, W * 0.84, H * 0.2, u * 0.2);
    const rowH = size * (lines.length > 1 ? 1.5 : 0.8), cx = W * 0.5 + side * W * 0.02, cy = H * 0.5;
    for (let i = 0; i < rows; i++) {
      if (i === mid) continue;
      const d = Math.abs(i - mid), a = (0.62 - d * 0.14) * decor * vis * easeOut(cap(env.pIn * 1.6 - d * 0.18));
      env.draw({ text: lines.join('\n'), font: FONT, size, x: cx + (i - mid) * side * size * 0.06, y: cy + (i - mid) * rowH, color: i < mid ? cyan : pink, alpha: a, fill: false, stroke: Math.max(1, u * 0.003), rot: ang });
    }
    put({ text: lines.join('\n'), font: FONT, size, x: cx, y: cy, color: sc.fg, rot: ang, mi: 0, shadow: { color: '#000000aa', blur: size * 0.05, dy: size * 0.03 } });
    micro(env, `×${rows}`, W * 0.92 - u * 0.08, cy + (rows - 1 - mid) * rowH + size * 0.7, u * 0.03, pink, 0.8 * decor * vis);
    rule(env, W * 0.06, H * 0.92, W * 0.06 + W * 0.88 * easeOut(cap(env.pIn)), H * 0.92, cyan, u * 0.004, 0.7 * decor * vis);
    micro(env, `No.${pad(env.cut.line + 1, 2)}`, W * 0.04, H * 0.07, u * 0.026, cyan, 0.75 * decor * vis);
  } else if (variant === 2) {
    // 巨大な薄い字 + 小さめの本文: 読ませる文字は画面の下寄りに左揃えで、右に語尾が基線を揃えて続く
    const { lines, size } = heroFit(J, heroText, W * (portrait ? 0.84 : 0.66), H * 0.22, u * (portrait ? 0.19 : 0.18));
    const m = sizeOf(J, lines, FONT, size), left = portrait ? W * 0.08 : W * 0.09, y = H * (portrait ? 0.64 : 0.62);
    ghostGlyph(env, first(text), W * (0.5 + side * 0.2), H * 0.52, u * 1.6, FONT, pink, 0.1 * decor * vis);
    rule(env, left, y - m.h / 2 - size * 0.4, left + m.w * easeOut(cap(env.pIn * 1.4)), y - m.h / 2 - size * 0.4, cyan, u * 0.005, 0.9 * decor * vis);
    put({ text: lines.join('\n'), font: FONT, size, x: left + m.w / 2, y, color: sc.fg, mi: 0, shadow: { color: '#000000aa', blur: size * 0.05, dy: size * 0.03 } });
    const tsize = size * 0.3;
    if (ph.post.length) put({ text: ph.post.join(' '), font: FONT, size: tsize, x: left + m.w + size * 0.3, y: y + m.h / 2 - tsize * 0.5, color: cyan, align: 'left', mi: 1 });
    if (ph.pre.length) put({ text: ph.pre.join(' '), font: FONT, size: tsize, x: left, y: y - m.h / 2 - size * 0.4 - tsize * 0.9, color: pink, align: 'left', mi: 2 });
    const strip = `${text}  `.repeat(14);
    micro(env, strip, W * 0.02, H * 0.92, u * 0.022, cyan, 0.5 * decor * vis);
    micro(env, `No.${pad(env.cut.line + 1, 2)}  /  ${timecode(Number.isFinite(env.cut.start) ? env.cut.start : 0)}`, W * 0.04, H * 0.07, u * 0.026, cyan, 0.7 * decor * vis);
  } else {
    // キー: 文字が 1 つずつキーになり、拍ごとに次のキーが押されて色が変わる
    const chars = [...text].filter((c) => c.trim()), n = chars.length, cols = portrait ? Math.min(n, 4) : n, rowsN = Math.ceil(n / cols);
    const pitch = Math.min((W * 0.86) / cols, (H * 0.5) / rowsN, u * 0.27), keyW = pitch * 0.88, size = keyW * 0.6;
    const lit = beat.index % n;
    chars.forEach((ch, i) => {
      const r = Math.floor(i / cols), c = i % cols, cnt = Math.min(cols, n - r * cols);
      const x = W / 2 + (c - (cnt - 1) / 2) * pitch, y = H * 0.5 + (r - (rowsN - 1) / 2) * pitch * 1.05;
      const down = i === lit ? beat.hit * pitch * 0.07 : 0, a = easeOut(cap(env.pIn * 1.6 - i * 0.08)) * (1 - easeOut(cap(env.pOut)));
      env.rrect(x - keyW / 2, y + down + pitch * 0.07 - keyW / 2, keyW, keyW, pitch * 0.14, '#000000', 0.45 * a);
      env.rrect(x - keyW / 2, y + down - keyW / 2, keyW, keyW, pitch * 0.14, i === lit ? pink : '#ECE8E0', a, false, '#00000066', 1);
      put({ text: ch, font: FONT, size, x, y: y + down, color: i === lit ? '#ffffff' : '#111111', mi: i });
    });
    micro(env, `KEY ${pad(lit + 1, 2)} / ${pad(n, 2)}`, W * 0.04, H * 0.07, u * 0.026, cyan, 0.75 * decor * vis);
  }
  return box;
}

const hyperEffects = (J: PackJ): PackEffect[] => {
  const strength = (env: PackEnv) => cap(env.fx.motion ?? 0.7);
  const layoutDef = (variant: number, name: string, fits: (n: number) => boolean, w: number) => ({
    group: 'layout' as const, key: `vscHyper${['Slab', 'Stack', 'Ghost', 'Keys'][variant]}`, def: {
      name, fits, w, portrait: 1,
      plan: (rng: Rng) => ({ font: FONT, side: rng.pick([-1, 1]) }),
      render: (env: LayoutEnv) => render(J, env, variant),
    },
  });
  return [
    layoutDef(0, 'スラブ（色面に載る主役）.c', () => true, 3),
    layoutDef(1, '積み上げ（輪郭の反復）.c', () => true, 2),
    layoutDef(2, '巨大な薄い字 + 本文.c', () => true, 2),
    layoutDef(3, 'キー（拍で押される）.c', (n) => n >= 3 && n <= 8, 1.6),
    // 登場: 上から大きく落ちて決まる（語ごとに遅れる）。着地は速く、あとは止まる
    { group: 'enter', key: 'vscHyperSlam', def: { name: '叩きつけ.c', inDur: (dur: number) => Math.min(0.32, dur * 0.35), apply(env: PackEnv, it: PackItem, p: number) {
      const k = strength(env);
      it.charFns.push((i, _g, n) => { const q = 1 - (1 - staggered(cap(p), i, n, 0.3)) ** 4; return { s: 1 + (1 - q) * 1.1 * k, a: cap(q * 6), rot: (1 - q) * ((i % 2) ? 7 : -7) * k, dy: -(1 - q) * it.size * 0.22 * k }; });
    } } },
    { group: 'enter', key: 'vscHyperSweep', def: { name: '横から滑り込む.c', inDur: (dur: number) => Math.min(0.36, dur * 0.35), apply(env: PackEnv, it: PackItem, p: number) {
      const k = strength(env);
      it.charFns.push((i, _g, n) => { const q = easeOut(staggered(cap(p), i, n, 0.5)); return { dx: -(1 - q) * it.size * 0.8 * k, a: q }; });
    } } },
    // 退場: 主役が先に落ちる。短く
    { group: 'exit', key: 'vscHyperDrop', def: { name: '主役が落ちる.c', outDur: (dur: number) => Math.min(0.2, dur * 0.25), apply(env: PackEnv, it: PackItem, p: number) {
      const k = strength(env);
      it.charFns.push((i) => ({ s: 1 - p * 0.12 * k, dy: p * p * it.size * 0.5 * k, a: 1 - cap(p * 1.3), rot: (i % 2 ? 1 : -1) * p * 8 * k }));
    } } },
    { group: 'exit', key: 'vscHyperSlice', def: { name: '切れてずれる.c', outDur: (dur: number) => Math.min(0.22, dur * 0.25), apply(env: PackEnv, it: PackItem, p: number) {
      const k = strength(env);
      it.charFns.push((i) => ({ dx: (i % 2 ? 1 : -1) * p * it.size * 0.7 * k, a: 1 - cap(p * 1.2) }));
    } } },
    // 表示中: 拍で形だけを動かす（明るさは動かさない）。毎秒 3 回まで
    { group: 'hold', key: 'vscHyperBeat', def: { name: '拍で脈打つ.c', apply(env: PackEnv, it: PackItem, amt: number) {
      const b = env.beat && env.beat.len > 0 ? env.beat : { index: Math.floor(env.lt / 0.5), since: env.lt % 0.5, len: 0.5 };
      const every = Math.max(1, Math.ceil(1 / (3 * b.len) - 1e-9)), on = b.index % every === 0, k = amt * strength(env);
      const pulse = on ? Math.exp(-b.since * 11) : 0;
      it.charFns.push(() => ({ s: 1 + pulse * 0.04 * k }));
    } } },
    { group: 'cam', key: 'vscHyperCam', def: { name: '拍で小さく寄る.c', get(env: LayoutEnv) {
      const b = beatHit(env); return { s: 1 + b.hit * 0.018, x: 0, y: 0, rot: 0 };
    } } },
  ];
};

export const hyperClaudePack = claudePack({
  id: 'Hyper', name: 'ハイパー・ビート', desc: '拍で色面と文字が殴り合うポスター。主役は 1 つ、語尾は縁に揃えて小さく',
  fonts: { display: [FONT], body: [FONT], serif: [FONT] },
  scheme: { bg: '#07070b', fg: '#FFFFFF', sub: '#FFFFFF', accent: '#FF3DB8', accent2: '#29E6FF', dim: '#15151c' },
  effects: hyperEffects,
});
