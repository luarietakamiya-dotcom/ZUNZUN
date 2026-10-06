import type { PackBox, PackEffect, PackJ } from '../types';
import { clean, glyphs, pad, timecode, union, type LayoutEnv, type Rng } from '../design-kit';
import { easeOut } from '../util';
import { cap, decorOf, micro, motionOf, phrases, rule, sizeOf, visible } from './skin';
import { enterFx, exitFx, holdFx } from './effects';
import { claudePack } from './build';

/**
 * 端末・ログ.c — 画面の中の確定的な機械。
 * 学び: 見立て（ログ・反転表示・管理画面の表）／小さな文字の土台（行番号・状態行）／密度の緩急。1 字ずつ打たれ、1 字ずつ消える。
 */
const FONT = 'dot';
function heroFit(J: PackJ, text: string, maxW: number, maxH: number, maxSize: number): { lines: string[]; size: number } {
  const split = J.splitLines(text, Math.max(2, Math.floor(maxW / Math.max(1, maxSize * 0.95))));
  const lines = Array.isArray(split) ? split : [split];
  return { lines, size: Math.min(maxSize, J.fitSize(lines, FONT, maxW, maxH)) };
}

function render(J: PackJ, env: LayoutEnv, variant: number): PackBox | null {
  const { W, H, sc } = env, u = Math.min(W, H), portrait = W < H, decor = decorOf(env), vis = visible(env), k = motionOf(env);
  const text = clean(env.cut.text);
  if (!text) return null;
  const green = sc.accent, amber = sc.accent2 ?? sc.accent, ph = phrases(env), reveal = easeOut(cap(env.pIn * 1.5)), line = env.cut.line;
  const progress = cap(env.lt / Math.max(0.01, env.cut.dur));
  const start = Number.isFinite(env.cut.start) ? env.cut.start : 0;
  let box: PackBox | null = null;
  const put = (item: Record<string, unknown>) => { box = union(box, J.mainDraw(env, item)); };

  if (variant === 0) {
    // ログ: 過去の行が薄く積み上がり、今の行が確定する。右にカーソル。下に進行バー
    const { lines, size } = heroFit(J, ph.hero, W * (portrait ? 0.86 : 0.8), H * 0.22, u * (portrait ? 0.12 : 0.11));
    const m = sizeOf(J, lines, FONT, size), left = W * 0.07, y = H * 0.5;
    for (let r = 4; r >= 1; r--) micro(env, `[${timecode(Math.max(0, start - r * 3.1))}] ok  line ${pad(line + 1 - r, 3)}  ${text}`, left, y - size * 0.4 - r * u * 0.052, u * 0.026, green, (0.62 - r * 0.12) * decor * vis);
    micro(env, '>', left - u * 0.035, y, size * 0.7, amber, 0.95 * decor * vis);
    put({ text: lines.join('\n'), font: FONT, size, x: left + m.w / 2, y, color: sc.fg, mi: 0, shadow: { color: '#58d9a855', blur: size * 0.2, dy: 0 } });
    if (decor > 0.02) env.rect(left + m.w + size * 0.15, y - size * 0.5, size * 0.5, size, green, (Math.floor(env.lt * 2) % 2 === 0 ? 0.9 : 0.15) * vis);
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) micro(env, `// ${rest}`, left, y + size * 0.9, u * 0.03, amber, 0.8 * decor * vis);
    env.rect(0, H * 0.9, W, u * 0.01, green, 0.18 * decor * vis); env.rect(0, H * 0.9, W * progress, u * 0.01, green, 0.9 * decor * vis);
    micro(env, `[OK] ${pad(line + 1, 3)}  ${timecode(start)}`, left, H * 0.95, u * 0.024, green, 0.7 * decor * vis);
  } else if (variant === 1) {
    // 反転表示: 主役が緑のブロックの上に黒で載る。下の状態行は画面の端から端まで
    const { lines, size } = heroFit(J, ph.hero, W * (portrait ? 0.78 : 0.7), H * 0.24, u * (portrait ? 0.12 : 0.115));
    const m = sizeOf(J, lines, FONT, size), left = W * 0.08, y = H * 0.46, pad2 = size * 0.28;
    env.rect(left - pad2, y - m.h / 2 - pad2, (m.w + pad2 * 2) * reveal, m.h + pad2 * 2, green, 0.96 * vis);
    put({ text: lines.join('\n'), font: FONT, size, x: left + m.w / 2, y, color: '#021a12', mi: 0 });
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) micro(env, rest, left, y + m.h / 2 + size * 0.8, u * 0.034, amber, 0.9 * decor * vis);
    env.rect(0, H * 0.94, W, u * 0.04, green, 0.9 * vis);
    micro(env, `NORMAL  utf-8  ln ${line + 1}  ${timecode(start)}`, W * 0.02, H * 0.945 + u * 0.004, u * 0.024, '#021a12', 0.95 * vis);
    for (let i = 0; i < 6; i++) micro(env, pad(line + 1 + i, 3), W * 0.02, H * 0.12 + i * u * 0.05, u * 0.022, green, 0.35 * decor * vis);
  } else if (variant === 2) {
    // 雨: 小さな文字が列になって降る（文字は歌詞の字だけ）。主役は暗い箱の中で白
    const chars = [...text].filter((c) => c.trim()), cols = portrait ? 16 : 30, seed = env.cut.seed ?? 1, cell = W / cols;
    for (let c = 0; c < cols; c++) {
      const speed = 0.12 + J.r(seed, c, 61) * 0.2, head = ((J.r(seed, c, 62) + env.lt * speed * k) % 1.25) * H, run = 7;
      const col = Array.from({ length: run }, (_, r) => chars[(c + r * 3) % chars.length]!).join('\n');
      env.draw({ text: col, font: FONT, size: u * 0.026, x: cell * (c + 0.5), y: head - run * u * 0.014, color: green, alpha: 0.28 * decor * vis, lead: 1.15 });
      env.draw({ text: chars[(c * 5) % chars.length]!, font: FONT, size: u * 0.026, x: cell * (c + 0.5), y: head + u * 0.012, color: sc.fg, alpha: 0.75 * decor * vis });
    }
    const { lines, size } = heroFit(J, ph.hero, W * (portrait ? 0.78 : 0.62), H * 0.2, u * (portrait ? 0.12 : 0.1)), m = sizeOf(J, lines, FONT, size);
    env.rect(W / 2 - m.w / 2 - size * 0.5, H * 0.5 - m.h / 2 - size * 0.45, (m.w + size) * reveal, m.h + size * 0.9, '#030809', 0.9 * vis);
    rule(env, W / 2 - m.w / 2 - size * 0.5, H * 0.5 + m.h / 2 + size * 0.45, W / 2 + m.w / 2 + size * 0.5, H * 0.5 + m.h / 2 + size * 0.45, green, u * 0.003, 0.9 * decor * vis * reveal);
    put({ text: lines.join('\n'), font: FONT, size, x: W / 2, y: H * 0.5, color: sc.fg, mi: 0 });
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) micro(env, rest, W / 2 - m.w / 2, H * 0.5 + m.h / 2 + size * 1.1, u * 0.03, amber, 0.9 * decor * vis);
  } else {
    // 表（管理画面）: 項目名と値。TEXT の行だけが大きい
    const { lines, size } = heroFit(J, ph.hero, W * (portrait ? 0.7 : 0.56), H * 0.22, u * (portrait ? 0.13 : 0.12)), m = sizeOf(J, lines, FONT, size);
    const rows = [['LINE', pad(line + 1, 3)], ['TEXT', ''], ['TIME', timecode(start)], ['LEN', `${pad(glyphs(text), 2)} chars`]], x0 = W * 0.08, x1 = W * 0.34, rowH = H * 0.16, y0 = H * 0.2;
    rows.forEach(([label, value], i) => {
      const y = y0 + i * rowH, a = easeOut(cap(env.pIn * 1.8 - i * 0.12)) * (1 - cap(env.pOut));
      rule(env, x0, y + rowH * 0.5, W * 0.92, y + rowH * 0.5, green, u * 0.0016, 0.35 * decor * a);
      micro(env, label!, x0, y, u * 0.036, green, 0.85 * decor * a);
      if (value) micro(env, value, x1, y, u * 0.052, amber, 0.95 * decor * a);
    });
    put({ text: lines.join('\n'), font: FONT, size, x: x1 + m.w / 2, y: y0 + rowH * 1, color: sc.fg, mi: 0 });
    const barW = (W * 0.5) * cap(glyphs(text) / 20); env.rect(x1, y0 + rowH * 3 + u * 0.03, W * 0.5, u * 0.014, green, 0.2 * decor * vis); env.rect(x1, y0 + rowH * 3 + u * 0.03, barW * reveal, u * 0.014, green, 0.9 * decor * vis);
    const rest = [...ph.pre, ...ph.post].join(' ');
    if (rest) micro(env, rest, x1, y0 + rowH * 2 + u * 0.05, u * 0.03, amber, 0.8 * decor * vis);
  }
  return box;
}

const effects = (J: PackJ): PackEffect[] => {
  const layoutDef = (variant: number, key: string, name: string, w: number): PackEffect => ({
    group: 'layout', key, def: { name, fits: () => true, w, portrait: 1, plan: (rng: Rng) => ({ font: FONT, side: rng.pick([-1, 1]) }), render: (env: LayoutEnv) => render(J, env, variant) },
  });
  return [
    layoutDef(0, 'vscTermLog', 'ログに確定する.c', 3),
    layoutDef(1, 'vscTermBlock', '反転表示のブロック.c', 2),
    layoutDef(2, 'vscTermRain', '文字の雨と箱.c', 1.6),
    layoutDef(3, 'vscTermTable', '管理画面の表.c', 1.4),
    // 登場: 1 字ずつ打たれる。着地の瞬間に少しだけ横にずれる
    enterFx('vscTermType', '1 字ずつ打たれる.c', 0.55, 0.85, (q, _i, _n, it, k) => ({ hide: q <= 0, dx: q > 0 && q < 0.25 ? it.size * 0.06 * k : 0 })),
    exitFx('vscTermDelete', '末尾から消される.c', 0.4, 0, (q, i, n) => ({ hide: q * n > n - 1 - i })),
    holdFx('vscTermIdle', 'ほぼ静止.c', () => ({})),
  ];
};

export const terminalClaudePack = claudePack({
  id: 'Terminal', name: '端末・ログ', desc: 'ログ・反転表示・文字の雨・管理画面の表。1 字ずつ打たれ、末尾から消える',
  fonts: { display: [FONT], body: [FONT], serif: [FONT] },
  scheme: { bg: '#030809', fg: '#E8FFF6', sub: '#58D9A8', accent: '#58D9A8', accent2: '#FFB454', dim: '#08140f' },
  effects,
});
