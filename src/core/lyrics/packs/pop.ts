import type { MotionPack, PackBox, PackEffect, PackEnv, PackItem, PackJ } from './types';
import { allowOnlyTagged, beatOf, centerBox, disable, easeIn, easeOut, easeOutBack, staggered } from './util';

/**
 * 弾む (ZUNZUN)。ポップ・アイドル・明るい曲向け: 丸い文字が跳ねて着地し、拍でぴょこぴょこ動き、ぱちんと弾けて消える。
 * - JIZURA の演出は pop の印があるものだけ。画面を点滅・反転させる効果、白く飛ばす登場・退場、ホラーの飛び出しは使わない
 * - オリジナルの演出 11 個 (登場 3・退場 2・表示中 2・装飾 3・カメラ 1)。拍 (env.beat) に合わせる。拍が無い曲は 0.5 秒ごとの仮の拍
 * - 可愛さは「動きの弾み (行き過ぎて戻る・潰れて伸びる)」で出す。光らせる演出は使わない
 */

export const POP_STYLE_KEY = 'zz-pop';
export const POP_SET = 'zzPop';
const PACK = 'zunzun-pop';

/** 弾む登場・退場の長さ (叩きつけより少し長く、弾みが見えるように) */
const bounceIn = (dur: number): number => Math.min(0.6, Math.max(0.22, dur * 0.25));
const bounceOut = (dur: number): number => Math.min(0.45, Math.max(0.16, dur * 0.2));

/** 落ちて 2 回跳ねて止まる (0..1 → 高さ 1..0) と、着地の瞬間の近さ (0..1) */
function hop(q: number): { h: number; impact: number } {
  if (q >= 1) return { h: 0, impact: 0 };
  // 落下 (0..0.5)、1 回目の跳ね (0.5..0.8、高さ 0.28)、2 回目 (0.8..1、高さ 0.08)
  if (q < 0.5) {
    const x = q / 0.5;
    return { h: 1 - x * x, impact: Math.max(0, (x - 0.85) / 0.15) };
  }
  const [a, b, top] = q < 0.8 ? [0.5, 0.8, 0.28] : [0.8, 1, 0.08];
  const x = (q - a) / (b - a);
  const h = top * 4 * x * (1 - x);
  const impact = Math.max(0, 1 - x / 0.15) * (top / 0.28);
  return { h, impact };
}

export function popEffects(J: PackJ): PackEffect[] {
  const set = POP_SET;
  return [
    // ------------------------------------------------------------ 登場
    {
      group: 'enter',
      key: 'zzHopIn',
      def: {
        name: '跳ねて着地',
        tags: ['pop'],
        set,
        inDur: (dur: number) => bounceIn(dur),
        apply(_env: PackEnv, it: PackItem, p: number) {
          const size = it.size;
          it.charFns.push((i, _g, n) => {
            const q = staggered(p, i, n, 0.45);
            if (q <= 0) return { hide: true };
            const { h, impact } = hop(q);
            // 着地の瞬間に横へ潰れ、縦に縮む
            const squash = impact * 0.28;
            return { dy: -h * size * 1.1, sx: 1 + squash, sy: 1 - squash, a: Math.min(1, q * 4) };
          });
        },
      },
    },
    {
      group: 'enter',
      key: 'zzPuff',
      def: {
        name: 'ぷくっと膨らむ',
        tags: ['pop'],
        set,
        inDur: (dur: number) => bounceIn(dur),
        apply(_env: PackEnv, it: PackItem, p: number) {
          const seed = it.seed ?? 0;
          it.charFns.push((i, _g, n) => {
            // 決まったばらばらの順で、1 文字ずつ膨らむ
            const order = n > 1 ? J.r(seed, i, 501) : 0;
            const q = J.clamp((p - order * 0.45) / 0.55);
            if (q <= 0) return { hide: true };
            return { s: Math.max(0, easeOutBack(q, 3)), rot: J.rs(seed, i, 502) * 14 * (1 - q), a: Math.min(1, q * 3) };
          });
        },
      },
    },
    {
      group: 'enter',
      key: 'zzJellySlide',
      def: {
        name: 'ぷるんと滑り込む',
        tags: ['pop'],
        set,
        inDur: (dur: number) => bounceIn(dur),
        apply(env: PackEnv, it: PackItem, p: number) {
          const dir = J.r(it.seed ?? 0, 511) < 0.5 ? -1 : 1;
          const w = env.W;
          it.charFns.push((i, _g, n) => {
            const q = staggered(p, i, n, 0.3);
            if (q <= 0) return { hide: true };
            const e = easeOut(q);
            // 止まったあと、ゼリーのように左右へ傾いて落ち着く
            const wob = Math.sin(q * Math.PI * 3) * (1 - q);
            return { dx: dir * (1 - e) * w * 0.22, skew: -dir * wob * 22, sx: 1 + wob * 0.08 * dir, a: Math.min(1, q * 3) };
          });
        },
      },
    },
    // ------------------------------------------------------------ 退場
    {
      group: 'exit',
      key: 'zzHopAway',
      def: {
        name: '跳んで去る',
        tags: ['pop'],
        set,
        outDur: (dur: number) => bounceOut(dur),
        apply(env: PackEnv, it: PackItem, p: number) {
          const seed = it.seed ?? 0;
          const size = it.size;
          const hgt = env.H;
          it.charFns.push((i, _g, n) => {
            const q = staggered(p, i, n, 0.5);
            if (q <= 0) return null;
            // 一度しゃがんでから、弧を描いて跳び、下へ抜ける
            const crouch = q < 0.15 ? Math.sin((q / 0.15) * Math.PI) * 0.18 : 0;
            const x = Math.max(0, (q - 0.15) / 0.85);
            const dy = -size * 1.2 * 4 * x * (1 - x) + x * x * hgt * 0.35;
            return { dy, dx: J.rs(seed, i, 521) * size * 0.8 * x, sx: 1 + crouch, sy: 1 - crouch, rot: J.rs(seed, i, 522) * 50 * x, a: 1 - easeIn(x) };
          });
        },
      },
    },
    {
      group: 'exit',
      key: 'zzBubblePop',
      def: {
        name: 'ぱちんと弾ける',
        tags: ['pop'],
        set,
        outDur: (dur: number) => bounceOut(dur),
        apply(_env: PackEnv, it: PackItem, p: number) {
          const seed = it.seed ?? 0;
          it.charFns.push((i, _g, n) => {
            const order = n > 1 ? J.r(seed, i, 531) : 0;
            const q = J.clamp((p - order * 0.5) / 0.5);
            if (q <= 0) return null;
            if (q >= 1) return { hide: true };
            // 少し膨らんでから、一気にしぼんで消える
            const s = q < 0.55 ? 1 + 0.3 * easeOut(q / 0.55) : 1.3 * (1 - easeIn((q - 0.55) / 0.45));
            return { s, a: q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3 };
          });
        },
      },
    },
    // ------------------------------------------------------------ 表示中の動き
    {
      group: 'hold',
      key: 'zzBeatHop',
      def: {
        name: '拍でぴょこぴょこ',
        tags: ['pop'],
        w: 3,
        set,
        apply(env: PackEnv, it: PackItem, amt: number) {
          const k = amt * Math.min(1.2, (env.fx.motion ?? 0.7) + 0.3);
          if (k < 0.01) return;
          const b = beatOf(env);
          const size = it.size;
          // 拍ごとに、4 文字おきの組が順番に跳ねる (左から右へ、跳ねる組が移っていく)
          const t = Math.min(1, b.since / Math.max(0.12, b.len * 0.7));
          const up = t < 1 ? 4 * t * (1 - t) : 0;
          const land = Math.max(0, 1 - Math.abs(t - 1) / 0.12) * 0.12;
          it.charFns.push((i) => {
            if ((i - b.index) % 4 !== 0) return null;
            return { dy: -up * size * 0.14 * k, sx: 1 + land * k, sy: 1 - land * k + up * 0.06 * k };
          });
        },
      },
    },
    {
      group: 'hold',
      key: 'zzSwing',
      def: {
        name: '拍でゆらゆら',
        tags: ['pop'],
        w: 2.5,
        set,
        apply(env: PackEnv, it: PackItem, amt: number) {
          if (amt < 0.01) return;
          const b = beatOf(env);
          const size = it.size;
          // 振り子のように、1 拍で片側へ、次の拍で反対へ (文字ごとに少し遅れる)
          const phase = Math.PI * (b.index + b.since / b.len);
          it.charFns.push((i) => {
            const s = Math.sin(phase - i * 0.35);
            return { rot: s * 7 * amt, dy: -Math.abs(Math.cos(phase - i * 0.35)) * size * 0.03 * amt };
          });
        },
      },
    },
    // ------------------------------------------------------------ 装飾
    {
      group: 'decor',
      key: 'zzSparkle',
      def: {
        name: 'きらきら',
        layer: 'front',
        tags: ['pop'],
        w: 1,
        set,
        draw(env: PackEnv, bb: PackBox | null, P: { seed?: number }) {
          const box = centerBox(env, bb);
          const e = J.clamp(env.lt / 0.25) * (1 - J.clamp(env.pOut));
          if (e <= 0) return;
          const s = P.seed ?? 1;
          const u = env.H / 1080;
          const w = box.x1 - box.x0;
          for (let k = 0; k < 7; k++) {
            // 文字の枠のまわりの決まった場所で、それぞれの速さでまたたく (明るさの急な変化はしない、ゆるやかな sin)
            const x = box.x0 - w * 0.08 + J.r(s, k, 541) * w * 1.16;
            const y = J.r(s, k, 542) < 0.5 ? box.y0 - (12 + J.r(s, k, 543) * 50) * u : box.y1 + (12 + J.r(s, k, 543) * 50) * u;
            const tw = 0.5 + 0.5 * Math.sin(env.t * (2 + J.r(s, k, 544) * 2.5) + J.r(s, k, 545) * J.TAU);
            const r = (6 + J.r(s, k, 546) * 12) * u * (0.4 + 0.6 * tw);
            const c = k % 3 === 0 ? env.sc.accent : k % 3 === 1 ? (env.sc.accent2 ?? env.sc.fg) : env.sc.fg;
            const a = 0.75 * e * tw;
            env.line([[x - r, y], [x + r, y]], c, 2.2 * u, a, false);
            env.line([[x, y - r], [x, y + r]], c, 2.2 * u, a, false);
            const d = r * 0.4;
            env.line([[x - d, y - d], [x + d, y + d]], c, 1.4 * u, a * 0.7, false);
            env.line([[x - d, y + d], [x + d, y - d]], c, 1.4 * u, a * 0.7, false);
          }
        },
      },
    },
    {
      group: 'decor',
      key: 'zzBeatDots',
      def: {
        name: '拍のドット',
        layer: 'front',
        tags: ['pop'],
        w: 1,
        set,
        draw(env: PackEnv, bb: PackBox | null, P: { low?: boolean }) {
          const box = centerBox(env, bb);
          const e = J.clamp(env.lt / 0.2) * (1 - J.clamp(env.pOut));
          if (e <= 0) return;
          const b = beatOf(env);
          const u = env.H / 1080;
          const cx = (box.x0 + box.x1) / 2;
          const y = P.low === false ? box.y0 - 34 * u : box.y1 + 44 * u;
          const gap = 34 * u;
          const on = ((b.index % 4) + 4) % 4;
          const kick = Math.exp(-b.since * 7);
          for (let k = 0; k < 4; k++) {
            // 4 つの丸のうち、今の拍の丸だけが大きく弾む (小さな丸なので、光る演出にはしない)
            const x = cx + (k - 1.5) * gap;
            const cur = k === on;
            const r = (cur ? 8 + 6 * kick : 5) * u;
            env.circle(x, y - (cur ? 10 * kick * u : 0), r, cur ? env.sc.accent : env.sc.fg, null, 0, (cur ? 0.95 : 0.45) * e, false);
          }
        },
      },
    },
    {
      group: 'decor',
      key: 'zzConfettiBeat',
      def: {
        name: '拍の紙ふぶき',
        layer: 'back',
        tags: ['pop'],
        w: 1,
        set,
        draw(env: PackEnv, bb: PackBox | null, P: { seed?: number }) {
          const box = centerBox(env, bb);
          const e = 1 - J.clamp(env.pOut);
          if (e <= 0) return;
          const b = beatOf(env);
          // 2 拍ごとに、文字の両端から小さな紙が舞う (0.9 秒で消える)
          const head = b.index - (((b.index % 2) + 2) % 2);
          const age = b.since + (b.index - head) * b.len;
          if (age > 0.9 || env.lt < age) return;
          const s = (P.seed ?? 1) + head * 7;
          const u = env.H / 1080;
          const cy = (box.y0 + box.y1) / 2;
          const cols = [env.sc.accent, env.sc.accent2 ?? env.sc.fg, env.sc.fg];
          for (let k = 0; k < 16; k++) {
            const side = k % 2 ? 1 : -1;
            const x0 = side > 0 ? box.x1 + 10 * u : box.x0 - 10 * u;
            const ang = (-0.5 - J.r(s, k, 551) * 0.9) * Math.PI * 0.5;
            const v = (260 + J.r(s, k, 552) * 380) * u;
            const x = x0 + side * Math.cos(ang) * v * age;
            const y = cy + Math.sin(ang) * v * age + 520 * u * age * age;
            const rot = J.r(s, k, 553) * J.TAU + age * (4 + J.r(s, k, 554) * 6);
            const len = (7 + J.r(s, k, 555) * 7) * u;
            const a = 0.85 * e * (1 - age / 0.9);
            env.line([[x - Math.cos(rot) * len, y - Math.sin(rot) * len], [x + Math.cos(rot) * len, y + Math.sin(rot) * len]], cols[k % 3]!, 4 * u, a, false);
          }
        },
      },
    },
    // ------------------------------------------------------------ カメラ
    {
      group: 'cam',
      key: 'zzBob',
      def: {
        name: 'ぽよんと弾む',
        tags: ['pop'],
        w: 1,
        set,
        get(env: PackEnv) {
          const m = env.fx.motion ?? 0.7;
          const b = beatOf(env);
          const kick = Math.exp(-b.since * 9);
          return { s: 1 + 0.018 * m * kick, x: 0, y: -env.H * 0.005 * m * kick, rot: (b.index % 2 ? 1 : -1) * 0.35 * m * kick };
        },
      },
    },
  ];
}

const RESTRICTED_GROUPS = ['layout', 'enter', 'exit', 'hold', 'cam', 'fx', 'trans', 'treat', 'bg', 'decor'];
/** pop の印があっても使わないもの (光る・反転する・白く飛ばす・怖い・激しく揺らす) */
const OFF = {
  fx: ['flash', 'invert', 'strobe', 'whiteFrame', 'bandInvert', 'mirrorFlash', 'negativeRing', 'bloomFlash', 'zoomStutter'],
  trans: ['flashCross'],
  enter: ['hrJumpScare', 'overexpose', 'invertBox', 'lightLeak'],
  exit: ['overexposeOut'],
  hold: ['flashBox', 'tyOutlineBlink', 'knWordBlink'],
  // 弾むのではなく、画面ごと強く揺らすもの
  cam: ['shakeHard', 'earthquake'],
};

export const popPack: MotionPack = {
  id: PACK,
  set: POP_SET,
  styleKey: POP_STYLE_KEY,
  buildStyle(J) {
    const base = J.STYLES.candy ?? J.STYLES.magenta ?? Object.values(J.STYLES)[0]!;
    const st = JSON.parse(JSON.stringify(base)) as Record<string, unknown> & { name: string };
    // ビジュアライザーの上でも読めるよう、明るい文字 + いちご・ミント・レモンの差し色 (暗い背景の配色)
    st.schemes = [
      { bg: '#120a1e', fg: '#FFF6FB', sub: '#F2D6EA', accent: '#FF5FA2', accent2: '#5FF0D6', ink: '#FFF6FB', dim: '#22163a', ghostA: '#FF5FA2', ghostB: '#5FF0D6' },
      { bg: '#0c1020', fg: '#FFFDF2', sub: '#E6E0C8', accent: '#FFD23F', accent2: '#FF7AB8', ink: '#FFFDF2', dim: '#1a1f36', ghostA: '#FFD23F', ghostB: '#8A9BFF' },
      { bg: '#0a1418', fg: '#F4FFFC', sub: '#CDEDE6', accent: '#6BE3FF', accent2: '#FFB020', ink: '#F4FFFC', dim: '#142428', ghostA: '#6BE3FF', ghostB: '#FF5FA2' },
    ];
    st.fonts = { display: ['potta', 'pop', 'round'], serif: ['kiwi'], body: ['round', 'kiwi'], mono: ['mono'] };
    st.texture = { grain: 0.1, paper: 0, scan: 0 };
    st.ghost = 0.5;
    st.glow = 0.8;
    st.hud = false;
    const bias = (st.bias ?? {}) as Record<string, Record<string, number>>;
    st.bias = {
      ...bias,
      layout: { ...(bias.layout ?? {}), center: 2, mixed: 1.8, bounceLine: 1.8, zigzag: 1.5, wave: 1.4, stickerBomb: 1.2 },
      enter: { zzHopIn: 16, zzPuff: 14, zzJellySlide: 12, bounceBig: 1.4, squashDrop: 1.4, rubber: 1.2, pop: 1.2 },
      exit: { zzHopAway: 18, zzBubblePop: 16, popOut: 1.4, bounceOff: 1.2, balloonOff: 1 },
      cam: { zzBob: 10 },
      // pop の印がある JIZURA の演出がとても多い (登場 77・退場 57) ので、オリジナルは強めに
    // 元のスタイルの画面効果の選ばれやすさは引き継がない (衝撃と同じ)
      fx: {},
    };
    st.decor = { zzSparkle: 7, zzBeatDots: 5, zzConfettiBeat: 5 };
    st.name = '弾む (VisualSync)';
    st.desc = 'ポップ・明るい曲向け。丸い文字が跳ねて着地し、拍でぴょこぴょこ、ぱちんと弾けて消える。光る演出なし';
    return st;
  },
  effects: popEffects,
  configure(project, J) {
    allowOnlyTagged(project, J, PACK, ['pop'], RESTRICTED_GROUPS);
    for (const [g, keys] of Object.entries(OFF)) disable(project, g, keys);
    const fx = (project.fx ?? {}) as Record<string, unknown>;
    // koma 0: 弾みの行き過ぎ・潰れが 12 コマ/秒だと飛んでしまうので、出力のフレームごとに描く
    project.fx = { ...fx, glitch: 0, chroma: 0.3, flash: false, koma: 0, onTwos: false };
  },
};
