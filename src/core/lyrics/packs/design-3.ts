import { clean, DESIGN_SET, fontsOf, isMain, type LayoutEnv, pad, piecesOf, type Rng, shown, staggerOf, timecode, union } from './design-kit';
import type { PackBox, PackEffect, PackJ } from './types';
import { beatOf, easeOut } from './util';

/**
 * 図案 (ZUNZUN) のオリジナルのレイアウト、3 つめの組 (原稿用紙・新聞の見出し・スコア表示・楽譜・ネオン看板・地図のピン)。
 * 書き方は design.ts の先頭のコメントと同じ。JIZURA にも同じ題材のレイアウト (原稿用紙・新聞・ネオン など) はあるが、
 * 図案では JIZURA のレイアウトを使わないので、組み方を変えて ZUNZUN で作る。
 * 飾りに使う書体も plan で決めてカットに保存する (JIZURA はカットに保存された書体だけを読み込むため)。
 */

/** 縦書きで 90° 回す文字 (長音・波線・括弧・英数字) */
const rotV = (ch: string): boolean => /[ー〜～…‥―—\-()（）「」『』【】〈〉《》[\]［］→←:：;；=＝A-Za-z0-9]/.test(ch);

/** 歌っている語 (カットの進み具合から、およそ) */
function singing(env: LayoutEnv, J: PackJ, k: number): number {
  const hold = Math.max(0.3, env.cut.dur - env.cut.inDur - env.cut.outDur);
  return Math.min(k - 1, Math.floor(J.clamp((env.lt - env.cut.inDur) / hold) * k));
}

export function designEffects3(J: PackJ): PackEffect[] {
  const set = DESIGN_SET;
  /** 点の書体 (無ければ等幅) */
  const dotFont = (st: LayoutEnv['st']): string => (J.FONTS?.dot ? 'dot' : fontsOf(st, ['mono'])[0]!);
  return [
    // ------------------------------------------------------------ 13. 原稿用紙
    {
      group: 'layout',
      key: 'zzManuscript',
      def: {
        name: '原稿用紙',
        tags: ['editorial', 'graphic'],
        set,
        treat: 'safe',
        fits: (n: number) => n >= 2 && n <= 30,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['serif', 'body'])), pen: rng.chance(0.7) }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; pen: boolean };
          const port = W < H;
          const chars = [...clean(env.cut.text)].filter((c) => c.trim());
          const n = chars.length;
          if (!n) return null;
          // 縦書き: 右の列から、1 列 R マス
          const R = Math.min(port ? 12 : 9, Math.max(5, n));
          const cols = Math.ceil(n / R);
          const c = Math.min((H * 0.8) / R, (W * 0.8) / (cols + 2), n <= 6 ? H * 0.15 : H * 0.11);
          const gc = Math.min(cols + 2, Math.max(cols, Math.floor((W * 0.9) / c)));
          const first = gc > cols ? 1 : 0;
          const xr = W / 2 + (gc * c) / 2;
          const y0 = H / 2 - (R * c) / 2;
          const u = H / 1080;
          const b = beatOf(env);
          const cur = ((b.index % n) + n) % n;
          if (isMain(env)) {
            const e = shown(env, J, 0.45);
            const grid = sc.sub ?? sc.fg;
            const lw = Math.max(1, 1.6 * u);
            for (let k = 0; k <= gc; k++) {
              const x = xr - k * c;
              env.line([[x, y0], [x, y0 + R * c * e]], grid, k === 0 || k === gc ? lw * 2 : lw, 0.6 * e, false);
            }
            for (let r = 0; r <= R; r++) {
              const y = y0 + r * c;
              env.line([[xr, y], [xr - gc * c * e, y]], grid, r === 0 || r === R ? lw * 2 : lw, 0.6 * e, false);
            }
          }
          let bb: PackBox | null = null;
          chars.forEach((ch, i) => {
            const col = first + Math.floor(i / R);
            const row = i % R;
            let x = xr - (col + 0.5) * c;
            let y = y0 + (row + 0.5) * c;
            // 縦書きの約物: 小さい仮名は右上へ、句読点はマスの右上の隅へ
            if (J.isSmallKana?.(ch)) {
              x += c * 0.1;
              y -= c * 0.1;
            }
            if ('、。，．'.includes(ch)) {
              x += c * 0.28;
              y -= c * 0.28;
            }
            bb = union(bb, J.mainDraw(env, { text: ch, mi: i, font: P.font, size: c * 0.7, x, y, rot: rotV(ch) ? 90 : 0, color: sc.fg }));
            // 今の拍の文字に、赤ペンの丸
            if (P.pen && i === cur && isMain(env) && env.lt > env.cut.inDur) {
              const a = shown(env, J, 0.2, env.cut.inDur);
              env.circle(x, y, c * 0.46, null, sc.accent, Math.max(2, c * 0.05), 0.9 * a, false);
            }
          });
          return bb;
        },
      },
    },
    // ------------------------------------------------------------ 14. 新聞の見出し
    {
      group: 'layout',
      key: 'zzNewspaper',
      def: {
        name: '新聞の見出し',
        tags: ['editorial', 'graphic'],
        set,
        treat: false,
        fits: (n: number) => n >= 2 && n <= 18,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({
          font: rng.pick(fontsOf(st, ['display', 'serif'])),
          fb: rng.pick(fontsOf(st, ['serif', 'body'])),
          box: rng.chance(0.5),
        }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; fb: string; box: boolean };
          const u = H / 1080;
          const fx0 = W * 0.08;
          const fx1 = W * 0.92;
          const fy0 = H * 0.13;
          const fy1 = H * 0.87;
          const mast = 44 * u;
          const top = fy0 + mast;
          const text = J.splitLines(clean(env.cut.text), 7) as string;
          const opt = { vertical: true, track: 0.02, lead: 1.15 };
          const hw = Math.min(W * 0.26, W * 0.13 * text.split('\n').length);
          const size = Math.min(J.fitSize(text, P.font, hw, (fy1 - top) * 0.9, opt), H * 0.2);
          const m = J.measure({ text, font: P.font, size, ...opt });
          const hx = fx1 - m.w / 2 - size * 0.45;
          const hy = (top + fy1) / 2;
          if (isMain(env)) {
            const e = shown(env, J, 0.4);
            const fs = Math.max(12, 20 * u);
            // 題字の帯: 太い罫と細い罫の間に、号数と時刻
            env.rect(fx0, fy0, (fx1 - fx0) * e, 8 * u, sc.fg, 1, false);
            env.rect(fx0, top - 3 * u, (fx1 - fx0) * e, 2 * u, sc.fg, 0.9, false);
            env.draw({ text: `第${pad(env.cut.line + 1, 3)}号`, font: P.fb, size: fs, x: fx0, y: (fy0 + top) / 2 + 3 * u, align: 'left', track: 0.1, color: sc.fg, alpha: e, ghost: false });
            env.draw({ text: timecode(env.cut.start), font: P.fb, size: fs, x: fx1, y: (fy0 + top) / 2 + 3 * u, align: 'right', track: 0.1, color: sc.fg, alpha: e, ghost: false });
            env.rect(fx0, fy1, (fx1 - fx0) * e, 2 * u, sc.fg, 0.9, false);
            // 見出しの白抜きの箱
            if (P.box) {
              const q = shown(env, J, 0.25, 0.1);
              env.rect(hx - m.w / 2 - size * 0.25, hy - (m.h / 2 + size * 0.3) * q, m.w + size * 0.5, (m.h + size * 0.6) * q, sc.accent, 1, false);
            }
            // 本文: 行全体を縦書きの小さな文字で、2 段に組む (右の列から順に現れる)
            const body = clean(env.cut.lineText ?? env.cut.text).replace(/\s/g, '') + '。';
            const bs = Math.max(11, 17 * u);
            const colW = bs * 1.7;
            const bx1 = hx - m.w / 2 - size * 0.6;
            const stages = 2;
            const sh = (fy1 - top - 16 * u) / stages;
            const per = Math.max(1, Math.floor((sh - 10 * u) / (bs * 1.05)));
            const ncol = Math.max(0, Math.floor((bx1 - fx0) / colW));
            let k = 0;
            for (let s = 0; s < stages; s++) {
              const sy = top + 8 * u + s * sh;
              if (s > 0) env.rect(fx0, sy - 4 * u, (bx1 - fx0) * e, 1.5 * u, sc.sub ?? sc.fg, 0.6, false);
              for (let j = 0; j < ncol; j++, k++) {
                const a = shown(env, J, 0.2, 0.1 + j * 0.03) * 0.55;
                if (a <= 0) continue;
                const t0 = (k * per) % body.length;
                const colText = (body.repeat(Math.ceil((t0 + per) / body.length) + 1)).slice(t0, t0 + per);
                env.draw({ text: colText, font: P.fb, size: bs, x: bx1 - (j + 0.5) * colW, y: sy, vertical: true, align: 'left', track: 0.05, color: sc.sub ?? sc.fg, alpha: a, ghost: false });
              }
            }
          }
          return J.mainDraw(env, { text, font: P.font, size, x: hx, y: hy, ...opt, color: P.box ? sc.bg : sc.fg });
        },
      },
    },
    // ------------------------------------------------------------ 15. スコア表示
    {
      group: 'layout',
      key: 'zzScoreboard',
      def: {
        name: 'スコア表示',
        tags: ['graphic', 'pop'],
        set,
        treat: false,
        fits: (n: number) => n >= 1 && n <= 14,
        plan: (_rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ fd: dotFont(st) }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { fd: string };
          const port = W < H;
          const u = H / 1080;
          const text = J.splitLines(clean(env.cut.text), port ? 5 : 8) as string;
          const bw = W * (port ? 0.88 : 0.74);
          const bh = H * (port ? 0.4 : 0.58);
          const x0 = W / 2 - bw / 2;
          const y0 = H / 2 - bh / 2;
          const opt = { track: 0.12, lead: 1.2 };
          const size = Math.min(J.fitSize(text, P.fd, bw * 0.84, bh * 0.44, opt), bh * 0.3);
          const ly = y0 + bh * 0.5;
          const led = sc.accent2 ?? sc.accent;
          if (isMain(env)) {
            const e = shown(env, J, 0.3);
            // 盤: 暗い板と太い枠 (盤が主役なので、ここだけは板を敷く)
            env.rrect(x0, y0, bw, bh * e, 18 * u, sc.bg, 0.88, false, sc.fg, 5 * u);
            if (e > 0.6) {
              const a = (e - 0.6) / 0.4;
              const fs = Math.max(14, (port ? 22 : 30) * u);
              const b = beatOf(env);
              const lab = (s: string, x: number, y: number, al: string, color: string) => env.draw({ text: s, font: P.fd, size: fs, x, y, align: al, track: 0.15, color, alpha: a, ghost: false });
              lab('LINE', x0 + bw * 0.05, y0 + bh * 0.13, 'left', sc.sub ?? sc.fg);
              lab(pad(env.cut.line + 1, 2), x0 + bw * 0.05, y0 + bh * 0.22, 'left', led);
              lab('TIME', x0 + bw * 0.95, y0 + bh * 0.13, 'right', sc.sub ?? sc.fg);
              lab(timecode(env.t), x0 + bw * 0.95, y0 + bh * 0.22, 'right', led);
              // 小節の中の拍のランプ 4 つ (今の拍だけ点く。色が変わるだけで、画面は光らせない)
              const on = ((b.index % 4) + 4) % 4;
              for (let k = 0; k < 4; k++) env.circle(W / 2 + (k - 1.5) * fs * 1.6, y0 + bh * 0.17, fs * 0.45, k === on ? sc.accent : sc.dim ?? sc.bg, sc.sub ?? sc.fg, 1.5 * u, a, false);
              lab('BEAT', W / 2 - fs * 0.4, y0 + bh * 0.86, 'right', sc.sub ?? sc.fg);
              lab(pad(b.index + 1, 3), W / 2 + fs * 0.4, y0 + bh * 0.86, 'left', led);
              // 歌詞の文字の升 (点の表示板のように)
              const lay = J.measure({ text, font: P.fd, size, ...opt }).lay;
              for (const g of lay) if (g.ch.trim()) env.rrect(W / 2 + g.x - size * 0.56, ly + g.y - size * 0.6, size * 1.12, size * 1.2, 6 * u, sc.dim ?? sc.bg, a, false);
            }
          }
          return J.mainDraw(env, { text, font: P.fd, size, x: W / 2, y: ly, ...opt, color: led });
        },
      },
    },
    // ------------------------------------------------------------ 16. 楽譜
    {
      group: 'layout',
      key: 'zzStaff',
      def: {
        name: '楽譜',
        tags: ['editorial', 'graphic'],
        set,
        treat: 'safe',
        fits: (n: number) => n >= 2 && n <= 24,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['body', 'serif'])), yk: rng.pick([0.42, 0.46]) }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; yk: number };
          const port = W < H;
          const u = H / 1080;
          const words = piecesOf(env.cut, port ? 4 : 6);
          const k = words.length;
          const s = port ? H * 0.022 : H * 0.034;
          const mid = H * P.yk;
          const sx0 = W * 0.06;
          const sx1 = W * 0.94;
          const nx0 = W * 0.16;
          const slot = (W * 0.9 - nx0) / k;
          const size = Math.min(port ? H * 0.055 : H * 0.1, ...words.map((w) => J.fitSize(w, P.font, slot * 0.9, H * 0.2)));
          const seed = env.cut.seed ?? 1;
          // 音の高さ: 5 線の上下 4 段ずつ (seed から決まる。隣と同じ高さが続きにくい)
          const pitch = words.map((_w, i) => Math.round(J.rs(seed, i, 701) * 4));
          const noteX = (i: number) => nx0 + slot * (i + 0.5);
          const hold = Math.max(0.3, env.cut.dur - env.cut.inDur - env.cut.outDur);
          const head = J.clamp((env.lt - env.cut.inDur * 0.8) / hold);
          const ph = J.lerp(noteX(0) - slot * 0.4, noteX(k - 1) + slot * 0.4, head);
          if (isMain(env)) {
            const e = shown(env, J, 0.45);
            const lw = Math.max(1.2, 2 * u);
            for (let l = -2; l <= 2; l++) env.line([[sx0, mid + l * s], [J.lerp(sx0, sx1, e), mid + l * s]], sc.fg, lw, 0.8 * e, false);
            // 始まりの縦線、2 語ごとの小節線、終わりの複縦線
            env.rect(sx0, mid - 2 * s, lw * 2, 4 * s * e, sc.fg, 0.9, false);
            for (let i = 2; i < k; i += 2) env.rect(nx0 + slot * i, mid - 2 * s, lw, 4 * s * e, sc.fg, 0.7 * e, false);
            env.rect(sx1 - lw * 5, mid - 2 * s, lw, 4 * s * e, sc.fg, 0.9 * e, false);
            env.rect(sx1 - lw * 3, mid - 2 * s, lw * 3, 4 * s * e, sc.fg, 0.9 * e, false);
            // 音符 (たま + ぼう)。演奏の位置の縦線が通り過ぎた音符は差し色
            words.forEach((_w, i) => {
              const a = shown(env, J, 0.2, 0.15 + i * staggerOf(env));
              if (a <= 0) return;
              const x = noteX(i);
              const y = mid - (pitch[i]! * s) / 2;
              const on = env.lt > env.cut.inDur && ph >= x;
              const col = on ? sc.accent : sc.fg;
              env.circle(x, y, s * 0.55 * easeOut(a), col, null, 0, 1, false);
              const up = pitch[i]! < 0;
              env.line([[x + (up ? s * 0.5 : -s * 0.5), y], [x + (up ? s * 0.5 : -s * 0.5), y + (up ? -3.3 : 3.3) * s * a]], col, lw * 1.4, a, false);
            });
            if (env.lt > env.cut.inDur * 0.8) env.line([[ph, mid - 3 * s], [ph, mid + 3 * s]], sc.accent, lw * 2, 0.8 * e, false);
          }
          // 歌詞は、楽譜と同じく 5 線の下に音符の位置で
          let bb: PackBox | null = null;
          words.forEach((w, i) => {
            bb = union(bb, J.mainDraw(env, { text: w, mi: i, font: P.font, size, x: noteX(i), y: mid + 2 * s + size * 1.35, color: sc.fg }));
          });
          return bb;
        },
      },
    },
    // ------------------------------------------------------------ 17. ネオン看板
    {
      group: 'layout',
      key: 'zzNeonSign',
      def: {
        name: 'ネオン看板',
        tags: ['pop', 'graphic'],
        set,
        treat: false,
        fits: (n: number) => n >= 1 && n <= 14,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['display', 'body'])), hang: rng.chance(0.6) }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; hang: boolean };
          const port = W < H;
          const u = H / 1080;
          const text = J.splitLines(clean(env.cut.text), port ? 4 : 7) as string;
          const opt = { track: 0.06, lead: 1.2 };
          // 枠 (文字の幅 + 大きさ 1.1 倍) が画面からはみ出さないよう、文字は幅の 64% まで
          const size = Math.min(J.fitSize(text, P.font, W * 0.64, H * 0.42, opt), H * 0.26);
          const m = J.measure({ text, font: P.font, size, ...opt });
          const x = W / 2;
          const y = H / 2;
          const tube = sc.accent;
          if (isMain(env)) {
            const e = shown(env, J, 0.35);
            const fw = m.w + size * 1.1;
            const fh = m.h + size * 0.9;
            // 看板の枠 (二重の管) と、吊るす線
            env.rrect(x - fw / 2, y - fh / 2, fw, fh, size * 0.3, null, e, false, tube, 7 * u);
            env.rrect(x - fw / 2 + 12 * u, y - fh / 2 + 12 * u, fw - 24 * u, fh - 24 * u, size * 0.24, null, e * 0.8, false, sc.fg, 2 * u);
            if (P.hang) {
              for (const k of [-0.3, 0.3]) env.line([[x + fw * k, y - fh / 2], [x + fw * k * 0.8, 0]], sc.sub ?? sc.fg, 2 * u, 0.6 * e, false);
            }
            // 文字の管 (太い線)。1 文字ずつ順に点く (ゆっくり明るくなるだけで、点滅はしない)
            const lt = env.lt;
            env.draw({ text, font: P.font, size, x, y, ...opt, fill: false, stroke: Math.max(4, size * 0.09), strokeColor: tube, color: tube, alpha: 0.4 * e, ghost: false,
              charFn: (i: number) => ({ a: J.clamp((lt - 0.1 - i * 0.06) / 0.25) }) });
          }
          // 管の芯 (細い線)
          return J.mainDraw(env, { text, font: P.font, size, x, y, ...opt, fill: false, stroke: Math.max(2, size * 0.028), strokeColor: sc.fg, color: sc.fg });
        },
      },
    },
    // ------------------------------------------------------------ 18. 地図のピン
    {
      group: 'layout',
      key: 'zzMapPins',
      def: {
        name: '地図のピン',
        tags: ['graphic', 'pop', 'editorial'],
        set,
        treat: 'safe',
        fits: (n: number) => n >= 2 && n <= 24,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['display', 'body'])) }),
        render(env: LayoutEnv) {
          const { W, H, sc, ctx } = env;
          const P = env.cut.params as { font: string };
          const port = W < H;
          const u = H / 1080;
          const words = piecesOf(env.cut, port ? 4 : 6);
          const k = words.length;
          const cols = port ? 2 : Math.min(3, k);
          const rows = Math.ceil(k / cols);
          const cw = (W * 0.8) / cols;
          const ch = (H * (port ? 0.6 : 0.66)) / rows;
          const seed = env.cut.seed ?? 1;
          const size = Math.min(port ? H * 0.055 : H * 0.11, ...words.map((w) => J.fitSize(w, P.font, cw * 0.62, H * 0.2)));
          // ピンの大きさは文字に合わせる
          const pu = Math.max(u, size / 60);
          // ピンの場所: 升目を蛇行する順 (1 段目は左から、2 段目は右から) に、少しずらして置く
          const pts = words.map((_w, i): [number, number] => {
            const r = Math.floor(i / cols);
            const c0 = i % cols;
            const c = r % 2 ? cols - 1 - c0 : c0;
            return [W * 0.1 + cw * (c + 0.5) + J.rs(seed, i, 711) * cw * 0.14 - cw * 0.12, H / 2 - (rows * ch) / 2 + ch * (r + 0.58) + J.rs(seed, i, 712) * ch * 0.12];
          });
          const sing = singing(env, J, k);
          if (isMain(env)) {
            const e = shown(env, J, 0.4);
            // 地図の方眼 (うすく)
            const g = W / 12;
            for (let x = g; x < W; x += g) env.line([[x, 0], [x, H * e]], sc.fg, 1, 0.08 * e, false);
            for (let y = g; y < H; y += g) env.line([[0, y], [W * e, y]], sc.fg, 1, 0.08 * e, false);
            // 道のり (点線) が、ピンの順に伸びる
            const route = J.clamp((env.lt - env.cut.inDur * 0.3) / Math.max(0.3, env.cut.dur * 0.7));
            ctx.save();
            ctx.setLineDash([10 * u, 8 * u]);
            env.polyPartial(pts, route, sc.accent, 3 * u, 0.85 * e, false);
            ctx.restore();
            pts.forEach(([x, y], i) => {
              const a = shown(env, J, 0.2, i * staggerOf(env));
              if (a <= 0) return;
              const on = i === sing && env.lt > env.cut.inDur;
              const col = on ? sc.accent : sc.fg;
              const r = (on ? 13 : 10) * pu;
              const hy = y - 26 * pu * easeOut(a);
              // ピン (丸と、地面を指す三角) と、ラベルへの引き出し線
              env.poly([[x - r * 0.62, hy + r * 0.5], [x + r * 0.62, hy + r * 0.5], [x, y]], col, a, false);
              env.circle(x, hy, r, col, null, 0, a, false);
              env.circle(x, hy, r * 0.38, sc.bg, null, 0, a, false);
              env.line([[x + r, hy - r * 0.4], [x + r + 22 * pu, hy - size * 0.55]], col, 2 * pu, 0.8 * a, false);
            });
          }
          let bb: PackBox | null = null;
          words.forEach((w, i) => {
            const [x, y] = pts[i]!;
            bb = union(bb, J.mainDraw(env, { text: w, mi: i, font: P.font, size, x: x + 36 * pu, y: y - 26 * pu - size * 0.62, align: 'left', color: sc.fg }));
          });
          return bb;
        },
      },
    },
  ];
}
