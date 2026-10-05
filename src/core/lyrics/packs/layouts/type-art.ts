import type { PackBox, PackEffect, PackJ } from '../types';
import type { LayoutEnv } from '../design-kit';
import { union } from '../design-kit';
import { beatOf, easeOut, easeOutBack, flashAllowed } from '../util';

const cap = (x: number) => Math.max(0, Math.min(1, x));
export type TypeArtTheme = 'Hyper' | 'Gothic';
export function typeArtLayouts(J: PackJ, theme: TypeArtTheme): PackEffect[] {
  const font = theme === 'Hyper' ? 'dela' : 'tokumin';
  return [0, 1, 2].map(variant => ({ group: 'layout', key: `vsArt${theme}${variant}`, def: {
    name: `${theme === 'Hyper' ? '回る光と長い影' : '光が読む'}・${['格子', '段組み', '縦横の流れ'][variant]}`,
    fits: (n: number) => n >= 1, w: 2, portrait: 1,
    plan: () => ({ font, artVariant: variant }),
    render: (env: LayoutEnv) => renderTypeArt(J, env, theme, variant),
  } }));
}

/** 本体と効果を別に描く。動きの時計は行全体で共有し、カット境界でリセットしない。 */
function renderTypeArt(J: PackJ, env: LayoutEnv, theme: TypeArtTheme, variant: number): PackBox | null {
  const { W, H } = env, P = env.cut.params;
  const chars = [...String(P.artText ?? env.cut.text).replace(/\s/g, '')];
  if (!chars.length) return null;
  const start = Number(P.artStart ?? env.cut.start), end = Number(P.artEnd ?? (env.cut.start + env.cut.dur));
  const now = env.t ?? (env.cut.start + env.lt), t = now - start, dur = end - start;
  const k = cap(env.fx.motion ?? 0.7), decor = cap(env.fx.decor ?? 0.5);
  const fade = cap((end - now) / Math.min(0.18, Math.max(0.01, dur * 0.15)));
  const times = Array.isArray(P.artTimes) ? P.artTimes as number[] : chars.map(() => start);
  const font = theme === 'Hyper' ? 'dela' : 'tokumin';
  const rows = chars.length <= 2 ? (W < H ? chars.length : 1) : Math.max(1, Math.min(chars.length,
    Math.round(Math.sqrt(chars.length * H / W)) + (variant === 1 && chars.length > 4 ? 1 : 0)));
  const cols = Math.ceil(chars.length / rows), cellH = H / rows;
  let bb: PackBox | null = null;
  const cells = chars.map((ch, i) => {
    const row = Math.floor(i / cols), count = Math.min(cols, chars.length - row * cols), cellW = W / count;
    const size = Math.min(cellH * 0.94, cellW * 0.94);
    // 字形は書体のメトリクスで枠内へ。セルの幅に合わせるが極端な横伸ばしはしない。
    const m = J.measure({ text: ch, font, size, x: 0, y: 0 });
    const sx = Math.min(1.5, cellW * 0.94 / Math.max(1, m.w));
    const sy = Math.min(1.35, cellH * 0.94 / Math.max(1, m.h));
    return { ch, x: (i % cols + 0.5) * cellW, y: (row + 0.5) * cellH, size, sx, sy, w: m.w * sx, h: m.h * sy, i };
  });
  const b = beatOf(env), beatLen = b.len * Math.max(1, Math.ceil(1 / (3 * b.len)));
  const phase = k ? Math.floor((now - b.since) / beatLen) : 0;
  const since = k ? ((now - b.since) % beatLen + b.since) : 0;
  const angles = variant === 2 ? [1.57, 0.65, 2.49] : variant === 1 ? [2.49, 1.57, 0.65] : [0.65, 1.57, 2.49];
  const angle = k ? angles[(phase + 2) % 3]! + (angles[phase % 3]! - angles[(phase + 2) % 3]!) * easeOutBack(cap(since / 0.2), 1.1) : angles[0]!;
  const pulse = k && flashAllowed(b.index, b.len) ? Math.exp(-b.since * 9) * k : 0;
  const scan = cap(t / Math.min(1.25, Math.max(0.2, dur * 0.35)));
  const paint = (c: typeof cells[number], opts: Record<string, unknown>) => env.draw({ text: c.ch, font, size: c.size, x: c.x, y: c.y, sx: c.sx, sy: c.sy, color: '#FFFFFF', noWeight: true, ...opts });
  // 装飾はmain passだけ。透過歌詞レイヤーを全面の不透明な背景で覆わない。
  if (env.pass === 'main' && decor > 0) {
    for (const c of cells) {
      const age = now - (times[c.i] ?? start), enter = easeOut(cap(age / 0.2));
      if (theme === 'Hyper') {
        const dx = Math.cos(angle), dy = Math.sin(angle);
        const edgeX = dx > 0 ? (W - c.x) / dx : dx < 0 ? -c.x / dx : Infinity;
        const length = Math.min(edgeX, (H - c.y) / Math.max(0.01, dy)) * 1.05;
        // フィルターに依存せず、プレビューと書き出しで同じ影を描く。
        const copies = Math.min(110, Math.max(24, Math.ceil(length * Number((env as unknown as { scale?: number }).scale ?? 1))));
        for (let j = copies; j >= 1; j--) {
          const f = j / copies;
          paint(c, { x: c.x + Math.cos(angle) * length * f, y: c.y + Math.sin(angle) * length * f,
            color: f < 0.55 ? '#FF48C4' : '#8A2F96', alpha: (1 - f * f) * 0.7 * fade * enter * decor,
            sx: c.sx * (1 + pulse * 0.04), sy: c.sy * (1 + pulse * 0.04) });
        }
      }
    }
    if (theme === 'Gothic' && k > 0 && scan < 1) {
      const vertical = variant === 2, span = vertical ? H : W;
      const cx = variant === 1 ? span * (1.15 - scan * 1.3) : span * (-0.15 + scan * 1.3), width = span * 0.25;
      if (typeof env.ctx.createLinearGradient === 'function') {
        env.ctx.save(); const g = env.ctx.createLinearGradient(vertical ? 0 : cx - width, vertical ? cx - width : 0, vertical ? 0 : cx + width, vertical ? cx + width : 0);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,255,255,${0.1 * decor * fade})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        env.ctx.fillStyle = g; env.ctx.fillRect(vertical ? 0 : cx - width, vertical ? cx - width : 0, vertical ? W : width * 2, vertical ? width * 2 : H); env.ctx.restore();
      }
    }
  }
  for (const c of cells) {
    const age = now - (times[c.i] ?? start), enter = easeOut(cap(age / 0.2));
    const rank = variant === 1 ? 1 - c.x / W : variant === 2 ? c.y / H : c.x / W;
    const lit = k ? easeOut(cap((scan - rank + 0.12) / 0.24)) : 1;
    const alpha = theme === 'Gothic' ? (0.09 + 0.91 * lit) * enter * fade : enter * fade;
    const compress = theme === 'Gothic' ? 1 + (1 - lit) * (1 / 0.86 - 1) * k : 1;
    const x = Math.max(c.w * 0.52, Math.min(W - c.w * 0.52, W / 2 + (c.x - W / 2) * compress));
    const body = { text: c.ch, font, size: c.size, x, y: c.y, color: '#FFFFFF', noWeight: true,
      alpha, sx: c.sx * (1 + pulse * (theme === 'Hyper' ? 0.04 : 0)), sy: c.sy * (1 + pulse * (theme === 'Hyper' ? 0.04 : 0)) };
    bb = union(bb, P.artText ? env.draw(body) : J.mainDraw(env, body));
  }
  return bb;
}
