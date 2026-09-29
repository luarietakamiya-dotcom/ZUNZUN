import type { MotionPack, PackBox, PackEffect, PackEnv, PackItem, PackJ } from './types';
import { allowOnlyTagged, beatOf, centerBox, disable, easeIn, easeOut, staggered } from './util';

/**
 * 轟音 (ZUNZUN)。ロック向け: ざらついて、荒くて、重い。黒・赤・白、太くて荒い書体。
 * - JIZURA の演出は graphic / glitch / editorial の印があるものだけ。可愛い装飾 (ハート・泡・花びらなど) と、
 *   画面を点滅・反転させる効果は使わない (光過敏への配慮。衝撃と同じ)
 * - オリジナルの演出 10 個 (登場 3・退場 2・表示中 2・装飾 2・カメラ 1)
 */

export const ROCK_STYLE_KEY = 'zz-rock';
export const ROCK_SET = 'zzRock';
const PACK = 'zunzun-rock';

const quickIn = (dur: number): number => Math.min(0.32, Math.max(0.12, dur * 0.22));
const quickOut = (dur: number): number => Math.min(0.45, Math.max(0.16, dur * 0.26));

/** 地面で弾む (0..1 → 0..1、最後は 1) */
function thud(x: number): number {
  if (x < 0.6) return (x / 0.6) ** 2;
  const k = (x - 0.6) / 0.4;
  return 1 - Math.sin(k * Math.PI) * 0.12 * (1 - k);
}

export function rockEffects(J: PackJ): PackEffect[] {
  const set = ROCK_SET;
  return [
    // ------------------------------------------------------------ 登場
    {
      group: 'enter',
      key: 'zzStamp',
      def: {
        name: 'スタンプ',
        tags: ['graphic', 'editorial'],
        set,
        inDur: (dur: number) => quickIn(dur),
        apply(_env: PackEnv, it: PackItem, p: number) {
          const seed = it.seed ?? 0;
          // 2 段で押しつける (大きく → 少し沈む → 止まる)。文字ごとに少し傾いたまま
          const s = p < 0.45 ? 1.4 : p < 0.75 ? 0.94 : 1;
          it.charFns.push((i) => ({ s, rot: J.rs(seed, i, 501) * (p < 0.75 ? 9 : 4), a: p < 0.12 ? 0 : 1 }));
        },
      },
    },
    {
      group: 'enter',
      key: 'zzScrawl',
      def: {
        name: '殴り書き',
        tags: ['graphic', 'editorial'],
        set,
        inDur: (dur: number, n: number) => Math.min(dur * 0.45, Math.max(0.18, n * 0.05)),
        apply(_env: PackEnv, it: PackItem, p: number) {
          const seed = it.seed ?? 0;
          const size = it.size;
          it.charFns.push((i, _g, n) => {
            const q = staggered(p, i, n, 0.8);
            if (q <= 0) return { hide: true };
            const k = 1 - easeOut(q);
            return { rot: J.rs(seed, i, 511) * 22 * k, skew: J.rs(seed, i, 512) * 18 * k, dx: J.rs(seed, i, 513) * size * 0.12 * k, s: 1 + 0.25 * k };
          });
        },
      },
    },
    {
      group: 'enter',
      key: 'zzDropHeavy',
      def: {
        name: '重く落ちる',
        tags: ['graphic'],
        set,
        inDur: (dur: number) => Math.min(0.5, Math.max(0.2, dur * 0.3)),
        apply(env: PackEnv, it: PackItem, p: number) {
          const seed = it.seed ?? 0;
          const h = env.H;
          it.charFns.push((i, _g, n) => {
            const q = staggered(p, i, n, 0.5);
            if (q <= 0) return { hide: true };
            const y = thud(q);
            // 着地の瞬間だけ少しつぶれる
            const squash = q > 0.55 && q < 0.8 ? 0.12 : 0;
            return { dy: -(1 - y) * h * 0.6, sy: 1 - squash, sx: 1 + squash * 0.6, rot: J.rs(seed, i, 521) * 6 * (1 - q) };
          });
        },
      },
    },
    // ------------------------------------------------------------ 退場
    {
      group: 'exit',
      key: 'zzTear',
      def: {
        name: '引き裂く',
        tags: ['graphic', 'glitch'],
        set,
        outDur: (dur: number) => quickOut(dur),
        apply(_env: PackEnv, it: PackItem, p: number) {
          const size = it.size;
          it.charFns.push((i, _g, n) => {
            // 行の真ん中から左右に引き裂かれる
            const side = n > 1 && i < n / 2 ? -1 : 1;
            const e = easeIn(p);
            return { dx: side * e * size * 3, rot: side * e * 18, a: 1 - e };
          });
        },
      },
    },
    {
      group: 'exit',
      key: 'zzCrumble',
      def: {
        name: '崩れ落ちる',
        tags: ['graphic'],
        set,
        outDur: (dur: number) => quickOut(dur),
        apply(env: PackEnv, it: PackItem, p: number) {
          const seed = it.seed ?? 0;
          const h = env.H;
          it.charFns.push((i) => {
            const d = J.r(seed, i, 531) * 0.4;
            const q = Math.min(1, Math.max(0, (p - d) / 0.6));
            const e = q * q;
            return { dy: e * h * 0.7, rot: J.rs(seed, i, 532) * 70 * e, a: 1 - q };
          });
        },
      },
    },
    // ------------------------------------------------------------ 表示中の動き
    {
      group: 'hold',
      key: 'zzHeadbang',
      def: {
        name: 'ヘドバン',
        tags: ['graphic'],
        w: 3,
        set,
        apply(env: PackEnv, it: PackItem, amt: number) {
          const k = amt * Math.min(1.2, (env.fx.motion ?? 0.7) + 0.3);
          if (k < 0.01) return;
          const b = beatOf(env);
          // 拍で下へうなずいて戻る (表拍を強く)
          const nod = Math.exp(-b.since * 9) * (b.index % 2 ? 0.55 : 1);
          const size = it.size;
          it.charFns.push(() => ({ dy: nod * size * 0.08 * k, sy: 1 - nod * 0.04 * k }));
        },
      },
    },
    {
      group: 'hold',
      key: 'zzGrit',
      def: {
        name: 'ざらつき',
        tags: ['glitch', 'editorial'],
        w: 2,
        set,
        apply(env: PackEnv, it: PackItem, amt: number) {
          if (amt < 0.01) return;
          const seed = it.seed ?? 0;
          // 1 秒 12 回だけ変わる小さな震え (刷りのずれのような)
          const step = Math.floor(env.lt * 12);
          const size = it.size;
          it.charFns.push((i) => ({ dx: J.rs(seed, step, i, 541) * size * 0.015 * amt, dy: J.rs(seed, step, i, 542) * size * 0.015 * amt, rot: J.rs(seed, step, i, 543) * 1.5 * amt }));
        },
      },
    },
    // ------------------------------------------------------------ 装飾
    {
      group: 'decor',
      key: 'zzScratches',
      def: {
        name: '引っかき傷',
        layer: 'back',
        tags: ['graphic', 'editorial'],
        w: 1,
        set,
        draw(env: PackEnv, bb: PackBox | null, P: { seed?: number }) {
          const box = centerBox(env, bb);
          const grow = easeOut(J.clamp(env.lt / 0.25));
          const e = 1 - J.clamp(env.pOut);
          if (grow <= 0 || e <= 0) return;
          const s = P.seed ?? 1;
          const u = env.H / 1080;
          const w = box.x1 - box.x0;
          const h = box.y1 - box.y0;
          for (let k = 0; k < 5; k++) {
            // 文字の後ろを斜めに走る、ぎざぎざの線
            const x0 = box.x0 - w * 0.1 + J.r(s, k, 1) * w * 0.6;
            const y0 = box.y0 - h * 0.3 + J.r(s, k, 2) * h * 0.4;
            const len = (0.5 + J.r(s, k, 3) * 0.7) * w * grow;
            const ang = -0.35 + J.rs(s, k, 4) * 0.2;
            const pts: [number, number][] = [];
            const seg = 9;
            for (let j = 0; j <= seg; j++) {
              const f = j / seg;
              const jit = J.rs(s, k, j, 5) * 6 * u;
              pts.push([x0 + Math.cos(ang) * len * f - Math.sin(ang) * jit, y0 + h * 0.9 + Math.sin(ang) * len * f + Math.cos(ang) * jit]);
            }
            env.line(pts, k === 0 ? env.sc.accent : env.sc.fg, (2 + J.r(s, k, 6) * 3) * u, 0.55 * e, false);
          }
        },
      },
    },
    {
      group: 'decor',
      key: 'zzStrings',
      def: {
        name: '震える弦',
        layer: 'back',
        tags: ['graphic'],
        w: 1,
        set,
        draw(env: PackEnv, bb: PackBox | null, P: { low?: boolean }) {
          const box = centerBox(env, bb);
          const e = J.clamp(env.lt / 0.3) * (1 - J.clamp(env.pOut));
          if (e <= 0) return;
          const b = beatOf(env);
          const u = env.H / 1080;
          const energy = env.energy ?? 0.5;
          const pluck = Math.exp(-b.since * 5);
          const baseY = P?.low === false ? box.y0 - 40 * u : box.y1 + 40 * u;
          // 6 本の弦が、拍ではじかれて震える
          for (let k = 0; k < 6; k++) {
            const y = baseY + (k - 2.5) * 9 * u;
            const amp = (2 + 10 * energy * pluck) * u * (1 - k * 0.1);
            const pts: [number, number][] = [];
            for (let j = 0; j <= 48; j++) {
              const f = j / 48;
              pts.push([env.W * 0.05 + f * env.W * 0.9, y + Math.sin(f * Math.PI) * Math.sin(f * 40 + env.lt * 60 + k) * amp]);
            }
            env.line(pts, k % 2 ? env.sc.fg : env.sc.accent, (1 + (5 - k) * 0.25) * u, 0.4 * e, false);
          }
        },
      },
    },
    // ------------------------------------------------------------ カメラ
    {
      group: 'cam',
      key: 'zzShove',
      def: {
        name: '突き飛ばし',
        tags: ['graphic', 'glitch'],
        w: 1,
        set,
        get(env: PackEnv) {
          const m = env.fx.motion ?? 0.7;
          const b = beatOf(env);
          // 表拍で突き飛ばされるように寄って傾き、ゆっくり戻る。いつも少し手持ちで揺れている
          const hit = b.index % 2 === 0 ? Math.exp(-b.since * 7) : 0;
          const seed = env.cut.seed ?? 0;
          return {
            s: 1 + 0.04 * m * hit,
            rot: (Math.floor(b.index / 2) % 2 ? 1 : -1) * 1.2 * m * hit + J.noise1(env.lt * 0.8, seed) * 0.4 * m,
            x: J.noise1(env.lt * 0.7, seed + 3) * env.W * 0.004 * m,
            y: J.noise1(env.lt * 0.6, seed + 7) * env.H * 0.004 * m,
          };
        },
      },
    },
  ];
}

const RESTRICTED_GROUPS = ['layout', 'enter', 'exit', 'hold', 'cam', 'fx', 'trans', 'treat', 'bg', 'decor'];
/** ロックに似合わない可愛い装飾・レイアウト (graphic などの印があっても使わない) */
const CUTE = {
  decor: ['heartsStars', 'bubbles', 'petals', 'sakuraPetals', 'hearts', 'candy', 'sparkleStars', 'rainbow', 'balloon'],
  layout: ['bubbles', 'candy', 'balloons', 'hearts'],
};

export const rockPack: MotionPack = {
  id: PACK,
  set: ROCK_SET,
  styleKey: ROCK_STYLE_KEY,
  buildStyle(J) {
    const base = J.STYLES.crimson ?? J.STYLES.noir ?? Object.values(J.STYLES)[0]!;
    const st = JSON.parse(JSON.stringify(base)) as Record<string, unknown> & { name: string };
    // 黒・赤・白 (暗い背景の配色)
    st.schemes = [
      { bg: '#060505', fg: '#F4F1EC', sub: '#B9B2AA', accent: '#E0182D', accent2: '#F4F1EC', ink: '#E0182D', dim: '#1a1414', ghostA: '#E0182D', ghostB: '#F4F1EC' },
      { bg: '#0a0606', fg: '#FFFFFF', sub: '#C9BDB2', accent: '#FF3B1F', accent2: '#FFD23F', ink: '#FF3B1F', dim: '#1f1512', ghostA: '#FF3B1F', ghostB: '#FFFFFF' },
    ];
    st.fonts = { display: ['dela', 'zenkaku', 'gothic_black'], serif: ['mincho_black'], body: ['gothic_bold'], mono: ['mono'] };
    st.texture = { grain: 0.95, paper: 0, scan: 0 };
    st.ghost = 0.6;
    st.glow = 0.5;
    st.hud = false;
    const bias = (st.bias ?? {}) as Record<string, Record<string, number>>;
    st.bias = {
      ...bias,
      layout: { huge: 2.5, stack: 2.5, diag: 2.2, condensed: 2, center: 1.6, vcols: 1.5, scatter: 1.4 },
      enter: { zzStamp: 7, zzScrawl: 5, zzDropHeavy: 5, slice: 1.2, stretch: 1.2 },
      exit: { zzTear: 6, zzCrumble: 6, glitch: 1.2, slice: 1.2 },
      cam: { zzShove: 10 },
      fx: {},
    };
    st.decor = { zzScratches: 8, zzStrings: 6 };
    st.name = '轟音 (ZUNZUN)';
    st.desc = 'ロック向け。黒・赤・白、太くて荒い書体。スタンプで押し、拍でうなずき、引き裂いて消える';
    return st;
  },
  effects: rockEffects,
  configure(project, J) {
    allowOnlyTagged(project, J, PACK, ['graphic', 'glitch', 'editorial'], RESTRICTED_GROUPS);
    disable(project, 'decor', CUTE.decor);
    disable(project, 'layout', CUTE.layout);
    // 光過敏への配慮: 画面を点滅・反転させる効果は使わない (衝撃と同じ)
    disable(project, 'fx', ['flash', 'invert', 'strobe', 'whiteFrame', 'bandInvert', 'mirrorFlash', 'negativeRing', 'bloomFlash']);
    disable(project, 'trans', ['flashCross']);
    const fx = (project.fx ?? {}) as Record<string, unknown>;
    // 荒さはコマ打ち (12 コマ/秒) の方が似合うが、短い登場が描かれなくなるので koma 0 (衝撃と同じ理由)
    project.fx = { ...fx, glitch: 0.5, chroma: 0.5, flash: false, koma: 0, onTwos: false };
  },
};
