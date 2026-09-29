import type { MotionPack, PackBox, PackEffect, PackEnv, PackJ } from './types';
import { allowOnlyTagged, beatOf, disable, easeIn, easeOut } from './util';

/**
 * 図案 (ZUNZUN)。**画面の組み方 (レイアウト) そのものをオリジナルで作る**パック。
 * JIZURA のレイアウトは 1 つも使わず、ここのレイアウトだけで組む (ユーザー要望: 「JIZURA のレイアウトを使わなくてもいいくらい一杯」)。
 * 登場・退場・表示中の動きは JIZURA の graphic / pop / editorial の印があるもの (光る・反転するものは使わない)。
 *
 * レイアウトの書き方 (JIZURA の layout):
 * - plan(rng, cut, st) → カットに保存する設定 (乱数は rng だけ = seed から決まる)
 * - render(env) → 描いて、歌詞の枠を返す。歌詞は J.mainDraw (登場・表示中・退場の演出がかかる)、
 *   飾りの文字は env.draw、図形は env.rect / env.line / env.poly (最後の引数 false = 色ずれの残像を付けない)
 * - render はカットの間、毎フレーム・色ずれの残像の分も呼ばれる。env.pass !== 'main' のときは歌詞以外を描かない
 */

export const DESIGN_STYLE_KEY = 'zz-design';
export const DESIGN_SET = 'zzDesign';
const PACK = 'zunzun-design';

interface Rng {
  pick<T>(a: T[]): T;
  range(a: number, b: number): number;
  chance(p: number): boolean;
  int(a: number, b: number): number;
}

interface DrawItem extends Record<string, unknown> {
  text: string;
  font: string;
  size: number;
  x: number;
  y: number;
}

export interface LayoutEnv extends PackEnv {
  ctx: CanvasRenderingContext2D;
  ltb?: number;
  cut: PackEnv['cut'] & { params: Record<string, unknown>; text: string; lineText?: string; line: number; start: number };
  st: { fonts: Record<string, string[] | undefined> };
  draw(item: DrawItem): PackBox | null;
  rect(x: number, y: number, w: number, h: number, c: string, a?: number, ghost?: boolean): void;
  rrect(x: number, y: number, w: number, h: number, r: number, fill: string | null, a?: number, ghost?: boolean, stroke?: string, lw?: number): void;
  poly(pts: [number, number][], c: string, a?: number, ghost?: boolean): void;
}

const fontsOf = (st: LayoutEnv['st'], roles: string[]): string[] =>
  roles.flatMap((r) => st.fonts[r] ?? []).filter(Boolean).concat(['gothic_bold']).slice(0, 4);

/** カットの文字 (空白をまとめ、前後の空白を除く) */
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** 空白を除いた文字の数 */
const glyphs = (s: string): number => [...s.replace(/\s/g, '')].length;

/** 飾りの出方: 登場の始めに tin 秒で現れ、退場で消える (0..1) */
function shown(env: LayoutEnv, J: PackJ, tin = 0.3, delay = 0): number {
  return easeOut(J.clamp((env.lt - delay) / tin)) * (1 - easeIn(J.clamp(env.pOut)));
}

const union = (a: PackBox | null, b: PackBox | null): PackBox | null =>
  !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };

const pad = (n: number, k: number): string => String(Math.max(0, Math.floor(n))).padStart(k, '0');
/** 秒 → 00:12.40 */
const timecode = (t: number): string => `${pad(t / 60, 2)}:${pad(t % 60, 2)}.${pad((t % 1) * 100, 2)}`;

export function designEffects(J: PackJ): PackEffect[] {
  const set = DESIGN_SET;
  const main = (env: LayoutEnv): boolean => env.pass === 'main';
  return [
    // ------------------------------------------------------------ 1. のぞき窓
    {
      group: 'layout',
      key: 'zzPeekWindow',
      def: {
        name: 'のぞき窓',
        tags: ['graphic', 'pop'],
        set,
        treat: false,
        fits: (n: number) => n >= 1 && n <= 14,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['display'])), start: rng.int(0, 7), wide: rng.chance(0.4) }),
        render(env: LayoutEnv) {
          const { W, H, sc, ctx } = env;
          const P = env.cut.params as { font: string; start: number; wide: boolean };
          const port = W < H;
          const text = J.splitLines(clean(env.cut.text), port ? 4 : 7) as string;
          const opt = { track: -0.02, lead: 1.02 };
          // 窓が画面の外にはみ出さないよう、端に少し余白を残す
          const size = Math.min(J.fitSize(text, P.font, W * (port ? 0.8 : 0.88), H * 0.66, opt), H * 0.5);
          const x = W / 2;
          const y = H / 2;
          // 画面いっぱいの歌詞を白抜き (輪郭だけ) で
          const bb = J.mainDraw(env, { text, font: P.font, size, x, y, ...opt, fill: false, stroke: Math.max(2, size * 0.02), strokeColor: sc.fg, color: sc.fg });
          const a = shown(env, J, 0.25, env.cut.inDur * 0.6);
          if (!main(env) || a <= 0) return bb;
          // 窓: 拍ごとに次の文字へ跳ぶ。窓の中だけ塗りつぶした文字 (色を反転) が見える
          const lay = J.measure({ text, font: P.font, size, ...opt }).lay.filter((g) => g.ch.trim());
          if (!lay.length) return bb;
          const b = beatOf(env);
          const at = (k: number) => lay[(((k + P.start) % lay.length) + lay.length) % lay.length]!;
          const g0 = at(b.index - 1);
          const g1 = at(b.index);
          const e = easeOut(J.clamp(b.since / 0.14));
          const span = P.wide ? 2.2 : 1.25;
          const w = size * span;
          const h = size * 1.2;
          const wx = x + J.lerp(g0.x, g1.x, e) - w / 2;
          const wy = y + J.lerp(g0.y, g1.y, e) - h / 2;
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.rect(wx, wy, w, h);
          ctx.clip();
          env.rect(wx, wy, w, h, sc.fg, a, false);
          env.draw({ text, font: P.font, size, x, y, ...opt, color: sc.bg, alpha: a, ghost: false });
          ctx.restore();
          const lw = Math.max(2, size * 0.025);
          env.rrect(wx, wy, w, h, 0, null, a, false, sc.accent, lw);
          // 窓の角の小さな印
          const t = size * 0.12;
          env.rect(wx - t / 2, wy - t / 2, t, t, sc.accent, a, false);
          env.rect(wx + w - t / 2, wy + h - t / 2, t, t, sc.accent, a, false);
          return bb;
        },
      },
    },
    // ------------------------------------------------------------ 2. 升目で埋まる
    {
      group: 'layout',
      key: 'zzGridFill',
      def: {
        name: '升目で埋まる',
        tags: ['graphic', 'pop', 'editorial'],
        set,
        treat: 'safe',
        fits: (n: number) => n >= 2 && n <= 12,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['display', 'body'])), start: rng.int(0, 11), dots: rng.chance(0.5) }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; start: number; dots: boolean };
          const chars = [...clean(env.cut.text)].filter((c) => c.trim());
          const n = chars.length;
          if (!n) return null;
          const port = W < H;
          const cols = port ? Math.min(3, n) : Math.min(6, n <= 4 ? n : Math.ceil(n / 2));
          const rows = Math.ceil(n / cols);
          const cell = Math.min((W * (port ? 0.86 : 0.8)) / cols, (H * (port ? 0.6 : 0.72)) / rows);
          const x0 = W / 2 - (cols * cell) / 2;
          const y0 = H / 2 - (rows * cell) / 2;
          const u = H / 1080;
          const b = beatOf(env);
          const cur = (((b.index + P.start) % n) + n) % n;
          if (main(env)) {
            // 升目の線が伸びて現れる
            const e = shown(env, J, 0.35);
            const lw = Math.max(1.5, 2.5 * u);
            for (let c = 0; c <= cols; c++) {
              const x = x0 + c * cell;
              env.line([[x, y0], [x, y0 + rows * cell * e]], sc.fg, lw, 0.55 * e, false);
            }
            for (let r = 0; r <= rows; r++) {
              const y = y0 + r * cell;
              env.line([[x0, y], [x0 + cols * cell * e, y]], sc.fg, lw, 0.55 * e, false);
            }
            // 今の拍の升目だけ塗る (升目が移っていくだけで、画面は光らせない)
            const a = shown(env, J, 0.2, env.cut.inDur * 0.7);
            const cx = x0 + (cur % cols) * cell;
            const cy = y0 + Math.floor(cur / cols) * cell;
            const ins = cell * 0.06;
            env.rect(cx + ins, cy + ins, cell - ins * 2, cell - ins * 2, sc.accent, 0.95 * a, false);
            if (P.dots) for (let k = 0; k < n; k++) env.circle(x0 + (k % cols) * cell + cell * 0.12, y0 + Math.floor(k / cols) * cell + cell * 0.12, 3.5 * u, k === cur ? sc.bg : sc.sub ?? sc.fg, null, 0, e * 0.8, false);
          }
          let bb: PackBox | null = null;
          const size = cell * 0.62;
          chars.forEach((ch, i) => {
            const on = i === cur && env.lt > env.cut.inDur * 0.7;
            bb = union(bb, J.mainDraw(env, { text: ch, mi: i, font: P.font, size, x: x0 + (i % cols) * cell + cell / 2, y: y0 + Math.floor(i / cols) * cell + cell / 2, color: on ? sc.bg : sc.fg }));
          });
          return bb;
        },
      },
    },
    // ------------------------------------------------------------ 3. 反復スタック
    {
      group: 'layout',
      key: 'zzRepeatStack',
      def: {
        name: '反復スタック',
        tags: ['graphic', 'pop'],
        set,
        treat: false,
        fits: (n: number) => n >= 1 && n <= 12,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['display'])), shift: rng.chance(0.5) }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; shift: boolean };
          const text = clean(env.cut.text);
          const port = W < H;
          const rows = port ? 7 : 5;
          const size = Math.min(J.fitSize(text, P.font, W * 0.88, (H / rows) * 0.92, { track: -0.01 }), (H / rows) * 0.84);
          const rowH = size * 1.06;
          const c = Math.floor(rows / 2);
          const b = beatOf(env);
          // 塗る段が拍ごとに上下へ往復する
          const loop = 2 * (rows - 1);
          const pos = ((b.index % loop) + loop) % loop;
          const act = pos < rows ? pos : loop - pos;
          if (main(env)) {
            for (let r = 0; r < rows; r++) {
              if (r === c) continue;
              const d = Math.abs(r - c);
              const e = shown(env, J, 0.25, env.cut.inDur * 0.5 + d * 0.06);
              if (e <= 0) continue;
              const y = H / 2 + (r - c) * rowH;
              const dx = P.shift ? (r - c) * size * 0.35 * (1 - e * 0.5) : 0;
              const item: DrawItem = { text, font: P.font, size, x: W / 2 + dx, y, track: -0.01, ghost: false, alpha: e, color: sc.fg };
              if (r === act) env.draw({ ...item, color: sc.accent });
              else env.draw({ ...item, fill: false, stroke: Math.max(1.5, size * 0.022), strokeColor: sc.fg, alpha: 0.5 * e });
            }
          }
          return J.mainDraw(env, { text, font: P.font, size, x: W / 2, y: H / 2, track: -0.01, color: act === c ? sc.accent : sc.fg });
        },
      },
    },
    // ------------------------------------------------------------ 4. ポスター組
    {
      group: 'layout',
      key: 'zzPoster',
      def: {
        name: 'ポスター組',
        tags: ['graphic', 'editorial'],
        set,
        treat: 'safe',
        // どんな長さでも組める (ほかのどれにも収まらない長い塊でも、JIZURA のレイアウトに頼らずに済むように)
        fits: (n: number) => n >= 1,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({
          font: rng.pick(fontsOf(st, ['display'])),
          fm: rng.pick(fontsOf(st, ['mono', 'body'])),
          right: rng.chance(0.4),
          side: rng.chance(0.65),
          bar: rng.pick(['top', 'both', 'block']),
        }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; fm: string; right: boolean; side: boolean; bar: string };
          const port = W < H;
          const m = Math.min(W, H) * 0.08;
          const u = H / 1080;
          const text = J.splitLines(clean(env.cut.text), glyphs(env.cut.text) > 18 ? (port ? 6 : 10) : port ? 4 : 6) as string;
          const opt = { track: -0.03, lead: 1.04 };
          const size = Math.min(J.fitSize(text, P.font, W * (port ? 0.8 : 0.62), H * 0.5, opt), H * 0.3);
          const align = P.right ? 'right' : 'left';
          const xa = P.right ? W - m : m;
          const bb = J.mainDraw(env, { text, font: P.font, size, x: xa, y: H * 0.54, align, ...opt, color: sc.fg });
          if (!main(env)) return bb;
          const e = shown(env, J, 0.45);
          if (e <= 0) return bb;
          const fs = Math.max(14, 22 * u);
          const small = (s: string, x: number, y: number, al: string, color = sc.fg, a = e) =>
            env.draw({ text: s, font: P.fm, size: fs, x, y, align: al, track: 0.12, color, alpha: a, ghost: false });
          // 上の太い罫と、その下の番号・時刻
          const barW = (W - m * 2) * e;
          const bx = P.right ? W - m - barW : m;
          env.rect(bx, m, barW, 12 * u, sc.fg, 1, false);
          small(`No.${pad(env.cut.line + 1, 2)}`, m, m + 12 * u + fs * 1.1, 'left');
          small(timecode(env.cut.start), W - m, m + 12 * u + fs * 1.1, 'right');
          // 下の細い罫と、拍の番号 (拍ごとに数が進む)
          if (P.bar !== 'top') {
            env.rect(m, H - m, (W - m * 2) * e, 3 * u, sc.fg, 0.8, false);
            const b = beatOf(env);
            small(`BEAT ${pad(b.index + 1, 3)}`, P.right ? m : W - m, H - m - fs * 0.9, P.right ? 'left' : 'right', sc.accent);
          }
          // 差し色の四角 (歌詞の角)
          if (bb) {
            const q = easeOut(J.clamp((env.lt - 0.1) / 0.3)) * (1 - easeIn(J.clamp(env.pOut)));
            const sq = size * 0.28 * q;
            const sx = P.right ? bb.x1 - sq : bb.x0;
            env.rect(sx, bb.y0 - sq - size * 0.12, sq, sq, sc.accent, 1, false);
            if (P.bar === 'block') env.rect(P.right ? bb.x0 - size * 0.3 : bb.x1 + size * 0.15, bb.y1 - size * 0.12, size * 0.15 * q, size * 0.12, sc.fg, 1, false);
          }
          // 反対側の端に、行全体を縦書きで小さく
          if (P.side && !port) {
            const line = clean(env.cut.lineText ?? env.cut.text).slice(0, 24);
            env.draw({ text: line, font: P.fm, size: fs, x: P.right ? m + fs : W - m - fs, y: H * 0.54, vertical: true, track: 0.3, color: sc.sub ?? sc.fg, alpha: e * 0.9, ghost: false });
          }
          return bb;
        },
      },
    },
    // ------------------------------------------------------------ 5. 帯が走る
    {
      group: 'layout',
      key: 'zzBandRun',
      def: {
        name: '帯が走る',
        tags: ['graphic', 'pop'],
        set,
        treat: false,
        busy: true,
        fits: (n: number) => n >= 1 && n <= 14,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({
          font: rng.pick(fontsOf(st, ['display'])),
          fb: rng.pick(fontsOf(st, ['body', 'display'])),
          ang: (rng.chance(0.5) ? 1 : -1) * rng.range(7, 13),
          speed: rng.range(0.8, 1.3),
        }),
        render(env: LayoutEnv) {
          const { W, H, sc, ctx } = env;
          const P = env.cut.params as { font: string; fb: string; ang: number; speed: number };
          const M = Math.min(W, H);
          const len = Math.hypot(W, H) * 1.2;
          const hMid = M * 0.2;
          const hSide = M * 0.075;
          const gap = hMid / 2 + hSide * 0.9;
          const out = easeIn(J.clamp(env.pOut));
          const text = clean(env.cut.text);
          if (main(env)) {
            // 両脇の細い帯: 行の文字がくり返し流れる (上下で逆向き)
            const unit = clean(env.cut.lineText ?? env.cut.text) + '　／　';
            const fsz = hSide * 0.52;
            const per = Math.max(1, J.measure({ text: unit, font: P.fb, size: fsz, track: 0.06 }).w);
            const reps = Math.min(40, Math.ceil((len * 1.3) / per) + 2);
            [-1, 1].forEach((side, k) => {
              const e = easeOut(J.clamp((env.lt - 0.08 - k * 0.06) / 0.4)) * (1 - out);
              if (e <= 0) return;
              const dir = side;
              ctx.save();
              ctx.translate(W / 2, H / 2);
              ctx.rotate(P.ang * J.DEG);
              ctx.translate(0, side * gap);
              const L = len * e;
              const bx = dir > 0 ? -len / 2 : len / 2 - L;
              env.rect(bx, -hSide / 2, L, hSide, sc.fg, 1, false);
              ctx.beginPath();
              ctx.rect(bx, -hSide / 2, L, hSide);
              ctx.clip();
              const off = ((((env.ltb ?? env.lt) * P.speed * M * 0.14 * dir) % per) + per) % per;
              env.draw({ text: unit.repeat(reps), font: P.fb, size: fsz, track: 0.06, align: 'left', x: -len * 0.65 - per + off, y: 0, color: sc.bg, ghost: false });
              ctx.restore();
            });
            // 真ん中の太い帯 (差し色)
            const e = easeOut(J.clamp(env.lt / 0.35)) * (1 - out);
            if (e > 0) {
              ctx.save();
              ctx.translate(W / 2, H / 2);
              ctx.rotate(P.ang * J.DEG);
              env.rect((-len / 2) * e, -hMid / 2, len * e, hMid, sc.accent, 1, false);
              ctx.restore();
            }
          }
          // 歌詞は真ん中の帯の上に、帯と同じ傾きで
          const size = Math.min(J.fitSize(text, P.font, W * 0.8, hMid * 0.7, { track: 0.02 }), hMid * 0.66);
          return J.mainDraw(env, { text, font: P.font, size, x: W / 2, y: H / 2, rot: P.ang, track: 0.02, color: sc.bg });
        },
      },
    },
    // ------------------------------------------------------------ 6. 縦と横
    {
      group: 'layout',
      key: 'zzCrossType',
      def: {
        name: '縦と横',
        tags: ['graphic', 'editorial'],
        set,
        treat: 'safe',
        fits: (n: number) => n >= 2 && n <= 16,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({
          font: rng.pick(fontsOf(st, ['display', 'serif'])),
          fm: rng.pick(fontsOf(st, ['mono', 'body'])),
          xk: rng.pick([0.3, 0.5, 0.7]),
          yk: rng.pick([0.38, 0.62]),
        }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; fm: string; xk: number; yk: number };
          const u = H / 1080;
          const text = J.splitLines(clean(env.cut.text), 8) as string;
          const opt = { vertical: true, track: 0.04, lead: 1.2 };
          const cols = text.split('\n').length;
          const size = Math.min(J.fitSize(text, P.font, Math.min(W * 0.3 * cols, W * 0.6), H * 0.8, opt), H * 0.3);
          const x = W * P.xk;
          const yb = H * P.yk;
          if (main(env)) {
            const e = shown(env, J, 0.5);
            if (e > 0) {
              // 横の帯: 細い罫 2 本の間を、行の文字が字間を広く空けてゆっくり流れる
              const fs = Math.max(14, 30 * u);
              const hb = fs * 2.2;
              env.rect(0, yb - hb / 2, W * e, 2 * u, sc.fg, 0.8, false);
              env.rect(W * (1 - e), yb + hb / 2, W * e, 2 * u, sc.fg, 0.8, false);
              const unit = clean(env.cut.lineText ?? env.cut.text) + '　—　';
              const per = Math.max(1, J.measure({ text: unit, font: P.fm, size: fs, track: 0.5 }).w);
              const reps = Math.min(30, Math.ceil((W * 1.5) / per) + 2);
              const off = ((((env.ltb ?? env.lt) * W * 0.03) % per) + per) % per;
              env.draw({ text: unit.repeat(reps), font: P.fm, size: fs, x: -per + off - W * 0.2, y: yb, align: 'left', track: 0.5, color: sc.sub ?? sc.fg, alpha: e, ghost: false });
              // 交わるところに、拍で 90° ずつ回る差し色のひし形
              const b = beatOf(env);
              const rot = (b.index + easeOut(J.clamp(b.since / 0.2))) * (Math.PI / 2) + Math.PI / 4;
              const r = 16 * u * e;
              const pts: [number, number][] = [0, 1, 2, 3].map((k) => [x + W * 0.09 * (P.xk > 0.5 ? -1 : 1) + Math.cos(rot + (k * Math.PI) / 2) * r, yb + Math.sin(rot + (k * Math.PI) / 2) * r]);
              env.poly(pts, sc.accent, 1, false);
            }
          }
          return J.mainDraw(env, { text, font: P.font, size, x, y: H / 2, ...opt, color: sc.fg });
        },
      },
    },
  ];
}

export const designPack: MotionPack = {
  id: PACK,
  set: DESIGN_SET,
  styleKey: DESIGN_STYLE_KEY,
  buildStyle(J) {
    const base = J.STYLES.noir ?? Object.values(J.STYLES)[0]!;
    const st = JSON.parse(JSON.stringify(base)) as Record<string, unknown> & { name: string };
    // 黒・生成り・赤 / 黄 / 青 の、印刷物のような配色 (暗い背景の配色だけ)
    st.schemes = [
      { bg: '#0b0b0d', fg: '#F5F2EA', sub: '#A9A49A', accent: '#FF3B30', accent2: '#FFD400', ink: '#F5F2EA', dim: '#18181b', ghostA: '#FF3B30', ghostB: '#2E6BFF' },
      { bg: '#0a0c12', fg: '#F2F4F8', sub: '#9AA3B2', accent: '#FFD400', accent2: '#2E6BFF', ink: '#F2F4F8', dim: '#161a22', ghostA: '#FFD400', ghostB: '#FF3B30' },
      { bg: '#0b0a0f', fg: '#F7F3F0', sub: '#ABA3A0', accent: '#2E6BFF', accent2: '#FF3B30', ink: '#F7F3F0', dim: '#19171d', ghostA: '#2E6BFF', ghostB: '#FFD400' },
    ];
    st.fonts = { display: ['gothic_black', 'dela', 'zenkaku'], serif: ['mincho_black'], body: ['gothic_bold'], mono: ['mono'] };
    st.texture = { grain: 0.35, paper: 0, scan: 0 };
    st.ghost = 0.5;
    st.glow = 0.4;
    st.hud = false;
    const bias = (st.bias ?? {}) as Record<string, Record<string, number>>;
    st.bias = {
      ...bias,
      layout: { zzPeekWindow: 1, zzGridFill: 1, zzRepeatStack: 1, zzPoster: 1.2, zzBandRun: 1, zzCrossType: 1 },
      fx: {},
    };
    st.decor = {};
    st.name = '図案 (ZUNZUN)';
    st.desc = '画面の組み方をオリジナルで。のぞき窓・升目・反復・ポスター・走る帯・縦と横';
    return st;
  },
  effects: designEffects,
  configure(project, J) {
    // レイアウトはここのものだけ (JIZURA のレイアウトは全部使わない)
    allowOnlyTagged(project, J, PACK, [], ['layout']);
    // 組み方が主役なので、JIZURA の装飾・背景の図形は使わない。動きは graphic / pop / editorial の印があるもの
    allowOnlyTagged(project, J, PACK, [], ['decor', 'bg']);
    allowOnlyTagged(project, J, PACK, ['graphic', 'pop', 'editorial'], ['enter', 'exit', 'hold', 'cam', 'fx', 'trans', 'treat']);
    // 光過敏への配慮: 画面を点滅・反転させる効果は使わない (衝撃と同じ)
    disable(project, 'fx', ['flash', 'invert', 'strobe', 'whiteFrame', 'bandInvert', 'mirrorFlash', 'negativeRing', 'bloomFlash', 'zoomStutter']);
    disable(project, 'trans', ['flashCross']);
    disable(project, 'hold', ['flashBox', 'tyOutlineBlink', 'knWordBlink']);
    disable(project, 'enter', ['hrJumpScare', 'overexpose', 'invertBox']);
    disable(project, 'exit', ['overexposeOut']);
    const fx = (project.fx ?? {}) as Record<string, unknown>;
    project.fx = { ...fx, glitch: 0.2, chroma: 0.4, flash: false, koma: 0, onTwos: false };
  },
};
