import type { MotionPack, PackBox, PackEffect, PackEnv, PackItem, PackJ } from './types';
import { allowOnlyTagged, beatOf, centerBox, disable, easeIn, easeOut, easeOutBack, flashAllowed, staggered } from './util';

/**
 * 衝撃 (ZUNZUN)。EDM・速い曲向け: 拍で叩きつけ、拍で脈打つ。
 * - JIZURA の演出は pop / glitch / graphic の印があるものだけ。画面を点滅・反転させる JIZURA の効果は使わない
 *   (ストロボ・フラッシュ・反転・白コマなど)。代わりに、光る演出は **毎秒 3 回まで** に抑えたオリジナルだけ (util.ts の flashAllowed)
 * - オリジナルの演出 11 個 (登場 3・退場 2・表示中 2・装飾 3・カメラ 1)。拍 (env.beat) に合わせて動く。拍が無い曲は 0.5 秒ごとの仮の拍
 */

export const INTENSE_STYLE_KEY = 'zz-intense';
export const INTENSE_SET = 'zzIntense';
const PACK = 'zunzun-intense';

/** 叩きつけるための短い長さ */
const snapIn = (dur: number): number => Math.min(0.26, Math.max(0.1, dur * 0.18));
const snapOut = (dur: number): number => Math.min(0.3, Math.max(0.12, dur * 0.2));

export function intenseEffects(J: PackJ): PackEffect[] {
  const set = INTENSE_SET;
  return [
    // ------------------------------------------------------------ 登場
    {
      group: 'enter',
      key: 'zzSlam',
      def: {
        name: '叩きつける',
        tags: ['pop', 'graphic'],
        set,
        inDur: (dur: number) => snapIn(dur),
        apply(_env: PackEnv, it: PackItem, p: number) {
          // 大きく手前から一気に落ちてきて、少し沈んで止まる
          const q = easeOutBack(Math.min(1, p), 2.2);
          it.size *= 1 + (1 - q) * 0.7;
          it.blur = (it.blur ?? 0) + (1 - Math.min(1, p * 1.5)) * it.size * 0.05;
          it.alpha = (it.alpha ?? 1) * Math.min(1, p * 3);
        },
      },
    },
    {
      group: 'enter',
      key: 'zzShutter',
      def: {
        name: 'シャッター',
        tags: ['glitch', 'graphic'],
        set,
        inDur: (dur: number) => Math.min(0.32, Math.max(0.14, dur * 0.22)),
        apply(_env: PackEnv, it: PackItem, p: number) {
          const seed = it.seed ?? 0;
          const size = it.size;
          // 3 段で、決まった順番のばらばらな文字から現れる
          const step = Math.floor(p * 3);
          it.charFns.push((i) => {
            const at = Math.floor(J.r(seed, i, 401) * 3);
            if (at > step) return { hide: true };
            const fresh = at === step && p < 1;
            return fresh ? { dx: J.rs(seed, i, step, 402) * size * 0.18, a: 0.85 } : null;
          });
        },
      },
    },
    {
      group: 'enter',
      key: 'zzFlyIn',
      def: {
        name: '奥から飛び込む',
        tags: ['pop', 'graphic'],
        set,
        inDur: (dur: number) => Math.min(0.34, Math.max(0.14, dur * 0.22)),
        apply(_env: PackEnv, it: PackItem, p: number) {
          const size = it.size;
          it.charFns.push((i, _g, n) => {
            const q = staggered(p, i, n, 0.4);
            if (q <= 0) return { hide: true };
            const e = easeOut(q);
            return { s: 0.15 + 0.85 * easeOutBack(q, 1.4), a: Math.min(1, q * 2), dy: (1 - e) * size * 0.25, blur: (1 - e) * size * 0.08 };
          });
        },
      },
    },
    // ------------------------------------------------------------ 退場
    {
      group: 'exit',
      key: 'zzSlice',
      def: {
        name: '切り裂く',
        tags: ['glitch', 'graphic'],
        set,
        outDur: (dur: number) => snapOut(dur),
        apply(env: PackEnv, it: PackItem, p: number) {
          const w = env.W;
          it.charFns.push((i) => {
            const dir = i % 2 ? 1 : -1;
            const e = easeIn(p);
            return { dx: dir * e * w * 0.35, sy: 1 - e * 0.7, a: 1 - e };
          });
        },
      },
    },
    {
      group: 'exit',
      key: 'zzBlast',
      def: {
        name: '吹き飛ぶ',
        tags: ['pop', 'graphic'],
        set,
        outDur: (dur: number) => snapOut(dur),
        apply(env: PackEnv, it: PackItem, p: number) {
          const seed = it.seed ?? 0;
          const reach = Math.max(env.W, env.H) * 0.4;
          it.charFns.push((i, _g, n) => {
            const e = easeIn(p);
            const x = n > 1 ? i / (n - 1) - 0.5 : 0;
            const ang = Math.atan2(J.rs(seed, i, 411) * 0.8, x || J.rs(seed, i, 412));
            return { dx: Math.cos(ang) * reach * e, dy: Math.sin(ang) * reach * e, rot: J.rs(seed, i, 413) * 140 * e, s: 1 + e * 0.6, a: 1 - e };
          });
        },
      },
    },
    // ------------------------------------------------------------ 表示中の動き
    {
      group: 'hold',
      key: 'zzBeatPump',
      def: {
        name: '拍で脈打つ',
        tags: ['pop'],
        w: 3,
        set,
        apply(env: PackEnv, it: PackItem, amt: number) {
          const k = amt * Math.min(1.2, (env.fx.motion ?? 0.7) + 0.3);
          if (k < 0.01) return;
          const b = beatOf(env);
          const kick = Math.exp(-b.since * 11);
          it.size *= 1 + 0.085 * kick * k;
          const size = it.size;
          // 拍ごとに、偶数と奇数の文字が交互に跳ねる
          it.charFns.push((i) => ((i + b.index) % 2 ? { dy: -kick * size * 0.06 * k } : null));
        },
      },
    },
    {
      group: 'hold',
      key: 'zzJolt',
      def: {
        name: '拍でずれる',
        tags: ['glitch'],
        w: 2.5,
        set,
        apply(env: PackEnv, it: PackItem, amt: number) {
          if (amt < 0.01) return;
          const b = beatOf(env);
          const seed = it.seed ?? 0;
          const settle = Math.exp(-b.since * 14);
          const size = it.size;
          it.charFns.push((i) => {
            // 拍ごとに、決まった数文字だけが横へずれて戻る
            if (J.r(seed, b.index, i, 421) > 0.35) return null;
            return { dx: J.rs(seed, b.index, i, 422) * size * 0.22 * settle * amt, skew: J.rs(seed, b.index, i, 423) * 12 * settle * amt };
          });
        },
      },
    },
    // ------------------------------------------------------------ 装飾
    {
      group: 'decor',
      key: 'zzSpeedLines',
      def: {
        name: 'スピード線',
        layer: 'back',
        tags: ['pop', 'graphic'],
        w: 1,
        set,
        draw(env: PackEnv, bb: PackBox | null, P: { seed?: number }) {
          const box = centerBox(env, bb);
          const e = J.clamp(env.lt / 0.12) * (1 - J.clamp(env.pOut));
          if (e <= 0) return;
          const b = beatOf(env);
          const s = (P.seed ?? 1) + b.index;
          const u = env.H / 1080;
          const cy = (box.y0 + box.y1) / 2;
          const kick = 0.35 + 0.65 * Math.exp(-b.since * 6);
          for (let k = 0; k < 14; k++) {
            // 文字の上下から、横へ走る線 (拍ごとに並びが変わる)
            const side = k % 2 ? 1 : -1;
            const y = cy + side * ((box.y1 - box.y0) * 0.6 + J.r(s, k, 1) * env.H * 0.18);
            const len = env.W * (0.12 + J.r(s, k, 2) * 0.3) * kick;
            const x = J.r(s, k, 3) * (env.W - len);
            const c = k % 3 === 0 ? env.sc.accent : env.sc.fg;
            env.line([[x, y], [x + len, y]], c, (1 + J.r(s, k, 4) * 2) * u, 0.35 * e * kick, false);
          }
        },
      },
    },
    {
      group: 'decor',
      key: 'zzEqBars',
      def: {
        name: '拍のバー',
        layer: 'front',
        tags: ['pop', 'graphic'],
        w: 1,
        set,
        draw(env: PackEnv, bb: PackBox | null, P: { seed?: number; low?: boolean }) {
          const box = centerBox(env, bb);
          const e = J.clamp(env.lt / 0.15) * (1 - J.clamp(env.pOut));
          if (e <= 0) return;
          const b = beatOf(env);
          const s = P.seed ?? 1;
          const u = env.H / 1080;
          const n = 24;
          const w = Math.max(env.W * 0.25, box.x1 - box.x0);
          const x0 = (box.x0 + box.x1) / 2 - w / 2;
          const base = P.low === false ? box.y0 - 18 * u : box.y1 + 60 * u;
          const energy = env.energy ?? 0.5;
          const kick = Math.exp(-b.since * 8);
          for (let k = 0; k < n; k++) {
            const hgt = (8 + 46 * energy * (0.35 + 0.65 * J.r(s, b.index, k, 431)) * (0.5 + 0.5 * kick)) * u;
            const x = x0 + (w / n) * k;
            const c = k % 4 === 0 ? env.sc.accent : env.sc.fg;
            env.line([[x, base], [x, base - hgt]], c, Math.max(2, (w / n) * 0.45), 0.7 * e, false);
          }
        },
      },
    },
    {
      group: 'decor',
      key: 'zzEdgeFlash',
      def: {
        name: '縁の閃き',
        layer: 'front',
        tags: ['pop'],
        w: 1,
        set,
        draw(env: PackEnv) {
          const b = beatOf(env);
          // 光過敏への配慮: 毎秒 3 回までの拍だけで光らせ、画面の縁だけを細く、弱く (真ん中は光らせない)
          if (!flashAllowed(b.index, b.len)) return;
          const a = 0.32 * Math.exp(-b.since * 9) * (1 - J.clamp(env.pOut));
          if (a < 0.01) return;
          const u = env.H / 1080;
          const { W, H } = env;
          const m = 14 * u;
          const pts: [number, number][] = [[m, m], [W - m, m], [W - m, H - m], [m, H - m], [m, m]];
          env.line(pts, env.sc.accent, 6 * u, a, false);
          env.line(pts, env.sc.fg, 2 * u, a * 0.8, false);
        },
      },
    },
    // ------------------------------------------------------------ カメラ
    {
      group: 'cam',
      key: 'zzKick',
      def: {
        name: 'キックで揺れる',
        tags: ['pop', 'glitch'],
        w: 1,
        set,
        get(env: PackEnv) {
          const m = env.fx.motion ?? 0.7;
          const b = beatOf(env);
          const kick = Math.exp(-b.since * 12);
          const seed = env.cut.seed ?? 0;
          return {
            s: 1 + 0.03 * m * kick,
            x: J.rs(seed, b.index, 441) * env.W * 0.006 * m * kick,
            y: J.rs(seed, b.index, 442) * env.H * 0.006 * m * kick,
            rot: (b.index % 2 ? 1 : -1) * 0.6 * m * kick,
          };
        },
      },
    },
  ];
}

const RESTRICTED_GROUPS = ['layout', 'enter', 'exit', 'hold', 'cam', 'fx', 'trans', 'treat', 'bg', 'decor'];

export const intensePack: MotionPack = {
  id: PACK,
  set: INTENSE_SET,
  styleKey: INTENSE_STYLE_KEY,
  buildStyle(J) {
    const base = J.STYLES.acid ?? J.STYLES.noir ?? Object.values(J.STYLES)[0]!;
    const st = JSON.parse(JSON.stringify(base)) as Record<string, unknown> & { name: string };
    // 白い文字、電気のシアンと熱いマゼンタ (暗い背景の配色)
    st.schemes = [
      { bg: '#050507', fg: '#FFFFFF', sub: '#C9CCD6', accent: '#20E8FF', accent2: '#FF2E88', ink: '#FFFFFF', dim: '#14151b', ghostA: '#20E8FF', ghostB: '#FF2E88' },
      { bg: '#07040a', fg: '#FFFFFF', sub: '#D6CBE0', accent: '#FF2E88', accent2: '#FFE14D', ink: '#FFFFFF', dim: '#1a1220', ghostA: '#FF2E88', ghostB: '#20E8FF' },
    ];
    st.fonts = { display: ['gothic_black', 'dela', 'zenkaku'], serif: ['mincho_black'], body: ['gothic_bold'], mono: ['mono'] };
    st.texture = { grain: 0.5, paper: 0, scan: 0.25 };
    st.ghost = 1.2;
    st.glow = 1.2;
    st.hud = false;
    const bias = (st.bias ?? {}) as Record<string, Record<string, number>>;
    st.bias = {
      ...bias,
      layout: { huge: 3, condensed: 2.5, center: 2, stack: 2, marquee: 1.8, diag: 1.6, tile: 1.4 },
      enter: { zzSlam: 7, zzShutter: 5, zzFlyIn: 5, slice: 1.4, stretch: 1.3, zoom: 1.3 },
      exit: { zzSlice: 6, zzBlast: 6, glitch: 1.3, slice: 1.2 },
      cam: { ...(bias.cam ?? {}), zzKick: 10 },
      // 元のスタイル (アシッド) の画面効果の選ばれやすさは引き継がない (点滅系の名前が載っていて紛らわしいため。どのみち無効にしている)
      fx: {},
    };
    st.decor = { zzSpeedLines: 8, zzEqBars: 6, zzEdgeFlash: 5 };
    st.name = '衝撃 (ZUNZUN)';
    st.desc = 'EDM・速い曲向け。拍で叩きつけ、拍で脈打つ。光る演出は毎秒 3 回まで';
    return st;
  },
  effects: intenseEffects,
  configure(project, J) {
    allowOnlyTagged(project, J, PACK, ['pop', 'glitch', 'graphic'], RESTRICTED_GROUPS);
    // 光過敏への配慮: 画面を点滅・反転させる JIZURA の効果は使わない (光るのはオリジナルの、毎秒 3 回までのものだけ)
    disable(project, 'fx', ['flash', 'invert', 'strobe', 'whiteFrame', 'bandInvert', 'mirrorFlash', 'negativeRing', 'bloomFlash']);
    disable(project, 'trans', ['flashCross']);
    const fx = (project.fx ?? {}) as Record<string, unknown>;
    // koma 0 = 出力のフレームごとに描く (既定の 12 コマ/秒だと、0.16 秒ほどの「叩きつけ」が 2 コマしか無く、途中が描かれなかった)
    project.fx = { ...fx, glitch: 0.7, chroma: 0.9, flash: false, koma: 0, onTwos: false };
  },
};
