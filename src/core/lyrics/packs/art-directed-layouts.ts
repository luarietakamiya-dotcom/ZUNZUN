import type { PackBox, PackEffect, PackJ } from './types';
import { clean, piecesOf, union, type LayoutEnv, type Rng } from './design-kit';
import { beatOf, easeInOut, easeOut, staggered } from './util';
import { typeArtLayouts } from './layouts/type-art';
import { hyperBeatLayouts } from './layouts/hyper-beat';

type Theme = 'Hyper' | 'Summer' | 'Winter' | 'Gothic' | 'Terminal' | 'Constellation';
const cap = (p: number) => Math.max(0, Math.min(1, p));
const motion = (env: LayoutEnv) => cap(env.fx.motion ?? 0.7);
const reveal = (env: LayoutEnv) => easeOut(cap(env.pIn)) * (1 - easeInOut(cap(env.pOut)));
const ornament = (env: LayoutEnv) => reveal(env) * cap(env.fx.decor ?? 0.5);

/** JIZURAの反復・大小対比・縦横組版を参考に、テーマごとに構図と時間の流れを設計。 */
export function artDirectedLayouts(J: PackJ, theme: Theme): PackEffect[] {
  if (theme === 'Hyper') return hyperBeatLayouts(J);
  if (theme === 'Gothic') return typeArtLayouts(J, theme);
  const names: Record<Theme, string[]> = {
    Hyper: ['衝撃ポスター・大小の切り返し', '反復タイポ・傾いた残像', '分解グリッド・文字の連打'],
    Summer: ['波のリボン・文字のうねり', '潮の流れ・斜めに走る言葉', 'しぶきの円弧・海風の余白'],
    Winter: ['雪の余白・縦横の詩', '氷の結晶・放射状の組版', '凍った残像・層のある文字'],
    Gothic: ['聖堂・尖塔と明朝の対比', '十字の組版・縦横の祈り', '黒白の祭壇・輪郭の反復'],
    Terminal: ['端末・左右に分かれるログ', '端末・走査線と拡大文字', '端末・階段状のコマンド'],
    Constellation: ['星図・軌道に並ぶ文字', '星図・星雲と主役の言葉', '星図・観測グリッド'],
  };
  return names[theme].map((name, variant) => ({ group: 'layout', key: `vsArt${theme}${variant}`, def: {
    name, fits: (n: number) => n >= 1, w: 2, portrait: 1,
    plan: (rng: Rng) => ({ font: theme === 'Winter' ? 'mincho_light' : theme === 'Terminal' ? 'mono' : 'gothic_bold', side: rng.pick([-1, 1]), tilt: rng.range(-6, 6), phase: rng.range(0, Math.PI * 2) }),
    render: (env: LayoutEnv) => renderScene(J, env, theme, variant),
  } }));
}

function renderScene(J: PackJ, env: LayoutEnv, theme: Theme, variant: number): PackBox | null {
  const { W, H, sc } = env, u = Math.min(W, H), k = motion(env), t = env.lt * k;
  const a = ornament(env), seed = env.cut.seed ?? 1, side = Number(env.cut.params.side ?? 1);
  const phase = Number(env.cut.params.phase ?? 0), tilt = Number(env.cut.params.tilt ?? 0);
  const portrait = W < H;
  const font = theme === 'Gothic' ? 'mincho_bold' : theme === 'Winter' ? 'mincho_light' : theme === 'Terminal' ? 'mono' : theme === 'Hyper' ? 'gothic_black' : 'gothic_bold';
  const full = clean(env.cut.text);
  if (!full) return null;
  let bb: PackBox | null = null;
  const draw = (text: string, x: number, y: number, maxW: number, maxH: number, maxSize: number, opt: Record<string, unknown> = {}) => {
    const wrapped = J.splitLines(text, Math.max(2, Math.floor(maxW / Math.max(1, maxSize * 0.9))));
    const size = Math.min(maxSize, J.fitSize(wrapped, font, maxW, maxH));
    const b = J.mainDraw(env, { text: wrapped, font, size, x, y, color: sc.fg, ...opt });
    bb = union(bb, b); return size;
  };
  const line = (pts: [number, number][], color = sc.accent, alpha = a * 0.45, width = u * 0.0015) => { if (env.pass === 'main') env.line(pts, color, Math.max(0.7, width), alpha); };
  const circle = (x: number, y: number, r: number, color = sc.accent, alpha = a * 0.4) => { if (env.pass === 'main') env.circle(x, y, Math.max(0.5, r), null, color, Math.max(0.7, u * 0.001), alpha); };
  const parts = piecesOf(env.cut, 3);
  const chars = [...full].filter(ch => ch.trim());

  if (theme === 'Hyper') {
    const b = beatOf(env), punch = Math.exp(-b.since * 12) * k;
    if (variant === 0) {
      const hero = parts.reduce((best, s, i) => s.length > parts[best]!.length ? i : best, 0);
      parts.forEach((part, i) => {
        const y = H * (0.24 + i * 0.25), large = i === hero;
        draw(part, W * (large ? 0.5 : side > 0 ? 0.32 : 0.68), y, W * (large ? 0.78 : 0.52), H * 0.22, u * (large ? 0.25 : 0.1), { rot: large ? -side * 5 : 0, color: i === hero ? sc.fg : sc.accent, mi: i });
      });
      line([[W * 0.08, H * 0.12], [W * 0.38, H * 0.12]], sc.accent, a * 0.8, u * 0.01);
      line([[W * 0.62, H * 0.88], [W * 0.92, H * 0.88]], sc.accent2, a * 0.8, u * 0.01);
    } else if (variant === 1) {
      for (let i = 0; i < 5; i++) draw(full, W * (0.5 + side * (i - 2) * 0.025), H * (0.19 + i * 0.15), W * 0.73, H * 0.12, u * 0.15, { rot: tilt - side * 6, mi: i * 0.6, color: i === 2 ? sc.fg : sc.accent2, ...(i === 2 ? {} : { fill: false, stroke: u * 0.0018, alpha: 0.35 }) });
    } else {
      const cols = portrait ? 3 : 5, rows = Math.ceil(chars.length / cols);
      const size = Math.min(W * 0.7 / cols * 0.7, H * 0.66 / rows * 0.65, u * 0.23);
      chars.forEach((ch, i) => {
        const x = W * 0.5 + ((i % cols) - (Math.min(cols, chars.length - Math.floor(i / cols) * cols) - 1) / 2) * W * 0.7 / cols;
        const y = H * 0.5 + (Math.floor(i / cols) - (rows - 1) / 2) * H * 0.66 / rows;
        draw(ch, x, y, size * 1.1, size * 1.1, size, { mi: i * 0.35, rot: (i % 2 ? 1 : -1) * 5 * punch, color: (i + b.index) % 3 ? sc.fg : sc.accent });
        line([[x - size * 0.6, y + size * 0.7], [x + size * 0.6, y + size * 0.7]], sc.accent2, a * 0.35);
      });
    }
    for (let i = 0; i < 8; i++) { const x = W * (0.06 + i * 0.13); line([[x, H * 0.05], [x + side * u * 0.06, H * 0.09]], sc.accent, a * (0.3 + punch * 0.3)); }
  } else if (theme === 'Summer') {
    if (variant === 1) {
      parts.forEach((part, i) => draw(part, W * (0.28 + i * 0.22), H * (0.3 + i * 0.2), W * 0.43, H * 0.23, u * (i === 1 ? 0.19 : 0.13), { rot: -8, mi: i, color: i === 1 ? sc.fg : sc.accent2 }));
    } else {
      const cols = portrait ? 6 : 12, rows = Math.ceil(chars.length / cols);
      const step = W * 0.76 / Math.min(cols, chars.length), size = Math.min(step * 0.66, H * 0.48 / rows * 0.6, u * 0.17);
      chars.forEach((ch, i) => {
        const col = i % cols, row = Math.floor(i / cols), count = Math.min(cols, chars.length - row * cols), phase2 = col * 0.42 - t * 1.3 + phase;
        const x = W / 2 + (col - (count - 1) / 2) * step;
        const y = H / 2 + (row - (rows - 1) / 2) * size * 2.4 + (variant === 2 ? -Math.sin(col / Math.max(1, count - 1) * Math.PI) : Math.sin(phase2)) * size * 0.55;
        draw(ch, x, y, size * 1.2, size * 1.2, size, { rot: variant === 2 ? (col / Math.max(1, count - 1) - 0.5) * 22 : Math.cos(phase2) * 6, mi: i * 0.25, color: i % 5 === 0 ? sc.accent2 : sc.fg });
      });
    }
    for (let row = 0; row < 5; row++) {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 60; i++) pts.push([W * (0.04 + i * 0.0153), H * (0.76 + row * 0.03) + Math.sin(i * 0.13 - t * 1.2 + row * 0.5) * u * 0.018]);
      line(pts, row % 2 ? sc.accent2 : sc.accent, a * (0.25 - row * 0.025));
    }
    for (let i = 0; i < 24; i++) {
      const p = (J.r(seed, i, 301) + t * 0.09) % 1, x = W * (0.08 + J.r(seed, i, 302) * 0.84);
      circle(x + Math.sin(t + i) * u * 0.018, H * (0.91 - p * 0.8), u * (0.002 + J.r(seed, i, 303) * 0.012), sc.accent2, a * Math.sin(p * Math.PI) * 0.6);
    }
  } else if (theme === 'Winter') {
    if (variant === 0) {
      parts.forEach((part, i) => draw(part, W * (i === 1 ? 0.64 : 0.37), H * (0.27 + i * 0.22), W * 0.43, H * 0.19, u * (i === 1 ? 0.14 : 0.085), { mi: i * 1.3, track: 0.12 }));
      line([[W * 0.73, H * 0.13], [W * 0.73, H * 0.87]], sc.accent, a * 0.23);
    } else if (variant === 1) {
      const radius = u * 0.27;
      for (let i = 0; i < 6; i++) { const angle = i * Math.PI / 3 - Math.PI / 2; const dx = Math.cos(angle), dy = Math.sin(angle); line([[W / 2, H / 2], [W / 2 + dx * radius, H / 2 + dy * radius]], sc.accent, a * 0.3); for (const f of [0.6, 0.82]) for (const sign of [-1, 1]) line([[W / 2 + dx * radius * f, H / 2 + dy * radius * f], [W / 2 + dx * radius * (f - 0.12) - dy * radius * 0.12 * sign, H / 2 + dy * radius * (f - 0.12) + dx * radius * 0.12 * sign]], sc.accent, a * 0.3); }
      draw(full, W / 2, H / 2, W * 0.67, H * 0.28, u * 0.16, { track: 0.08 });
    } else {
      for (let i = 3; i >= 0; i--) draw(full, W / 2 + i * u * 0.018, H / 2 - i * u * 0.075, W * 0.72, H * 0.2, u * 0.16, { mi: i * 0.7, ...(i ? { fill: false, stroke: u * 0.0009, alpha: 0.18 / i } : {}) });
    }
    for (let i = 0; i < 54; i++) { const depth = 0.3 + J.r(seed, i, 311) * 0.7; const x = W * (0.05 + J.r(seed, i, 312) * 0.9) + Math.sin(t * 0.6 + i) * u * 0.018; const y = ((J.r(seed, i, 313) + t * 0.04 * depth) % 1) * H; if (env.pass === 'main') env.circle(x, y, u * 0.003 * depth, sc.fg, null, 1, a * depth * 0.6); }
  } else if (theme === 'Gothic') {
    const arch = (cx: number, cy: number, w: number, h: number) => {
      line([[cx - w / 2, cy + h / 2], [cx - w / 2, cy - h * 0.05], [cx - w * 0.32, cy - h * 0.34], [cx, cy - h / 2], [cx + w * 0.32, cy - h * 0.34], [cx + w / 2, cy - h * 0.05], [cx + w / 2, cy + h / 2]], '#FFFFFF', a * 0.32);
    };
    if (variant === 0) {
      arch(W * 0.5, H * 0.5, W * 0.64, H * 0.79); arch(W * 0.5, H * 0.5, W * 0.59, H * 0.73);
      parts.forEach((part, i) => draw(part, W * (i === 1 ? 0.52 : 0.47), H * (0.31 + i * 0.19), W * 0.48, H * 0.17, u * (i === 1 ? 0.18 : 0.085), { mi: i * 1.1, track: i === 1 ? 0.02 : 0.14 }));
    } else if (variant === 1) {
      draw(full, W * 0.46, H * 0.53, W * 0.62, H * 0.28, u * 0.17, { track: 0.1 });
      const height = Math.min(H * 0.68, u * 0.6), size = Math.min(height / chars.length * 0.7, u * 0.08);
      chars.forEach((ch, i) => draw(ch, W * 0.77, H / 2 + (i - (chars.length - 1) / 2) * height / chars.length, size * 1.2, size * 1.2, size, { mi: i * 0.25, alpha: 0.55 }));
      line([[W * 0.72, H * 0.12], [W * 0.72, H * 0.88]], '#FFFFFF', a * 0.55);
      line([[W * 0.1, H * 0.3], [W * 0.87, H * 0.3]], '#FFFFFF', a * 0.25);
    } else {
      for (let i = 0; i < 3; i++) draw(full, W * 0.5, H * (0.3 + i * 0.2), W * 0.66, H * 0.16, u * 0.17, { mi: i * 0.8, ...(i !== 1 ? { fill: false, stroke: u * 0.0009, alpha: 0.3 } : { track: 0.04 }) });
      line([[W * 0.15, H * 0.13], [W * 0.15, H * 0.87]], '#FFFFFF', a * 0.4); line([[W * 0.85, H * 0.13], [W * 0.85, H * 0.87]], '#FFFFFF', a * 0.4);
    }
    for (const y of [H * 0.12, H * 0.88]) {
      const arm = u * 0.025;
      line([[W / 2, y - arm], [W / 2, y + arm]], '#FFFFFF', a * 0.8);
      line([[W / 2 - arm * 0.6, y - arm * 0.25], [W / 2 + arm * 0.6, y - arm * 0.25]], '#FFFFFF', a * 0.8);
    }
  } else if (theme === 'Terminal') {
    const x = variant === 1 ? W * 0.5 : W * 0.43;
    parts.forEach((part, i) => draw(part, x + (variant === 2 ? i * W * 0.065 : 0), H * (0.28 + i * 0.22), W * 0.61, H * 0.18, u * (variant === 1 && i === 1 ? 0.19 : 0.09), { mi: i, color: i === 1 ? sc.fg : sc.accent }));
    const progress = cap(env.pIn);
    line([[W * 0.1, H * 0.16], [W * 0.1, H * 0.84]], sc.accent, a * 0.4);
    line([[W * 0.1, H * 0.84], [W * (0.1 + 0.76 * progress), H * 0.84]], sc.accent, a * 0.6);
    for (let i = 0; i < 12; i++) line([[W * 0.84, H * (0.2 + i * 0.05)], [W * (0.84 + J.r(seed, i, 321) * 0.07), H * (0.2 + i * 0.05)]], sc.accent, a * (0.2 + J.r(seed, i, Math.floor(t * 2)) * 0.4));
  } else {
    if (variant === 0) {
      const cols = portrait ? 7 : 13, rows = Math.ceil(chars.length / cols), step = W * 0.76 / Math.min(cols, chars.length), size = Math.min(step * 0.58, H * 0.52 / rows * 0.6, u * 0.11);
      chars.forEach((ch, i) => { const col = i % cols, row = Math.floor(i / cols), n = Math.min(cols, chars.length - row * cols); const angle = (col / Math.max(1, n - 1) - 0.5) * 1.2; const x = W / 2 + (col - (n - 1) / 2) * step; const y = H / 2 + (row - (rows - 1) / 2) * size * 2.5 + Math.cos(angle) * size * 0.9; draw(ch, x, y, size * 1.2, size * 1.2, size, { mi: i * 0.3, rot: angle * 15 }); });
    } else if (variant === 1) {
      parts.forEach((part, i) => draw(part, W * (0.32 + i * 0.17), H * (0.31 + i * 0.19), W * 0.47, H * 0.19, u * (i === 1 ? 0.16 : 0.09), { mi: i }));
    } else {
      draw(full, W / 2, H / 2, W * 0.65, H * 0.32, u * 0.15, { track: 0.1 });
      for (let i = 1; i < 8; i++) line([[W * i / 8, H * 0.12], [W * i / 8, H * 0.88]], sc.accent, a * 0.1);
      for (let i = 1; i < 6; i++) line([[W * 0.08, H * i / 6], [W * 0.92, H * i / 6]], sc.accent, a * 0.1);
    }
    for (let ring = 0; ring < 3; ring++) circle(W / 2, H / 2, u * (0.27 + ring * 0.065), sc.accent, a * (0.24 - ring * 0.04));
    for (let i = 0; i < 22; i++) {
      const angle = J.r(seed, i, 331) * Math.PI * 2 + t * 0.035, radius = u * (0.22 + J.r(seed, i, 332) * 0.23);
      const x = W / 2 + Math.cos(angle) * radius, y = H / 2 + Math.sin(angle) * radius;
      const twinkle = 0.5 + Math.sin(t * 1.5 + i) * 0.2;
      circle(x, y, u * 0.0025, sc.accent, a * twinkle);
      if (i % 3 === 0) line([[x, y], [W / 2 + Math.cos(angle + 0.17) * radius * 0.85, H / 2 + Math.sin(angle + 0.17) * radius * 0.85]], sc.accent, a * 0.2);
    }
  }
  return bb;
}

/** 曲の中盤でも同じ震えが続かず、登場→静止→退場という時間の役割を作る。 */
export function directedCamera(theme: Theme): PackEffect {
  return { group: 'cam', key: `vsCamera${theme}`, def: { name: `${theme === 'Hyper' ? '強く寄って止まる' : 'ゆっくり寄る'}・構図のカメラ`,
    get(env: LayoutEnv) {
      if (theme === 'Gothic') return { s: 1, x: 0, y: 0, rot: 0 };
      if (theme === 'Hyper') { const b = beatOf(env); const hit = Math.exp(-b.since * 12); return { s: 1 + hit * 0.035 * motion(env), x: (b.index % 2 ? 1 : -1) * env.W * hit * 0.004 * motion(env), y: 0, rot: 0 }; }
      const k = motion(env), progress = cap(env.lt / Math.max(0.01, env.cut.dur));
      return { s: 1 + easeInOut(progress) * 0.025 * k, x: 0, y: 0, rot: 0 };
    },
  } };
}

export function directedEnter(theme: Theme): PackEffect {
  return { group: 'enter', key: `vsReveal${theme}`, def: { name: '文字の順序で組み上がる', inDur: (dur: number) => Math.min(theme === 'Hyper' ? 0.42 : 1.1, dur * 0.4),
    apply(env: LayoutEnv, it: { size: number; charFns: ((i: number, g: { i: number }, n: number) => Record<string, number>)[] }, p: number) {
      const k = motion(env);
      it.charFns.push((i, _g, n) => { const q = easeOut(staggered(cap(p), i, n, 0.4)); return { a: q, dy: (1 - q) * it.size * (theme === 'Winter' ? -0.7 : 0.55) * k, sx: 1 - (1 - q) * 0.25 * k, rot: theme === 'Hyper' ? (1 - q) * (i % 2 ? 12 : -12) * k : 0 }; });
    },
  } };
}
