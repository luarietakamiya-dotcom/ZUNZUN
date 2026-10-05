import type { MotionPack, PackEffect, PackEnv, PackItem, PackJ } from './types';
import { clean, type LayoutEnv, type Rng } from './design-kit';
import { beatOf, easeInOut, easeOut, easeOutBack, staggered } from './util';
import { artDirectedLayouts, directedCamera, directedEnter } from './art-directed-layouts';

const clamp = (p: number) => Math.min(1, Math.max(0, p));
const strength = (env: PackEnv) => clamp(env.fx.motion ?? 0.7);
const short = (dur: number) => Math.min(0.45, dur * 0.3);
type Apply = (env: PackEnv, it: PackItem, p: number) => void;
const effect = (group: 'enter' | 'hold' | 'exit', key: string, name: string, apply: Apply, seconds = 0.45): PackEffect => ({
  group, key, def: { name, apply, ...(group === 'enter' ? { inDur: (dur: number) => Math.min(seconds, dur * 0.4) } : group === 'exit' ? { outDur: short } : {}) },
});

/** 独立した部品セット。文字のテーマが混ざらず、個別編集ではほかの部品も指定できる。 */
function themed(id: string, name: string, desc: string, colors: [string, string, string], font: string, effects: (J: PackJ) => PackEffect[]): MotionPack {
  const set = `vs${id}`;
  const own = (J: PackJ) => [...effects(J), ...(!effects(J).some(e => e.group === 'cam') ? [{ group: 'cam' as const, key: `vsFixed${id}`, def: { name: 'カメラ固定', get: () => ({ s: 1, x: 0, y: 0 }) } }] : [])]
    .map(e => ({ ...e, def: { ...(e.group === 'layout' ? { fits: (n: number) => n >= 1, w: 1, portrait: 1 } : {}), ...e.def, set, tags: [id] } }));
  return {
    id: `visualsync-${id}`, set, styleKey: `vs-${id.toLowerCase()}`, effects: own,
    buildStyle(J) {
      const st = JSON.parse(JSON.stringify(J.STYLES.noir)) as Record<string, unknown> & { name: string };
      st.name = `${name} (VisualSync)`; st.desc = desc;
      st.fonts = { display: [font], body: [font], serif: [font], mono: ['mono'] };
      st.schemes = [{ bg: '#080808', fg: colors[0], sub: colors[0], accent: colors[1], accent2: colors[2], ink: colors[0], dim: '#181818', ghostA: colors[1], ghostB: colors[2] }];
      st.texture = { grain: 0, paper: 0, scan: 0 }; st.ghost = 0; st.glow = 0; st.hud = false;
      const bias: Record<string, Record<string, number>> = {};
      for (const e of own(J)) (bias[e.group] ??= {})[e.key] = 10;
      st.bias = bias; st.decor = {};
      return st;
    },
    configure(project, J) {
      const keys = new Set(own(J).map(e => `${e.group}/${e.key}`));
      const enabled = (project.enabled ?? {}) as Record<string, Record<string, boolean>>;
      for (const group of J.GROUP_KEYS) {
        const values = { ...(enabled[group] ?? {}) };
        for (const key of J.order(group)) if (!keys.has(`${group}/${key}`)) values[key] = false;
        enabled[group] = values;
      }
      project.enabled = enabled;
      project.fx = { ...(project.fx as Record<string, unknown>), glitch: 0, chroma: 0, flash: false, hud: 'off', koma: 0, onTwos: false };
    },
  };
}

/** 大小の違いは短い言葉でも明確に。長文は折り返し、枠に合わせて縮小する。 */
function layout(J: PackJ, key: string, name: string, font: string, scale: number, paint?: (env: LayoutEnv, size: number) => void, offset = false): PackEffect {
  return { group: 'layout', key, def: { name,
    plan: (rng: Rng) => ({ font, side: rng.pick([-1, 1]) }),
    render(env: LayoutEnv) {
      const portrait = env.W < env.H;
      const cols = scale > 0.15 ? (portrait ? 4 : 7) : (portrait ? 10 : 22);
      const text = J.splitLines(clean(env.cut.text), cols);
      const size = Math.min(J.fitSize(text, font, env.W * 0.76, env.H * 0.5), Math.min(env.W, env.H) * scale);
      paint?.(env, size);
      return J.mainDraw(env, { text, font, size,
        x: env.W * (0.5 + (offset ? Number(env.cut.params.side) * 0.055 : 0)), y: env.H * 0.5,
        color: env.sc.fg, shadow: { color: '#000000', blur: size * 0.08, dy: size * 0.02 },
      });
    },
  } };
}

const slideIn = (key: string, name: string, vertical = false) => effect('enter', key, name, (env, it, p) => {
  const q = easeOut(clamp(p)), move = (1 - q) * it.size * 0.8 * strength(env);
  it.charFns.push(() => ({ dx: vertical ? 0 : -move, dy: vertical ? move : 0, a: q }));
});
const glideOut = (key: string, name: string) => effect('exit', key, name, (env, it, p) => {
  const q = easeInOut(clamp(p));
  it.charFns.push(() => ({ dx: q * it.size * 0.55 * strength(env), a: 1 - q }));
});
const drift = (key: string, name: string, amount: number) => effect('hold', key, name, (env, it, amt) => {
  const k = amt * strength(env);
  it.charFns.push(() => ({ dx: Math.sin(env.lt * 1.1) * it.size * amount * k, dy: Math.sin(env.lt * 0.8) * it.size * amount * 0.4 * k }));
});

export const smallFlowPack = themed('SmallFlow', '小さく流れる', '小さな文字がすっと滑り込み、ゆっくり移動する', ['#FFFFFF', '#FFFFFF', '#FFFFFF'], 'gothic_med', J => [
  layout(J, 'vsSmallFlowCenter', '小さな文字・中央', 'gothic_med', 0.065),
  layout(J, 'vsSmallFlowOffset', '小さな文字・左右に寄せる', 'gothic_med', 0.065, undefined, true),
  slideIn('vsSmallSlide', '小さな文字・横スライド'), slideIn('vsSmallRise', '小さな文字・浮き上がる', true),
  drift('vsSmallDrift', '小さな文字・ゆっくり流れる', 0.32),
  glideOut('vsSmallAway', '小さな文字・流れて消える'),
]);

export const bigTypePack = themed('BigType', '大きくシンプル', '大きな文字が主役。短いスライドと素直な拡大で動く', ['#FFFFFF', '#FFFFFF', '#FFFFFF'], 'gothic_black', J => [
  layout(J, 'vsBigCenter', '大きな文字・中央', 'gothic_black', 0.28),
  layout(J, 'vsBigOffset', '大きな文字・左右に寄せる', 'gothic_black', 0.28, undefined, true),
  slideIn('vsBigRise', '大きな文字・下からスライド', true),
  effect('enter', 'vsBigZoom', '大きな文字・素直に拡大', (env, it, p) => { const q = easeOut(clamp(p)); it.charFns.push(() => ({ s: 1 - (1 - q) * 0.22 * strength(env), a: q })); }),
  drift('vsBigDrift', '大きな文字・少しだけ移動', 0.025),
  glideOut('vsBigAway', '大きな文字・横に抜ける'),
]);

export const hyperPack = themed('Hyper', 'ハイパー・ビート', '大きな文字は固定し、拍ごとに光の角度と紫・ピンクの長い影が切り替わる', ['#FFFFFF', '#FF48C4', '#70F4FF'], 'dela', J => [
  ...artDirectedLayouts(J, 'Hyper').map((e, i) => ({ ...e, key: ['vsHyperHero', 'vsHyperOffset', e.key][i]! })),
  directedCamera('Hyper'), directedEnter('Hyper'),
  effect('enter', 'vsHyperPunch', 'ハイパー・叩き込むズーム', (env, it, p) => {
    const q = clamp(p), k = strength(env);
    it.charFns.push(() => ({ s: 1 + (1 - easeOutBack(q, 1.5)) * 0.8 * k, rot: (1 - easeOut(q)) * -12 * k, a: easeOut(q) }));
  }, 0.28),
  effect('enter', 'vsHyperSnap', 'ハイパー・文字が連続で飛び込む', (env, it, p) => {
    it.charFns.push((i, _g, n) => { const q = easeOut(staggered(clamp(p), i, n, 0.45)), k = strength(env); return { dy: (i % 2 ? -1 : 1) * (1 - q) * it.size * 1.5 * k, rot: (1 - q) * (i % 2 ? 18 : -18) * k, a: q }; });
  }, 0.32),
  effect('hold', 'vsHyperBeat', 'ハイパー・拍で拡大と切り返し', (env, it, amt) => {
    const b = beatOf(env), pulse = Math.exp(-b.since / Math.max(0.06, b.len * 0.2)), k = amt * strength(env);
    it.charFns.push(i => ({ s: 1 + pulse * 0.15 * k, rot: (b.index % 2 ? 1 : -1) * pulse * 4 * k, dy: -pulse * it.size * 0.06 * k,
      color: k > 0 ? ((i + b.index) % 3 === 0 ? env.sc.accent : (i + b.index) % 3 === 1 ? env.sc.accent2 ?? env.sc.fg : env.sc.fg) : undefined }));
  }),
  effect('exit', 'vsHyperBurst', 'ハイパー・外へ弾き飛ばす', (env, it, p) => { const q = clamp(p), k = strength(env); it.charFns.push((i, _g, n) => ({ dx: (i - (n - 1) / 2) * it.size * 0.3 * q * k, dy: (i % 2 ? 1 : -1) * it.size * q * k, rot: (i % 2 ? 1 : -1) * q * 22 * k, s: 1 + q * 0.2 * k, a: 1 - q })); }),
]);

export const summerPack = themed('Summer', '夏・波としぶき', '海色の文字が波打ち、しぶきのように弾ける。波紋と泡が流れる', ['#F2FDFF', '#58D9FF', '#9FFFD7'], 'gothic_bold', J => [
  ...artDirectedLayouts(J, 'Summer').map((e, i) => ({ ...e, key: i === 0 ? 'vsSummerSea' : e.key })),
  directedCamera('Summer'), directedEnter('Summer'),
  effect('enter', 'vsSummerSplash', '夏・しぶきが集まる', (env, it, p) => { it.charFns.push((i, _g, n) => { const q = easeOut(staggered(clamp(p), i, n, 0.4)), k = strength(env); return { dy: (1 - q) * it.size * (i % 2 ? -1.1 : 0.9) * k, dx: Math.sin(i * 2.3) * it.size * (1 - q) * k, s: 1 - (1 - q) * 0.35 * k, a: q }; }); }, 0.7),
  slideIn('vsSummerFlow', '夏・海風で流れ込む'),
  effect('hold', 'vsSummerWave', '夏・文字が波打つ', (env, it, amt) => { const k = amt * strength(env); it.charFns.push(i => ({ dy: Math.sin(env.lt * 2.3 - i * 0.6) * it.size * 0.13 * k, rot: Math.cos(env.lt * 2.3 - i * 0.6) * 3 * k })); }),
  effect('exit', 'vsSummerScatter', '夏・泡になって弾ける', (env, it, p) => { const q = easeInOut(clamp(p)), k = strength(env); it.charFns.push(i => ({ dx: Math.sin(i * 2.7) * it.size * q * k, dy: -it.size * q * (0.6 + i % 3 * 0.2) * k, s: 1 - q * 0.5 * k, a: 1 - q })); }),
]);

export const winterPack = themed('Winter', '冬・雪のことば', '静かに降る雪と結晶。文字が雪のように舞い降り、ほどける', ['#F7FCFF', '#C5E5FF', '#FFFFFF'], 'mincho', J => [
  ...artDirectedLayouts(J, 'Winter').map((e, i) => ({ ...e, key: i === 0 ? 'vsWinterSnow' : e.key })),
  directedCamera('Winter'), directedEnter('Winter'),
  effect('enter', 'vsWinterLand', '冬・雪のように舞い降りる', (env, it, p) => { it.charFns.push((i, _g, n) => { const q = easeInOut(staggered(clamp(p), i, n, 0.3)), k = strength(env); return { dy: -it.size * (1 - q) * 0.8 * k, dx: Math.sin(i * 1.9 + q * Math.PI) * it.size * (1 - q) * 0.25 * k, rot: (1 - q) * (i % 2 ? 7 : -7) * k, a: q }; }); }, 1.1),
  drift('vsWinterFloat', '冬・ゆっくり漂う', 0.07),
  effect('exit', 'vsWinterMelt', '冬・雪がほどける', (env, it, p) => { it.charFns.push((i, _g, n) => { const q = easeInOut(staggered(clamp(p), i, n, 0.25)), k = strength(env); return { dy: it.size * q * 0.6 * k, dx: Math.sin(i * 1.9) * q * it.size * 0.3 * k, a: 1 - q }; }); }),
]);

export const gothicPack = themed('Gothic', 'ゴシック・白黒の祈り', '太い白黒の明朝を光が読み進め、字間が静かに締まる', ['#FFFFFF', '#FFFFFF', '#FFFFFF'], 'tokumin', J => [
  ...artDirectedLayouts(J, 'Gothic').map((e, i) => ({ ...e, key: i === 0 ? 'vsGothicCross' : e.key })),
  directedCamera('Gothic'), directedEnter('Gothic'),
  effect('enter', 'vsGothicReveal', 'ゴシック・静かに浮かぶ', (env, it, p) => { const q = easeInOut(clamp(p)); it.charFns.push(() => ({ dy: (1 - q) * it.size * 0.12 * strength(env), a: q })); }, 0.9),
  drift('vsGothicBreath', 'ゴシック・微かな呼吸', 0.018),
  effect('exit', 'vsGothicVanish', 'ゴシック・余韻を残して消す', (env, it, p) => { const q = easeInOut(clamp(p)); it.charFns.push(() => ({ dy: -q * it.size * 0.12 * strength(env), a: 1 - q })); }),
]);

export const KINETIC_PACKS = [smallFlowPack, bigTypePack, hyperPack, summerPack, winterPack, gothicPack] as const;
