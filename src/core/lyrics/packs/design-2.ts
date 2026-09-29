import { clean, DESIGN_SET, type DrawItem, fontsOf, isMain, type LayoutEnv, type Rng, shown, union, wordsOf } from './design-kit';
import type { PackBox, PackEffect, PackJ } from './types';
import { beatOf, easeIn, easeInOut, easeOut, easeOutBack } from './util';

/**
 * 図案 (ZUNZUN) のオリジナルのレイアウト、2 つめの組 (大きな一文字・切り取り線・円の打ち抜き・二分割・タイムライン・テロップ)。
 * 書き方は design.ts の先頭のコメントと同じ。
 */

/** 語が多すぎるときは、隣どうしをつないで max 個までにする */
function mergeWords(words: string[], max: number): string[] {
  const out = [...words];
  while (out.length > max) {
    // いちばん短い隣どうしをつなぐ
    let best = 0;
    for (let i = 1; i < out.length - 1; i++) if (out[i]!.length + out[i + 1]!.length < out[best]!.length + out[best + 1]!.length) best = i;
    out.splice(best, 2, out[best]! + out[best + 1]!);
  }
  return out;
}

/** 語に分ける。1 語しか無ければ文字ごとに分けてから、max 個までにつなぐ (1 つの紙片・1 つの点だけにならないように) */
function piecesOf(cut: LayoutEnv['cut'], max: number): string[] {
  const w = wordsOf(cut);
  const base = w.length >= 2 ? w : [...clean(cut.text)].filter((c) => c.trim());
  return mergeWords(base, max);
}

const staggerOf = (env: LayoutEnv): number => (env.cut as { stagger?: number }).stagger ?? 0.04;

export function designEffects2(J: PackJ): PackEffect[] {
  const set = DESIGN_SET;
  return [
    // ------------------------------------------------------------ 7. 大きな一文字
    {
      group: 'layout',
      key: 'zzGiantChar',
      def: {
        name: '大きな一文字',
        tags: ['graphic', 'editorial'],
        set,
        treat: 'safe',
        fits: (n: number) => n >= 1 && n <= 18,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({
          font: rng.pick(fontsOf(st, ['display', 'serif'])),
          fb: rng.pick(fontsOf(st, ['body', 'display'])),
          flip: rng.chance(0.4),
          outline: rng.chance(0.35),
        }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; fb: string; flip: boolean; outline: boolean };
          const port = W < H;
          const chars = [...clean(env.cut.text)];
          const head = chars[0] ?? '';
          const rest = chars.slice(1).join('').trim();
          // 雑誌の頭文字のように、最初の 1 文字だけを画面の高さほどに
          const G = rest ? (port ? Math.min(W * 0.72, H * 0.4) : Math.min(H * 0.76, W * 0.4)) : Math.min(H * 0.8, W * 0.7);
          const gx = !rest ? W / 2 : port ? W / 2 : P.flip ? W * 0.66 : W * 0.3;
          const gy = port && rest ? H * 0.38 : H / 2;
          const giant: DrawItem = { text: head, mi: 0, font: P.font, size: G, x: gx, y: gy, color: sc.accent };
          if (P.outline) Object.assign(giant, { fill: false, stroke: Math.max(3, G * 0.02), strokeColor: sc.accent });
          let bb = J.mainDraw(env, giant);
          if (!rest) return bb;
          const lines = J.splitLines(rest, port ? 7 : 8) as string;
          const opt = { track: 0.04, lead: 1.25 };
          const rs = Math.min(J.fitSize(lines, P.fb, port ? W * 0.8 : W * 0.4, H * 0.3, opt), H * 0.1);
          const mh = J.measure({ text: lines, font: P.fb, size: rs, ...opt }).h;
          const align = port ? 'center' : P.flip ? 'right' : 'left';
          const rx = port ? W / 2 : P.flip ? gx - G * 0.58 : gx + G * 0.58;
          const ry = port ? gy + G * 0.62 + mh / 2 : gy + G * 0.38 - mh / 2;
          bb = union(bb, J.mainDraw(env, { text: lines, mi: 1, font: P.fb, size: rs, x: rx, y: ry, align, ...opt, color: sc.fg }));
          // 残りの文字の上に、細い罫が伸びる
          if (isMain(env)) {
            const e = shown(env, J, 0.4, env.cut.inDur * 0.5);
            const len = (port ? W * 0.5 : W * 0.3) * e;
            const ly = ry - mh / 2 - rs * 0.6;
            const lx = port ? W / 2 - len / 2 : P.flip ? rx - len : rx;
            env.rect(lx, ly, len, Math.max(2, rs * 0.06), sc.fg, 0.85, false);
          }
          return bb;
        },
      },
    },
    // ------------------------------------------------------------ 8. 切り取り線
    {
      group: 'layout',
      key: 'zzCutPieces',
      def: {
        name: '切り取り線',
        tags: ['graphic', 'pop', 'editorial'],
        set,
        treat: false,
        fits: (n: number) => n >= 2 && n <= 24,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['display', 'body'])), tilt: rng.range(2, 5) }),
        render(env: LayoutEnv) {
          const { W, H, sc, ctx } = env;
          const P = env.cut.params as { font: string; tilt: number };
          const port = W < H;
          const words = piecesOf(env.cut, port ? 4 : 6);
          const k = words.length;
          const s0 = (port ? H * 0.065 : H * 0.12) * (words.length <= 2 ? 1.4 : 1);
          const track = 0.02;
          const wid = words.map((w) => J.measure({ text: w, font: P.font, size: s0, track }).w);
          const padX = s0 * 0.45;
          const gap = s0 * 0.35;
          // 1 行に収まらなければ 2 行に分ける
          const rowOf = (i: number, rows: number) => (rows === 1 ? 0 : i < Math.ceil(k / 2) ? 0 : 1);
          const widthOf = (rows: number, r: number) =>
            words.reduce((acc, _w, i) => (rowOf(i, rows) === r ? acc + wid[i]! + padX * 2 + gap : acc), -gap);
          let rows = 1;
          if (widthOf(1, 0) > W * 0.88 && k >= 2) rows = 2;
          const maxRow = Math.max(widthOf(rows, 0), rows === 2 ? widthOf(rows, 1) : 0);
          const scale = Math.min(1, (W * 0.88) / Math.max(1, maxRow));
          const size = s0 * scale;
          const slipH = size * 1.55;
          const rowGap = slipH * 1.5;
          const seed = env.cut.seed ?? 1;
          let bb: PackBox | null = null;
          for (let r = 0; r < rows; r++) {
            const idx = words.map((_w, i) => i).filter((i) => rowOf(i, rows) === r);
            const total = widthOf(rows, r) * scale;
            const cy = H / 2 + (r - (rows - 1) / 2) * rowGap;
            // 画面を横切る切り取り線 (点線)
            if (isMain(env)) {
              const e = shown(env, J, 0.35);
              ctx.save();
              ctx.setLineDash([size * 0.18, size * 0.12]);
              env.line([[0, cy + slipH * 0.62], [W * e, cy + slipH * 0.62]], sc.sub ?? sc.fg, Math.max(1.5, size * 0.03), 0.7 * e, false);
              ctx.restore();
            }
            let x = W / 2 - total / 2;
            for (const i of idx) {
              const w = (wid[i]! + padX * 2) * scale;
              const cx = x + w / 2;
              x += w + gap * scale;
              const rot = J.rs(seed, i, 601) * P.tilt;
              if (isMain(env)) {
                // 紙片: 語が出るのと同じ遅れで現れる
                const e = shown(env, J, 0.18, i * staggerOf(env));
                if (e > 0) {
                  ctx.save();
                  ctx.translate(cx, cy);
                  ctx.rotate(rot * J.DEG);
                  const q = easeOutBack(e, 1.4);
                  ctx.scale(q, q);
                  env.rect(-w / 2, -slipH / 2, w, slipH, sc.fg, 1, false);
                  ctx.setLineDash([size * 0.12, size * 0.09]);
                  const ins = size * 0.12;
                  env.rrect(-w / 2 + ins, -slipH / 2 + ins, w - ins * 2, slipH - ins * 2, 0, null, 1, false, sc.accent, Math.max(1.5, size * 0.04));
                  ctx.restore();
                }
              }
              bb = union(bb, J.mainDraw(env, { text: words[i]!, mi: i, font: P.font, size, x: cx, y: cy, rot, track, color: sc.bg }));
            }
          }
          return bb;
        },
      },
    },
    // ------------------------------------------------------------ 9. 円の打ち抜き
    {
      group: 'layout',
      key: 'zzCirclePunch',
      def: {
        name: '円の打ち抜き',
        tags: ['graphic', 'pop'],
        set,
        treat: false,
        fits: (n: number) => n >= 1 && n <= 12,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['display'])), back: rng.chance(0.5) }),
        render(env: LayoutEnv) {
          const { W, H, sc, ctx } = env;
          const P = env.cut.params as { font: string; back: boolean };
          const port = W < H;
          const text = J.splitLines(clean(env.cut.text), port ? 4 : 6) as string;
          const opt = { track: -0.02, lead: 1.02 };
          const size = Math.min(J.fitSize(text, P.font, W * 0.88, H * 0.62, opt), H * 0.45);
          const x = W / 2;
          const y = H / 2;
          const bb = J.mainDraw(env, { text, font: P.font, size, x, y, ...opt, fill: false, stroke: Math.max(2, size * 0.02), strokeColor: sc.fg, color: sc.fg });
          if (!isMain(env)) return bb;
          // 円が、読む向きに合わせて歌詞の上をゆっくり横切る。円の中だけ文字が塗られる
          const u = easeInOut(J.clamp(env.lt / Math.max(0.3, env.cut.dur)));
          const cx = W * (P.back ? J.lerp(0.68, 0.32, u) : J.lerp(0.32, 0.68, u));
          const cy = y + Math.sin(u * Math.PI) * H * 0.03;
          const b = beatOf(env);
          const grow = Math.max(0, easeOutBack(J.clamp((env.lt - env.cut.inDur * 0.4) / 0.4), 1.6)) * (1 - easeIn(J.clamp(env.pOut)));
          const R = Math.min(W, H) * 0.3 * grow * (1 + 0.025 * Math.exp(-b.since * 8));
          if (R <= 1) return bb;
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, R, 0, J.TAU);
          ctx.clip();
          env.circle(cx, cy, R, sc.accent, null, 0, 1, false);
          env.draw({ text, font: P.font, size, x, y, ...opt, color: sc.bg, ghost: false });
          ctx.restore();
          env.circle(cx, cy, R * 1.07, null, sc.fg, Math.max(1.5, size * 0.012), 0.6, false);
          return bb;
        },
      },
    },
    // ------------------------------------------------------------ 10. 二分割
    {
      group: 'layout',
      key: 'zzSplitInvert',
      def: {
        name: '二分割',
        tags: ['graphic', 'editorial'],
        set,
        treat: false,
        fits: (n: number) => n >= 1 && n <= 14,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['display', 'serif'])), o: rng.int(0, 2) }),
        render(env: LayoutEnv) {
          const { W, H, sc, ctx } = env;
          const P = env.cut.params as { font: string; o: number };
          const port = W < H;
          const text = J.splitLines(clean(env.cut.text), port ? 5 : 9) as string;
          const opt = { track: 0, lead: 1.1 };
          const size = Math.min(J.fitSize(text, P.font, W * 0.86, H * 0.42, opt), H * 0.3);
          const x = W / 2;
          const y = H / 2;
          const bb = J.mainDraw(env, { text, font: P.font, size, x, y, ...opt, color: sc.fg });
          if (!isMain(env)) return bb;
          const e = shown(env, J, 0.35, env.cut.inDur * 0.8);
          if (e <= 0) return bb;
          // 左の帯の中だけ色を反転。帯の端 (分かれ目) は小節ごとに 3 つの位置を移る
          const ks = [0.38, 0.5, 0.62];
          const b = beatOf(env);
          const bar = Math.floor(b.index / 4);
          const inBar = (((b.index % 4) + 4) % 4) * b.len + b.since;
          const eb = easeInOut(J.clamp(inBar / 0.3));
          const at = (i: number) => ks[(((i + P.o) % 3) + 3) % 3]!;
          const sx = W * J.lerp(at(bar - 1), at(bar), eb) * e;
          const m = J.measure({ text, font: P.font, size, ...opt });
          const bh = m.h + size * 0.55;
          const y0 = y - bh / 2;
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, y0, sx, bh);
          ctx.clip();
          env.rect(0, y0, sx, bh, sc.fg, 1, false);
          env.draw({ text, font: P.font, size, x, y, ...opt, color: sc.bg, ghost: false });
          ctx.restore();
          const u = H / 1080;
          env.rect(sx - 3 * u, y0 - bh * 0.18, 6 * u, bh * 1.36, sc.accent, e, false);
          return bb;
        },
      },
    },
    // ------------------------------------------------------------ 11. タイムライン
    {
      group: 'layout',
      key: 'zzTimeline',
      def: {
        name: 'タイムライン',
        tags: ['graphic', 'editorial'],
        set,
        treat: 'safe',
        fits: (n: number) => n >= 2 && n <= 24,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['display', 'body'])), fm: rng.pick(fontsOf(st, ['mono', 'body'])), up: rng.chance(0.5) }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; fm: string; up: boolean };
          const port = W < H;
          const u = H / 1080;
          const words = piecesOf(env.cut, port ? 4 : 6);
          const k = words.length;
          const baseY = H * (port ? 0.55 : 0.56);
          const x0 = W * 0.12;
          const x1 = W * 0.88;
          const slot = (x1 - x0) / k;
          const size = Math.min(port ? H * 0.06 : H * 0.11, ...words.map((w) => J.fitSize(w, P.font, slot * 0.92, H * 0.2)));
          const b = beatOf(env);
          // 歌っている語 (カットの進み具合から、およそ)
          const sing = Math.min(k - 1, Math.floor(J.clamp((env.lt - env.cut.inDur) / Math.max(0.3, env.cut.dur - env.cut.inDur - env.cut.outDur)) * k));
          if (isMain(env)) {
            const e = shown(env, J, 0.4);
            // 横の線と、拍ごとに 1 目盛り左へ流れる目盛り (4 目盛りごとに番号)
            env.rect(0, baseY - 1.5 * u, W * e, 3 * u, sc.fg, 0.85, false);
            const sp = W * 0.06;
            const shift = ((b.index + b.since / b.len) * sp) % sp;
            const mid = Math.round(W / 2 / sp);
            for (let j = 0; j <= Math.ceil(W / sp) + 1; j++) {
              const tx = j * sp - shift;
              if (tx < 0 || tx > W * e) continue;
              // 画面の真ん中の目盛りが今の拍
              const n = b.index + j - mid;
              const major = ((n % 4) + 4) % 4 === 0;
              env.rect(tx - 1 * u, baseY - (major ? 14 : 7) * u, 2 * u, (major ? 28 : 14) * u, sc.sub ?? sc.fg, 0.7 * e, false);
              if (major) env.draw({ text: String(Math.max(0, n)), font: P.fm, size: 16 * u, x: tx + 6 * u, y: baseY + 26 * u, align: 'left', color: sc.sub ?? sc.fg, alpha: 0.7 * e, ghost: false });
            }
          }
          let bb: PackBox | null = null;
          words.forEach((w, i) => {
            const cx = x0 + slot * (i + 0.5);
            const above = (i % 2 === 0) === P.up;
            const wy = baseY + (above ? -1 : 1) * size * 1.45;
            if (isMain(env)) {
              // 語から線へ下りる柄と、線の上の点 (歌っている語だけ差し色で大きく)
              const e = shown(env, J, 0.2, i * staggerOf(env));
              const on = i === sing && env.lt > env.cut.inDur;
              const y1 = wy + (above ? 1 : -1) * size * 0.62;
              env.line([[cx, y1], [cx, J.lerp(y1, baseY, e)]], on ? sc.accent : sc.fg, Math.max(1.5, 2.5 * u), 0.9 * e, false);
              env.circle(cx, baseY, (on ? 11 : 6) * u * e, on ? sc.accent : sc.fg, null, 0, e, false);
            }
            bb = union(bb, J.mainDraw(env, { text: w, mi: i, font: P.font, size, x: cx, y: wy, color: sc.fg }));
          });
          return bb;
        },
      },
    },
    // ------------------------------------------------------------ 12. テロップ
    {
      group: 'layout',
      key: 'zzTelop',
      def: {
        name: 'テロップ',
        tags: ['graphic', 'pop', 'editorial'],
        set,
        treat: false,
        fits: (n: number) => n >= 1 && n <= 20,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({
          font: rng.pick(fontsOf(st, ['display'])),
          fb: rng.pick(fontsOf(st, ['body', 'mono'])),
          right: rng.chance(0.35),
          yk: rng.pick([0.3, 0.68, 0.72]),
        }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; fb: string; right: boolean; yk: number };
          const port = W < H;
          const m = Math.min(W, H) * 0.07;
          const text = clean(env.cut.text);
          const size = Math.min(J.fitSize(text, P.font, W * (port ? 0.76 : 0.72), H * 0.18, { track: 0.02 }), H * (port ? 0.075 : 0.15));
          const tw = J.measure({ text, font: P.font, size, track: 0.02 }).w;
          const bw = tw + size * 0.9;
          const bh = size * 1.45;
          const y = H * P.yk;
          const bx = P.right ? W - m - bw : m;
          const line = clean(env.cut.lineText ?? env.cut.text);
          const sub = line !== text ? line : '♪';
          const fs = size * 0.4;
          const sw = J.measure({ text: sub, font: P.fb, size: fs, track: 0.08 }).w + fs * 1.4;
          const sh = fs * 1.8;
          const sy = y + bh / 2 + sh / 2 + size * 0.08;
          const sx = P.right ? W - m - size * 0.35 - sw : m + size * 0.35;
          if (isMain(env)) {
            const out = 1 - easeIn(J.clamp(env.pOut));
            // 帯が横へ伸びて現れる (右寄せのときは右から)
            const e = easeOut(J.clamp(env.lt / 0.28)) * out;
            const w = bw * e;
            env.rect(P.right ? bx + bw - w : bx, y - bh / 2, w, bh, sc.accent, 1, false);
            const tab = size * 0.16;
            env.rect(P.right ? bx + bw : bx - tab, y - bh / 2, tab * e, bh, sc.fg, 1, false);
            const e2 = easeOut(J.clamp((env.lt - 0.12) / 0.28)) * out;
            if (e2 > 0) {
              const w2 = sw * e2;
              env.rect(P.right ? sx + sw - w2 : sx, sy - sh / 2, w2, sh, sc.fg, 1, false);
              env.draw({ text: sub, font: P.fb, size: fs, x: sx + sw / 2, y: sy, track: 0.08, color: sc.bg, alpha: e2, ghost: false });
            }
          }
          return J.mainDraw(env, { text, font: P.font, size, x: bx + bw / 2, y, track: 0.02, color: sc.bg });
        },
      },
    },
  ];
}
