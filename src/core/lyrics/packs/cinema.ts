import { paletteToScheme } from '../../render/palette';
import type { MotionPack, PackEffect, PackEnv, PackItem, PackJ, PackPalette } from './types';
import { easeInOut, easeOut, staggered } from './util';

/**
 * 余白 (ZUNZUN)。背景が動画・写真のときに、その雰囲気を壊さない歌詞モーション。小さくするだけにはしない:
 * - **色を背景からもらう**: 背景の画像・動画から読み取った色 (core/render/palette.ts) で文字の配色を作る (描くたびに作り直す)
 * - **板を敷かない**: JIZURA のレイアウトは使わず、オリジナルの 3 つ (映画の字幕・余白の一行・静かな題字) だけ。
 *   文字の後ろに帯や紙を描かず、柔らかい影 (背景の暗い色) だけで読みやすくする
 * - **中央を空ける**: 置く場所は画面の下の 3 分の 1・隅の余白・中央より下 (動画の見せ場の中心を避ける)
 * - **画面全体の効果を使わない**: 背景の図形・画面効果・場面転換・文字の処理・JIZURA の装飾は全部使わない
 * - **動きを映画の字幕に寄せる**: フェード・ピント・わずかな浮き上がりだけ。カメラはごくゆっくり寄るだけ
 */

export const CINEMA_STYLE_KEY = 'zz-cinema';
export const CINEMA_SET = 'zzCinema';
const PACK = 'zunzun-cinema';

/** 背景が無い・まだ色を読み取れていないときの配色 (夜の映画の字幕のような、少し温かい白) */
const DEFAULT_SCHEME = { bg: '#07080a', fg: '#F2EEE8', sub: '#BDB7AE', accent: '#D9C7A6', accent2: '#A9BCD1', ink: '#F2EEE8', dim: '#15171b', ghostA: '#D9C7A6', ghostB: '#A9BCD1' };

const filmIn = (dur: number): number => Math.min(1.2, Math.max(0.35, dur * 0.3));
const filmOut = (dur: number): number => Math.min(1, Math.max(0.3, dur * 0.25));

/** 読みやすさのための柔らかい影 (背景の暗い色)。k = 0..1 */
function softShadow(env: PackEnv, it: PackItem, J: PackJ, k: number): void {
  if (env.pass !== 'main' || k <= 0.01) return;
  it.shadow = { color: J.rgba(env.sc.bg, 0.78 * k), blur: it.size * 0.28, dx: 0, dy: it.size * 0.04 };
}

interface Rng {
  pick<T>(a: T[]): T;
  range(a: number, b: number): number;
  chance(p: number): boolean;
}

interface LayoutEnv extends PackEnv {
  cut: PackEnv['cut'] & { params: Record<string, unknown>; text: string };
  st: { fonts: Record<string, string[] | undefined> };
}

const fontsOf = (st: { fonts: Record<string, string[] | undefined> }, roles: string[]): string[] =>
  roles.flatMap((r) => st.fonts[r] ?? []).filter(Boolean).concat(['gothic_med']).slice(0, 4);

export function cinemaEffects(J: PackJ): PackEffect[] {
  const set = CINEMA_SET;
  return [
    // ------------------------------------------------------------ レイアウト
    {
      group: 'layout',
      key: 'zzSubtitle',
      def: {
        name: '映画の字幕',
        tags: ['calm', 'editorial'],
        set,
        fits: () => true,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['serif', 'body'])), track: rng.range(0.04, 0.1), y: rng.range(0.82, 0.87) }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; track: number; y: number };
          const text = J.splitLines(env.cut.text, W < H ? 9 : 20);
          const size = Math.min(J.fitSize(text, P.font, W * 0.8, H * 0.16, { track: P.track, lead: 1.35 }), H * 0.06);
          return J.mainDraw(env, { text, font: P.font, size, x: W / 2, y: H * P.y, track: P.track, lead: 1.35, color: sc.fg });
        },
      },
    },
    {
      group: 'layout',
      key: 'zzMarginNote',
      def: {
        name: '余白の一行',
        tags: ['calm', 'editorial'],
        set,
        fits: (n: number) => n <= 28,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({
          font: rng.pick(fontsOf(st, ['serif', 'body'])),
          right: rng.chance(0.5),
          top: rng.chance(0.35),
          track: rng.range(0.08, 0.16),
        }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; right: boolean; top: boolean; track: number };
          const text = J.splitLines(env.cut.text, W < H ? 7 : 12);
          const size = Math.min(J.fitSize(text, P.font, W * 0.38, H * 0.2, { track: P.track, lead: 1.4 }), H * 0.05);
          return J.mainDraw(env, {
            text,
            font: P.font,
            size,
            x: P.right ? W * 0.93 : W * 0.07,
            y: P.top ? H * 0.15 : H * 0.85,
            align: P.right ? 'right' : 'left',
            track: P.track,
            lead: 1.4,
            color: sc.fg,
          });
        },
      },
    },
    {
      group: 'layout',
      key: 'zzQuietTitle',
      def: {
        name: '静かな題字',
        tags: ['calm', 'emotional'],
        set,
        fits: (n: number) => n <= 10,
        emph: 2,
        plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['display', 'serif'])), y: rng.range(0.66, 0.72) }),
        render(env: LayoutEnv) {
          const { W, H, sc } = env;
          const P = env.cut.params as { font: string; y: number };
          const text = env.cut.text.replace(/\s+/g, ' ');
          const size = Math.min(J.fitSize(text, P.font, W * 0.6, H * 0.14, { track: 0.22 }), H * 0.085);
          const bb = J.mainDraw(env, { text, font: P.font, size, x: W / 2, y: H * P.y, track: 0.22, color: sc.fg });
          // 題字の下に、細い差し色の線がゆっくり伸びる
          if (bb) {
            const e = easeInOut(J.clamp(env.lt / 1.2)) * (1 - J.clamp(env.pOut));
            const cx = (bb.x0 + bb.x1) / 2;
            const half = ((bb.x1 - bb.x0) / 2) * 0.6 * e;
            if (half > 1) env.line([[cx - half, bb.y1 + size * 0.35], [cx + half, bb.y1 + size * 0.35]], sc.accent, Math.max(1, size * 0.02), 0.8 * e, false);
          }
          return bb;
        },
      },
    },
    // ------------------------------------------------------------ 登場
    {
      group: 'enter',
      key: 'zzFilmFade',
      def: {
        name: 'フェードイン',
        tags: ['calm', 'editorial'],
        set,
        inDur: (dur: number) => filmIn(dur),
        apply(env: PackEnv, it: PackItem, p: number) {
          const q = easeInOut(p);
          it.alpha = (it.alpha ?? 1) * q;
          // 字間が少し詰まりながら現れる (映画のタイトルのように)
          it.track = (it.track ?? 0) + (1 - q) * 0.12;
          softShadow(env, it, J, q);
        },
      },
    },
    {
      group: 'enter',
      key: 'zzFocusPull',
      def: {
        name: 'ピントが合う',
        tags: ['calm', 'emotional'],
        set,
        inDur: (dur: number) => filmIn(dur),
        apply(env: PackEnv, it: PackItem, p: number) {
          const q = easeOut(p);
          it.alpha = (it.alpha ?? 1) * Math.min(1, p * 1.6);
          it.blur = (it.blur ?? 0) + (1 - q) * it.size * 0.3;
          it.size *= 1 + (1 - q) * 0.03;
          softShadow(env, it, J, q);
        },
      },
    },
    {
      group: 'enter',
      key: 'zzWordRise',
      def: {
        name: '文字が浮かぶ',
        tags: ['calm', 'emotional'],
        set,
        inDur: (dur: number) => filmIn(dur),
        apply(env: PackEnv, it: PackItem, p: number) {
          const size = it.size;
          it.charFns.push((i, _g, n) => {
            const q = easeOut(staggered(p, i, n, 0.35));
            if (q <= 0) return { hide: true };
            return { dy: (1 - q) * size * 0.12, a: q };
          });
          softShadow(env, it, J, p);
        },
      },
    },
    // ------------------------------------------------------------ 退場
    {
      group: 'exit',
      key: 'zzFilmFadeOut',
      def: {
        name: 'フェードアウト',
        tags: ['calm', 'editorial'],
        set,
        outDur: (dur: number) => filmOut(dur),
        apply(env: PackEnv, it: PackItem, p: number) {
          const q = easeInOut(p);
          it.alpha = (it.alpha ?? 1) * (1 - q);
          it.track = (it.track ?? 0) + q * 0.06;
          softShadow(env, it, J, 1 - q);
        },
      },
    },
    {
      group: 'exit',
      key: 'zzFocusOut',
      def: {
        name: 'ピントが外れる',
        tags: ['calm', 'emotional'],
        set,
        outDur: (dur: number) => filmOut(dur),
        apply(env: PackEnv, it: PackItem, p: number) {
          const q = easeInOut(p);
          it.alpha = (it.alpha ?? 1) * (1 - q);
          it.blur = (it.blur ?? 0) + q * it.size * 0.3;
          softShadow(env, it, J, 1 - q);
        },
      },
    },
    // ------------------------------------------------------------ 表示中の動き (どちらも読みやすさの影を付ける)
    {
      group: 'hold',
      key: 'zzStill',
      def: {
        name: '静止 (影つき)',
        tags: ['calm'],
        w: 3,
        set,
        apply(env: PackEnv, it: PackItem, amt: number) {
          softShadow(env, it, J, amt);
        },
      },
    },
    {
      group: 'hold',
      key: 'zzSlowDrift',
      def: {
        name: 'わずかに流れる (影つき)',
        tags: ['calm'],
        w: 2,
        set,
        apply(env: PackEnv, it: PackItem, amt: number) {
          const u = J.clamp(env.lt / Math.max(0.3, env.cut.dur));
          const size = it.size;
          it.charFns.push(() => ({ dx: (u - 0.5) * size * 0.25 * amt * (env.fx.motion ?? 0.7) }));
          softShadow(env, it, J, amt);
        },
      },
    },
    // ------------------------------------------------------------ カメラ
    {
      group: 'cam',
      key: 'zzDolly',
      def: {
        name: 'ゆっくり寄る (映画)',
        tags: ['calm'],
        w: 1,
        set,
        get(env: PackEnv) {
          const u = J.clamp(env.lt / Math.max(0.3, env.cut.dur));
          return { s: 1 + 0.015 * (env.fx.motion ?? 0.7) * easeInOut(u) };
        },
      },
    },
  ];
}

/** JIZURA の演出で、余白で使ってよいもの (ほかは使わない)。レイアウト・装飾・背景の図形・画面効果・場面転換・文字の処理は 1 つも使わない */
const ALLOW: Record<string, readonly string[]> = {
  layout: [],
  enter: ['blur', 'fadeStagger', 'blurStagger', 'trackIn'],
  exit: ['blur', 'dissolve', 'blurOutStagger', 'trackOutWide', 'hazeOut'],
  hold: [],
  cam: [],
  decor: [],
  bg: [],
  fx: [],
  trans: [],
  treat: [],
};

export function buildCinemaStyle(J: PackJ, palette: PackPalette | null): Record<string, unknown> & { name: string } {
  const base = J.STYLES.noir ?? Object.values(J.STYLES)[0]!;
  const st = JSON.parse(JSON.stringify(base)) as Record<string, unknown> & { name: string };
  const scheme = palette ? paletteToScheme(palette) : DEFAULT_SCHEME;
  st.schemes = [scheme];
  st.fonts = { display: ['mincho_light', 'gothic_light'], serif: ['mincho_light', 'shippori'], body: ['gothic_light', 'gothic_med'], mono: ['mono'] };
  st.texture = { grain: 0, paper: 0, scan: 0 };
  st.ghost = 0.05;
  st.glow = 0.3;
  st.hud = false;
  st.bias = {
    layout: { zzSubtitle: 5, zzMarginNote: 2.5, zzQuietTitle: 1.5 },
    enter: { zzFilmFade: 6, zzFocusPull: 5, zzWordRise: 5 },
    exit: { zzFilmFadeOut: 6, zzFocusOut: 5 },
    cam: { zzDolly: 10 },
  };
  st.decor = {};
  st.name = '余白 (ZUNZUN)';
  st.desc = '背景が動画・写真のとき向け。背景の色を文字に使い、板を敷かず、中央を空けて、映画の字幕のように静かに出る';
  return st;
}

export const cinemaPack: MotionPack = {
  id: PACK,
  set: CINEMA_SET,
  styleKey: CINEMA_STYLE_KEY,
  buildStyle: (J) => buildCinemaStyle(J, null),
  refreshStyle(J, ctx) {
    J.STYLES[CINEMA_STYLE_KEY] = buildCinemaStyle(J, ctx.palette ?? null);
  },
  effects: cinemaEffects,
  configure(project, J) {
    const enabled = (project.enabled ?? {}) as Record<string, Record<string, boolean>>;
    for (const [g, allow] of Object.entries(ALLOW)) {
      const reg = J.registry(g);
      const map = { ...(enabled[g] ?? {}) };
      for (const k of J.order(g)) {
        if (reg[k]?.pack === PACK) continue;
        if (!allow.includes(k)) map[k] = false;
      }
      enabled[g] = map;
    }
    project.enabled = enabled;
    const fx = (project.fx ?? {}) as Record<string, unknown>;
    // 画面を揺らしたり色をずらしたりしない。装飾の量は 0 (オリジナルの装飾も無い)
    project.fx = { ...fx, glitch: 0, chroma: 0.05, flash: false, koma: 0, onTwos: false, decor: 0, hud: 'off' };
  },
};
