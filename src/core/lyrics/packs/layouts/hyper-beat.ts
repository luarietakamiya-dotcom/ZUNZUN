import type { PackBox, PackEffect, PackJ } from '../types';
import { piecesOf, union, type LayoutEnv } from '../design-kit';
import { beatOf, easeOut, flashAllowed } from '../util';
import { typeArtLayouts } from './type-art';

const cap = (x: number) => Math.max(0, Math.min(1, x));
/** 同じ拡大を繰り返さず、主役・反復・斜めの流れで読む順序を作る。 */
export function hyperBeatLayouts(J: PackJ): PackEffect[] {
  const legacy = typeArtLayouts(J, 'Hyper');
  return ['大小の切り返し', '輪郭の反復と主役', '斜めに受け渡す言葉'].map((name, variant) => ({
    group: 'layout', key: `vsArtHyper${variant}`, def: {
      name: `ハイパー・${name}`, fits: (n: number) => n >= 1, w: 2, portrait: 1,
      plan: (rng: { pick<T>(a: T[]): T }) => ({ font: 'dela', side: rng.pick([-1, 1]) }),
      render: (env: LayoutEnv) => {
        // 保存済みの固定した行アートは、描画と手指定の互換を維持する。
        if (env.cut.params.artText) return (legacy[variant]!.def.render as (e: LayoutEnv) => PackBox | null)(env);
        return renderHyper(J, env, variant);
      },
    },
  }));
}

function renderHyper(J: PackJ, env: LayoutEnv, variant: number): PackBox | null {
  const { W, H, sc } = env, u = Math.min(W, H), portrait = W < H;
  const text = env.cut.text.trim();
  if (!text) return null;
  const parts = piecesOf(env.cut, 3), side = Number(env.cut.params.side ?? 1) < 0 ? -1 : 1;
  const k = cap(env.fx.motion ?? 0.7), decor = cap(env.fx.decor ?? 0.5);
  const beat = beatOf(env), hit = flashAllowed(beat.index, beat.len) ? Math.exp(-beat.since * 12) * k : 0;
  const visible = easeOut(cap(env.pIn)) * (1 - easeOut(cap(env.pOut)));
  let box: PackBox | null = null;
  const draw = (s: string, x: number, y: number, width: number, height: number, max: number, opt: Record<string, unknown> = {}, ghost = false) => {
    const lines = J.splitLines(s, Math.max(2, Math.floor(width / Math.max(1, max))));
    const size = Math.min(max, J.fitSize(lines, 'dela', width, height));
    const item = { text: Array.isArray(lines) ? lines.join('\n') : lines, font: 'dela', size, x, y, color: sc.fg, ...opt };
    // 背後の反復だけを薄い輪郭にし、主役は一度だけ前面に描く。
    if (ghost) { if (env.pass === 'main' && decor > 0) env.draw({ ...item, alpha: 0.22 * decor * visible, fill: false, stroke: Math.max(0.7, u * 0.0015) }); }
    else box = union(box, J.mainDraw(env, item));
  };
  if (variant === 0) {
    const focal = Math.floor(parts.length / 2), step = portrait ? 0.22 : 0.24;
    parts.forEach((part, i) => {
      const hero = i === focal, y = H * (0.5 + (i - (parts.length - 1) / 2) * step);
      draw(part, W * (hero ? 0.5 : 0.5 + side * (i < focal ? -0.14 : 0.14)), y,
        W * (hero ? 0.79 : 0.56), H * (hero ? 0.22 : 0.14), u * (hero ? 0.23 : 0.09),
        { color: hero ? sc.fg : sc.accent, rot: hero ? -side * 3 : 0, mi: i });
    });
  } else if (variant === 1) {
    for (const i of [-2, -1, 1, 2]) {
      draw(text, W * (0.5 + i * side * 0.025), H * (0.5 + i * 0.15), W * 0.75, H * 0.11, u * 0.15,
        { color: sc.accent2 ?? sc.accent, rot: -side * 5 }, true);
    }
    draw(text, W * 0.5, H * 0.5, W * 0.79, H * 0.2, u * 0.2, { rot: -side * 5 });
  } else {
    parts.forEach((part, i) => {
      const middle = i === Math.floor(parts.length / 2);
      const x = parts.length === 1 ? 0.5 : 0.31 + i * 0.19;
      const y = 0.5 + (i - (parts.length - 1) / 2) * (portrait ? 0.23 : 0.22);
      draw(part, W * (side > 0 ? x : 1 - x), H * y, W * (portrait ? 0.6 : 0.47), H * 0.19,
        u * (middle ? 0.2 : 0.12), { rot: -side * 7, mi: i, color: middle ? sc.fg : sc.accent2 ?? sc.accent });
    });
  }
  // アクセントは読み領域の外で拍を示す。全面の明滅や長い影で本文を覆わない。
  if (env.pass === 'main' && decor > 0) {
    const a = visible * decor * (0.35 + hit * 0.3);
    env.line([[W * 0.07, H * 0.12], [W * 0.25, H * 0.12]], sc.accent, u * 0.006, a);
    env.line([[W * 0.75, H * 0.88], [W * 0.93, H * 0.88]], sc.accent2 ?? sc.accent, u * 0.006, a);
  }
  return box;
}
