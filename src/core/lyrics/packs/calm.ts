import type { MotionPack, PackBox, PackEffect, PackEnv, PackItem, PackJ } from './types';
import { allowOnlyTagged, centerBox, disable, easeInOut, easeOut, staggered } from './util';

/**
 * 静寂 (ZUNZUN)。バラード・アンビエント向け: ゆっくり浮かんで、ゆっくり消える。
 * - JIZURA の演出は「calm」の印が付いたものだけを使い、グリッチ・揺れ・フラッシュ・色ズレの跳ねは使わない
 * - オリジナルの演出 10 個 (登場 3・退場 2・表示中 2・装飾 2・カメラ 1)。どれも乱数は JIZURA の J.r (seed から決まる) だけ
 */

export const CALM_STYLE_KEY = 'zz-calm';
export const CALM_SET = 'zzCalm';
const PACK = 'zunzun-calm';

/** ゆっくり入るための長さ (カットの長さ dur から)。静かな曲はカットが長いので、長めに使う */
const slowIn = (dur: number): number => Math.min(1.6, Math.max(0.45, dur * 0.42));
const slowOut = (dur: number): number => Math.min(1.3, Math.max(0.4, dur * 0.34));
const center = centerBox;

export function calmEffects(J: PackJ): PackEffect[] {
  const set = CALM_SET;
  return [
    // ------------------------------------------------------------ 登場
    {
      group: 'enter',
      key: 'zzMistRise',
      def: {
        name: '霧から浮かぶ',
        tags: ['calm', 'emotional'],
        set,
        inDur: (dur: number) => slowIn(dur),
        apply(_env: PackEnv, it: PackItem, p: number) {
          const size = it.size;
          it.charFns.push((i, _g, n) => {
            const q = easeOut(staggered(p, i, n, 0.5));
            if (q <= 0) return { hide: true };
            return { dy: (1 - q) * size * 0.32, blur: (1 - q) * size * 0.22, a: q };
          });
        },
      },
    },
    {
      group: 'enter',
      key: 'zzInkBloom',
      def: {
        name: 'にじみ出る',
        tags: ['calm', 'emotional', 'editorial'],
        set,
        inDur: (dur: number) => slowIn(dur),
        apply(_env: PackEnv, it: PackItem, p: number) {
          const size = it.size;
          const seed = it.seed ?? 0;
          it.charFns.push((i) => {
            // 文字ごとに少しだけ始まりをずらす (決まった乱数)
            const d = J.r(seed, i, 301) * 0.35;
            const q = easeOut(Math.min(1, Math.max(0, (p - d) / 0.65)));
            if (q <= 0) return { hide: true };
            return { s: 1 + (1 - q) * 0.12, blur: (1 - q) * size * 0.35, a: q ** 0.7 };
          });
        },
      },
    },
    {
      group: 'enter',
      key: 'zzLantern',
      def: {
        name: '一文字ずつ灯る',
        tags: ['calm', 'emotional'],
        set,
        inDur: (dur: number, n: number) => Math.min(dur * 0.55, Math.max(0.5, n * 0.09 + 0.25)),
        apply(env: PackEnv, it: PackItem, p: number) {
          const accent = env.sc.accent2 ?? env.sc.accent;
          const base = it.color ?? env.sc.fg;
          it.charFns.push((i, _g, n) => {
            const q = staggered(p, i, n, 0.7);
            if (q <= 0) return { hide: true };
            // 灯った瞬間だけ差し色に寄り、落ち着いて元の色に戻る
            const warm = Math.max(0, 1 - q * 1.6);
            return { a: easeOut(q), s: 0.97 + 0.03 * easeOut(q), color: warm > 0.02 ? J.mix(base, accent, warm * 0.8) : undefined };
          });
          if (env.pass === 'main' && !it.shadow) it.shadow = { color: J.rgba(accent, 0.55 * (1 - p)), blur: it.size * 0.35 * (1 - p) };
        },
      },
    },
    // ------------------------------------------------------------ 退場
    {
      group: 'exit',
      key: 'zzAscend',
      def: {
        name: '静かに昇る',
        tags: ['calm', 'emotional'],
        set,
        outDur: (dur: number) => slowOut(dur),
        apply(_env: PackEnv, it: PackItem, p: number) {
          const size = it.size;
          it.charFns.push((i, _g, n) => {
            const q = easeInOut(staggered(p, i, n, 0.45));
            if (q >= 1) return { hide: true };
            return { dy: -q * size * 0.45, a: 1 - q, blur: q * size * 0.18 };
          });
        },
      },
    },
    {
      group: 'exit',
      key: 'zzMelt',
      def: {
        name: '溶けて消える',
        tags: ['calm', 'emotional'],
        set,
        outDur: (dur: number) => slowOut(dur),
        apply(_env: PackEnv, it: PackItem, p: number) {
          const q = easeInOut(p);
          it.alpha = (it.alpha ?? 1) * (1 - q);
          it.blur = (it.blur ?? 0) + q * it.size * 0.28;
          it.track = (it.track ?? 0) + q * 0.12;
        },
      },
    },
    // ------------------------------------------------------------ 表示中の動き
    {
      group: 'hold',
      key: 'zzBreath',
      def: {
        name: 'ゆっくり呼吸',
        tags: ['calm'],
        // 文字の動きの重みはスタイルでは変えられない (JIZURA の仕組み)。部品セットがオフの間は候補に入らない
        w: 3,
        set,
        apply(env: PackEnv, it: PackItem, amt: number) {
          const k = amt * Math.min(1, (env.fx.motion ?? 0.7) + 0.3);
          if (k < 0.01) return;
          const t = env.lt;
          const size = it.size;
          it.size = size * (1 + 0.016 * k * Math.sin((t / 4.2) * J.TAU));
          it.charFns.push((i) => ({ dy: Math.sin((t / 6) * J.TAU + i * 0.55) * size * 0.018 * k }));
        },
      },
    },
    {
      group: 'hold',
      key: 'zzMoonSweep',
      def: {
        name: '月光が撫でる',
        tags: ['calm', 'emotional'],
        w: 2.5,
        set,
        apply(env: PackEnv, it: PackItem, amt: number) {
          if (amt < 0.01) return;
          const period = 5.2;
          const phase = ((env.lt + (it.seed ?? 0) % 7) % period) / period;
          it.charFns.push((i, _g, n) => {
            // 明るさの帯が左から右へ (帯の外は少しだけ落とす)
            const x = n > 1 ? i / (n - 1) : 0.5;
            const band = Math.exp(-(((x - (phase * 1.6 - 0.3)) / 0.18) ** 2));
            return { a: 1 - amt * 0.22 * (1 - band) };
          });
        },
      },
    },
    // ------------------------------------------------------------ 装飾
    {
      group: 'decor',
      key: 'zzDust',
      def: {
        name: '光の塵',
        layer: 'front',
        tags: ['calm', 'emotional'],
        w: 1,
        set,
        subtle: true,
        draw(env: PackEnv, bb: PackBox | null, P: { seed?: number }) {
          const box = center(env, bb);
          const e = J.clamp(env.lt / 0.8) * (1 - J.clamp(env.pOut));
          if (e <= 0) return;
          const s = P.seed ?? 1;
          const n = 9;
          const w = box.x1 - box.x0;
          const h = box.y1 - box.y0;
          const u = env.H / 1080;
          for (let k = 0; k < n; k++) {
            // 文字のまわりの少し広い範囲から、ゆっくり上へ漂う
            const x0 = box.x0 - w * 0.15 + J.r(s, k, 1) * w * 1.3;
            const y0 = box.y1 + h * 0.4 - J.r(s, k, 2) * h * 1.8;
            const speed = 6 + J.r(s, k, 3) * 10;
            const x = x0 + J.noise1(env.lt * 0.25 + k, s) * 18 * u;
            const y = y0 - env.lt * speed * u;
            const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(env.lt * (0.8 + J.r(s, k, 4)) + k * 1.7));
            const r = (1.2 + J.r(s, k, 5) * 1.8) * u;
            const c = k % 3 === 0 ? (env.sc.accent2 ?? env.sc.accent) : env.sc.fg;
            env.circle(x, y, r * 2.4, J.rgba(c, 0.12 * tw * e), null, 0, 1, false);
            env.circle(x, y, r, J.rgba(c, 0.75 * tw * e), null, 0, 1, false);
          }
        },
      },
    },
    {
      group: 'decor',
      key: 'zzHairline',
      def: {
        name: '細い線',
        layer: 'front',
        tags: ['calm', 'editorial'],
        w: 1,
        set,
        subtle: true,
        draw(env: PackEnv, bb: PackBox | null, P: { low?: boolean }) {
          const box = center(env, bb);
          const grow = easeInOut(J.clamp(env.lt / 1.4));
          const e = 1 - J.clamp(env.pOut);
          if (grow <= 0 || e <= 0) return;
          const u = env.H / 1080;
          const cx = (box.x0 + box.x1) / 2;
          const half = ((box.x1 - box.x0) / 2) * 1.1 * grow;
          const y = P?.low === false ? box.y0 - 22 * u : box.y1 + 22 * u;
          env.line([[cx - half, y], [cx + half, y]], env.sc.sub ?? env.sc.fg, 1.2 * u, 0.55 * e, false);
          // 両端の小さな点
          env.circle(cx - half, y, 2 * u, env.sc.accent, null, 0, 0.7 * e * grow, false);
          env.circle(cx + half, y, 2 * u, env.sc.accent, null, 0, 0.7 * e * grow, false);
        },
      },
    },
    // ------------------------------------------------------------ カメラ
    {
      group: 'cam',
      key: 'zzFloat',
      def: {
        name: 'ゆるやかな漂い',
        tags: ['calm', 'emotional'],
        w: 1,
        set,
        get(env: PackEnv) {
          const m = env.fx.motion ?? 0.7;
          const seed = env.cut.seed ?? 0;
          const u = J.clamp(env.lt / Math.max(0.3, env.cut.dur));
          return {
            s: 1 + 0.025 * m * easeInOut(u),
            x: J.noise1(env.lt * 0.12, seed) * env.W * 0.006 * m,
            y: J.noise1(env.lt * 0.1, seed + 9) * env.H * 0.006 * m,
          };
        },
      },
    },
  ];
}

/** JIZURA の演出のうち、静寂で使ってよいもの: 「calm」の印があるもの (オリジナルの演出は別) */
const RESTRICTED_GROUPS = ['layout', 'enter', 'exit', 'hold', 'cam', 'fx', 'trans', 'treat', 'bg', 'decor'];

export const calmPack: MotionPack = {
  id: PACK,
  set: CALM_SET,
  styleKey: CALM_STYLE_KEY,
  buildStyle(J) {
    const base = J.STYLES.gold ?? J.STYLES.noir ?? Object.values(J.STYLES)[0]!;
    const st = JSON.parse(JSON.stringify(base)) as Record<string, unknown> & { name: string };
    // 夜の静けさ: 象牙色の文字、月明かりの青と温かい金の差し色 (暗い背景の配色。重ねたときに読みやすい)
    st.schemes = [
      { bg: '#07090d', fg: '#EFE8DC', sub: '#A6AFB9', accent: '#BFD3E6', accent2: '#E6CC9E', ink: '#EFE8DC', dim: '#161b22', ghostA: '#BFD3E6', ghostB: '#E6CC9E' },
      { bg: '#0b0a10', fg: '#F2EEE6', sub: '#B3AEBE', accent: '#D5C6E8', accent2: '#E9D2A8', ink: '#F2EEE6', dim: '#18161f', ghostA: '#D5C6E8', ghostB: '#E9D2A8' },
    ];
    st.fonts = { display: ['mincho_light', 'shippori'], serif: ['mincho_light', 'shippori'], body: ['mincho_light'], mono: ['mono'] };
    st.texture = { grain: 0.25, paper: 0, scan: 0 };
    st.ghost = 0.15;
    st.glow = 0.9;
    st.hud = false;
    const bias = (st.bias ?? {}) as Record<string, Record<string, number>>;
    st.bias = {
      ...bias,
      // 組み方: 余白の多いシンプルなものを選ばれやすく、泡・円軌道・通知のような賑やかなものは選ばれにくく
      // (JIZURA の calm の印が付いたレイアウトにも賑やかなものが混ざっていた。2026-09-29 に描いて確かめた)
      layout: {
        center: 3, stack: 3, vcols: 2.5, lowerThird: 3, quote: 2.5, justified: 2, tyMargin: 2.5, credits: 2, hanging: 2, tyBaseline: 2, dropCap: 1.5,
        bubbles: 0.2, orbit: 0.4, spiral: 0.3, corners: 0.5, notification: 0.2, neon: 0.3, tyIndexTable: 0.3, circle: 0.5, mixed: 0.5, gloss: 0.6,
      },
      enter: { ...(bias.enter ?? {}), zzMistRise: 7, zzInkBloom: 6, zzLantern: 5 },
      exit: { ...(bias.exit ?? {}), zzAscend: 7, zzMelt: 7 },
      cam: { ...(bias.cam ?? {}), zzFloat: 10 },
    };
    st.decor = { zzDust: 10, zzHairline: 7 };
    st.name = '静寂 (ZUNZUN)';
    st.desc = 'バラード・アンビエント向け。細い明朝で、ゆっくり浮かんでゆっくり消える。グリッチや揺れは使わない';
    return st;
  },
  effects: calmEffects,
  configure(project, J) {
    allowOnlyTagged(project, J, PACK, ['calm'], RESTRICTED_GROUPS);
    // calm の印があっても、画面を光らせる効果は使わない (「フラッシュは使わない」)
    disable(project, 'fx', ['bloomFlash', 'flash', 'whiteFrame']);
    disable(project, 'trans', ['flashCross']);
    // グリッチ・色ズレの跳ね・フラッシュを使わない (フラッシュは画面を白く光らせる演出)
    const fx = (project.fx ?? {}) as Record<string, unknown>;
    // koma 0 = 出力のフレームごとに描く (ゆっくりした動きをなめらかに。既定は 12 コマ/秒のコマ打ち)
    project.fx = { ...fx, glitch: 0, chroma: 0.15, flash: false, koma: 0, onTwos: false };
  },
};
