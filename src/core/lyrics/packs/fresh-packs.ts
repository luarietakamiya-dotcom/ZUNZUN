import type { MotionPack, PackEffect, PackEnv, PackItem, PackJ } from './types';
import { clean, fontsOf, union, type LayoutEnv, type Rng } from './design-kit';
import { easeInOut, staggered } from './util';
import { artDirectedLayouts, directedCamera, directedEnter } from './art-directed-layouts';

/** 読むための字幕・端末・星図。背景は覆わず、文字の組み方から系統を変える。 */
const finiteProgress = (p: number) => Math.min(1, Math.max(0, p));
const quietCamera: PackEffect = { group: 'cam', key: 'vsFixedCamera', def: { name: 'カメラ固定', get: () => ({ s: 1, x: 0, y: 0 }) } };
const still: PackEffect = { group: 'hold', key: 'vsStillText', def: { name: '文字を静止', apply() {} } };
const fadeOut: PackEffect = { group: 'exit', key: 'vsCleanOut', def: {
  name: '静かに消す', outDur: (dur: number) => Math.min(0.3, dur * 0.2),
  apply(_env: PackEnv, it: PackItem, p: number) { it.alpha = (it.alpha ?? 1) * (1 - easeInOut(finiteProgress(p))); },
} };

function pack(id: string, name: string, desc: string, color: string, effects: (J: PackJ) => PackEffect[]): MotionPack {
  const set = `vs${id}`;
  const own = (J: PackJ) => [...effects(J), ...(id === 'Terminal' || id === 'Constellation' ? [...artDirectedLayouts(J, id), directedCamera(id), directedEnter(id)] : []), ...[quietCamera, still, fadeOut].map(e => ({ ...e, key: `${e.key}${id}` }))].map(e => ({ ...e, def: { ...(e.group === 'layout' ? { fits: (n: number) => n >= 1, w: 1, portrait: 1 } : {}), ...e.def, set, tags: ['calm', 'editorial'] } }));
  return {
    id: `visualsync-${id}`, set, styleKey: `vs-${id.toLowerCase()}`,
    effects: own,
    buildStyle(J) {
      const st = JSON.parse(JSON.stringify(J.STYLES.noir)) as Record<string, unknown> & { name: string };
      st.name = `${name} (VisualSync)`; st.desc = desc;
      st.fonts = { display: ['gothic_med'], body: ['gothic_med'], serif: ['mincho_light'], mono: ['mono'] };
      st.schemes = [{ bg: '#070b14', fg: '#F5F8FF', sub: '#A8B8CB', accent: color, accent2: color, ink: '#F5F8FF', dim: '#122030', ghostA: color, ghostB: color }];
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
      project.fx = { ...(project.fx as Record<string, unknown>), glitch: 0, chroma: 0, flash: false, ...(id === 'Simple' ? { decor: 0 } : {}), hud: 'off', koma: 0, onTwos: false };
    },
  };
}

function simpleLayout(J: PackJ, key: string, name: string, y: number): PackEffect {
  return { group: 'layout', key, def: { name,
    plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['body'])) }),
    render(env: LayoutEnv) {
      const font = String(env.cut.params.font);
      const text = J.splitLines(clean(env.cut.text), env.W < env.H ? 10 : 24);
      const size = Math.min(J.fitSize(text, font, env.W * 0.82, env.H * 0.22), Math.min(env.W, env.H) * 0.075);
      return J.mainDraw(env, { text, font, size, x: env.W / 2, y: env.H * y, color: env.sc.fg, shadow: { color: '#000000', blur: size * 0.1, dy: size * 0.03 } });
    },
  } };
}

export const simplePack = pack('Simple', 'シンプル', '読みやすい中央・字幕。文字は静止し、短いフェードだけで出入りする', '#B4D7FF', J => [
  simpleLayout(J, 'vsPlainCenter', 'シンプル・中央', 0.5),
  simpleLayout(J, 'vsPlainSubtitle', 'シンプル・下部字幕', 0.8),
  { group: 'enter', key: 'vsCleanIn', def: { name: '静かに表示', inDur: (dur: number) => Math.min(0.3, dur * 0.2),
    apply(_env: PackEnv, it: PackItem, p: number) { it.alpha = (it.alpha ?? 1) * easeInOut(finiteProgress(p)); },
  } },
]);

export const terminalPack = pack('Terminal', '端末', '左寄せのコンソール。文字を打ち込み、細いカーソルが進む', '#70E6AC', J => [
  { group: 'layout', key: 'vsConsole', def: { name: 'コンソール入力', plan: () => ({ font: 'mono' }),
    render(env: LayoutEnv) {
      const font = String(env.cut.params.font);
      const text = J.splitLines(clean(env.cut.text), env.W < env.H ? 9 : 25);
      const size = Math.min(J.fitSize(text, font, env.W * 0.72, env.H * 0.32), Math.min(env.W, env.H) * 0.065);
      const measured = J.measure({ text, font, size });
      const x = env.W * 0.16 + measured.w / 2;
      const bb = J.mainDraw(env, { text, font, size, x, y: env.H * 0.5, color: env.sc.accent });
      if (env.pass === 'main' && bb) {
        const alpha = easeInOut(finiteProgress(env.pIn)) * (1 - finiteProgress(env.pOut));
        env.line([[env.W * 0.1, bb.y0], [env.W * 0.12, (bb.y0 + bb.y1) / 2], [env.W * 0.1, bb.y1]], env.sc.accent, Math.max(1, size * 0.04), alpha);
        const count = measured.lay.length;
        const k = Math.min(count - 1, Math.max(0, Math.floor(finiteProgress(env.pIn) * count)));
        const ch = measured.lay[k];
        if (ch) {
          const cx = x + ch.x + ch.w / 2 + size * 0.12;
          const cy = env.H * 0.5 + ch.y;
          env.line([[cx, cy - size * 0.45], [cx, cy + size * 0.45]], env.sc.accent, Math.max(1, size * 0.06), alpha);
        }
      }
      return bb;
    },
  } },
  { group: 'enter', key: 'vsConsoleType', def: { name: '端末・一文字ずつ入力', inDur: (dur: number) => Math.min(1.4, dur * 0.5),
    apply(_env: PackEnv, it: PackItem, p: number) { it.charFns.push((i, _g, n) => ({ hide: i >= Math.ceil(finiteProgress(p) * n) })); },
  } },
  { group: 'exit', key: 'vsConsoleErase', def: { name: '端末・後ろから削除', outDur: (dur: number) => Math.min(0.6, dur * 0.25),
    apply(_env: PackEnv, it: PackItem, p: number) { it.charFns.push((i, _g, n) => ({ hide: i >= Math.ceil((1 - finiteProgress(p)) * n) })); },
  } },
]);

export const constellationPack = pack('Constellation', '星図', '文字を星座のような点と線でつなぐ。ゆっくり星が集まって言葉になる', '#BEB3FF', J => [
  { group: 'layout', key: 'vsStarPath', def: { name: '星座の文字列', plan: (rng: Rng, _cut: unknown, st: LayoutEnv['st']) => ({ font: rng.pick(fontsOf(st, ['body'])), bend: rng.range(-1, 1) }),
    render(env: LayoutEnv) {
      const chars = [...clean(env.cut.text)].filter(ch => ch.trim());
      if (!chars.length) return null;
      const font = String(env.cut.params.font);
      const cols = Math.min(chars.length, env.W < env.H ? 7 : 14);
      const rows = Math.ceil(chars.length / cols);
      const size = Math.min(env.W * 0.72 / cols * 0.65, env.H * 0.55 / rows * 0.55, Math.min(env.W, env.H) * 0.075);
      let bb = null;
      const pts: [number, number][] = [];
      for (let i = 0; i < chars.length; i++) {
        const col = i % cols, row = Math.floor(i / cols);
        const rowCount = Math.min(cols, chars.length - row * cols);
        const x = env.W / 2 + (col - (rowCount - 1) / 2) * (env.W * 0.72 / cols);
        const y = env.H / 2 + (row - (rows - 1) / 2) * size * 2.7 + Math.sin(col * 0.65) * size * Number(env.cut.params.bend);
        const q = easeInOut(staggered(finiteProgress(env.pIn), i, chars.length, 0.65)) * (1 - finiteProgress(env.pOut));
        pts.push([x, y + size * 0.8]);
        bb = union(bb, J.mainDraw(env, { text: chars[i], font, size, x, y, alpha: q, color: env.sc.fg }));
        if (env.pass === 'main') env.circle(x, y + size * 0.8, size * 0.055, env.sc.accent, null, 1, q);
        if (env.pass === 'main' && col > 0) env.line([pts[i - 1]!, pts[i]!], env.sc.accent, Math.max(0.8, size * 0.02), q * 0.35);
      }
      return bb;
    },
  } },
  { group: 'enter', key: 'vsStarGather', def: { name: '星が言葉に集まる', inDur: (dur: number) => Math.min(1.2, dur * 0.45),
    apply(env: PackEnv, it: PackItem, p: number) { const q = easeInOut(finiteProgress(p)); const motion = env.fx.motion ?? 0.7;
      it.charFns.push(i => ({ dx: Math.sin(i * 2.4) * it.size * (1 - q) * motion, dy: Math.cos(i * 1.7) * it.size * (1 - q) * motion, a: q }));
    },
  } },
]);
