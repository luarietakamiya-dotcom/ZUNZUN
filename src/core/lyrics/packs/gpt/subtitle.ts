import type { MotionPack, PackEffect, PackJ, PackEnv, PackItem } from '../types';
import { clean, type LayoutEnv } from '../design-kit';
import { easeOut, easeInOut } from '../util';

const set = 'vsgSubtitle';
const cap = (v: number) => Math.max(0, Math.min(1, v));
const motion = (env: PackEnv) => cap(env.fx.motion ?? .7);
const modes = ['float', 'mist', 'slide', 'gather', 'reflow', 'wave'] as const;
type Mode = typeof modes[number];
interface KineticItem extends PackItem {
  subtitleMode?: Mode;
  subtitleOffsets?: { dx: number; dy: number }[];
}

function kineticLayout(J: PackJ, mode: Mode): PackEffect {
  const font = mode === 'float' || mode === 'mist' ? 'mincho_bold' : 'gothic_med';
  const names: Record<Mode, string> = { float: '一文字ずつ浮かぶ.g', mist: '霧から浮かぶ.g', slide: '横から滑り込む.g', gather: '左右から集まる.g', reflow: '一段から二段へ.g', wave: '文字が波打つ.g' };
  return { group: 'layout', key: `vsgSubtitle${mode}Layout`, def: {
    name: names[mode], fits: () => true, w: 1, portrait: 1, plan: () => ({ font }),
    render(env: LayoutEnv) {
      const { W, H, ctx } = env, text = clean(env.cut.text);
      if (!text) return null;
      const width = W * .8, max = Math.min(W, H) * .072;
      const lines = subtitleLines(text, mode === 'reflow' || J.fitSize([text], font, width, H * .12) < max * .7);
      let size = Math.min(max, H * .058, J.fitSize(lines, font, width, H * .12, { lead: 1.35 }));
      if (mode === 'reflow') size = Math.min(size, J.fitSize([text], font, width, H * .12));
      const offsets: { dx: number; dy: number }[] = [];
      if (mode === 'reflow') {
        const from = J.measure({ text, font, size }), to = J.measure({ text: lines.join('\n'), font, size, lead: 1.35 });
        let cursor = 0;
        for (const target of to.lay) {
          while (cursor < from.lay.length && from.lay[cursor]!.ch !== target.ch) cursor++;
          const origin = from.lay[cursor++] ?? target;
          offsets.push({ dx: origin.x - target.x, dy: origin.y - target.y });
        }
      }
      ctx.save(); ctx.beginPath(); ctx.rect(W * .06, H * .77, W * .88, H * .16); ctx.clip();
      try {
        return J.mainDraw({ ...env, cut: { ...env.cut, treat: 'vsgSubtitleGeometry' } }, { text: lines.join('\n'), font, size, x: W / 2, y: H * .849, lead: 1.35,
          color: env.sc.fg, shadow: { color: '#000000dd', blur: size * .15, dy: size * .045 },
          subtitleMode: mode, subtitleOffsets: offsets, enter: 'vsgSubtitleKineticIn', hold: 'vsgSubtitleKineticHold', exit: 'vsgSubtitleKineticOut' });
      } finally { ctx.restore(); }
    },
  } };
}

const kineticEffects: PackEffect[] = [
  { group: 'treat', key: 'vsgSubtitleGeometry', def: { name: '字幕帯・組版を組み替える.g',
    apply(env: PackEnv, raw: PackItem) {
      const item = raw as KineticItem;
      if (item.subtitleMode !== 'reflow') return;
      const k = motion(env), q = k === 0 ? 1 : easeInOut(cap((env.lt / Math.max(.1, env.cut.dur) - .28) / .36));
      item.charFns.push(i => ({ dx: (item.subtitleOffsets?.[i]?.dx ?? 0) * (1 - q) * k, dy: (item.subtitleOffsets?.[i]?.dy ?? 0) * (1 - q) * k }));
    } } },
  { group: 'enter', key: 'vsgSubtitleKineticIn', def: { name: '字幕帯・文字の登場.g', inDur: (dur: number) => Math.min(1.25, dur * .38),
    apply(env: PackEnv, raw: PackItem, p: number) {
      const item = raw as KineticItem, mode = item.subtitleMode ?? 'float', k = motion(env);
      item.charFns.push((i, _g, n) => {
        const fraction = i / Math.max(1, n - 1), stagger = mode === 'float' ? 2 : mode === 'mist' ? 1.5 : .35;
        const q = easeOut(cap(p * (1 + stagger) - fraction * stagger));
        return { a: q, dx: mode === 'slide' ? (1 - q) * item.size * -5 * k : mode === 'gather' ? (1 - q) * item.size * (fraction < .5 ? -4 : 4) * k : 0,
          dy: ['float', 'mist', 'wave'].includes(mode) ? (1 - q) * item.size * (mode === 'wave' ? -.65 : .75) * k : 0,
          blur: mode === 'mist' ? (1 - q) * item.size * .24 * k : 0 };
      });
    } } },
  { group: 'hold', key: 'vsgSubtitleKineticHold', def: { name: '字幕帯・組み替えと波.g',
    apply(env: PackEnv, raw: PackItem) {
      const item = raw as KineticItem, k = motion(env);
      item.charFns.push((i) => {
        return { dy: item.subtitleMode === 'wave' ? Math.sin(env.lt * 3.2 - i * .6) * item.size * .2 * k : 0 };
      });
    } } },
  { group: 'exit', key: 'vsgSubtitleKineticOut', def: { name: '字幕帯・ほどけて退場.g', outDur: (dur: number) => Math.min(.55, dur * .22),
    apply(env: PackEnv, raw: PackItem, p: number) {
      const item = raw as KineticItem, k = motion(env);
      item.charFns.push((i, _g, n) => {
        const q = easeInOut(cap(p * 1.45 - i / Math.max(1, n - 1) * .45));
        return { a: 1 - q, dx: item.subtitleMode === 'slide' ? q * item.size * 3 * k : 0,
          dy: item.subtitleMode === 'float' || item.subtitleMode === 'mist' ? -q * item.size * .5 * k : 0 };
      });
    } } },
];

/** エンジンが自動で作る曲名・間奏カードも、字幕帯の組版へ移す。 */
export function prepareSubtitlePlan(plan: { cuts: unknown[] }): void {
  for (const value of plan.cuts) {
    const cut = value as Record<string, unknown>;
    if (cut.layout !== 'title' && cut.layout !== 'interlude') continue;
    const params = cut.params as Record<string, unknown>;
    if (cut.layout === 'interlude') cut.text = params.showTitle ? params.titleText : '';
    Object.assign(cut, { layout: 'vsgSubtitleLayout0', params: { font: 'mincho_bold' },
      enter: 'vsgSubtitleIn', hold: 'vsgSubtitleHold', exit: 'vsgSubtitleOut',
      cam: 'vsgSubtitleCamera', camP: {}, decor: [], bg: 'none', trans: 'none', morph: null });
  }
}

/** 最大2行。文字を省略せず、長い場合はサイズを枠へ合わせる。 */
export function subtitleLines(text: string, two: boolean): string[] {
  const chars = [...clean(text)];
  if (!two || chars.length < 8) return [chars.join('')];
  const middle = Math.ceil(chars.length / 2);
  const candidates = chars.flatMap((c, i) => /[ 、。，,]/.test(c) && i > chars.length * .3 && i < chars.length * .7 ? [i + 1] : []);
  const at = candidates.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0] ?? middle;
  return [chars.slice(0, at).join('').trim(), chars.slice(at).join('').trim()];
}

function layout(J: PackJ, variant: number): PackEffect {
  const font = variant === 0 ? 'mincho_bold' : 'gothic_med';
  return { group: 'layout', key: `vsgSubtitleLayout${variant}`, def: {
    name: ['シネマ・下中央.g', 'ライン・左下.g', 'リレー・右下二段.g'][variant]!, fits: () => true, w: 1, portrait: 1,
    plan: () => ({ font }),
    render(env: LayoutEnv) {
      const { W, H, ctx } = env, text = clean(env.cut.text);
      if (!text) return null;
      const u = Math.min(W, H), width = W * .82;
      const max = Math.min(u * .062, H * .052);
      const needsTwo = variant === 2 || J.fitSize([text], font, width, H * .12) < max * .75;
      const lines = subtitleLines(text, needsTwo);
      const size = Math.min(max, J.fitSize(lines, font, width, H * .12, { lead: 1.4, track: .025 }));
      const measured = J.measure({ text: lines.join('\n'), font, size, lead: 1.4, track: .025 });
      const x = variant === 1 ? W * .09 + measured.w / 2 : variant === 2 ? W * .91 - measured.w / 2 : W / 2;
      const y = H * .847;
      ctx.save();
      // 移動・影・線も字幕の帯から外へ出さない。
      ctx.beginPath(); ctx.rect(W * .06, H * .77, W * .88, H * .16); ctx.clip();
      try {
        const box = J.mainDraw(env, { text: lines.join('\n'), font, size, x, y, lead: 1.4, track: .025,
          color: env.sc.fg,
          shadow: { color: '#000000dd', blur: size * .13, dy: size * .045 }, mi: 0 });
        const decor = cap(env.fx.decor ?? .5), visible = easeOut(cap(env.pIn)) * (1 - easeInOut(cap(env.pOut)));
        if (variant > 0 && decor > 0 && env.pass === 'main') {
          const start = variant === 1 ? W * .09 : W * .91 - measured.w;
          const length = Math.min(measured.w, W * .29), progress = motion(env) > 0 ? .3 + .7 * cap(env.lt / Math.max(.1, env.cut.dur)) : 1;
          const baseline = H * .897;
          env.line([[start, baseline], [start + length * progress, baseline]], env.sc.accent, Math.max(1, u * .002), visible * decor);
        }
        return box;
      } finally { ctx.restore(); }
    },
  } };
}

function effects(J: PackJ): PackEffect[] {
  return [...[0, 1, 2].map(v => { const effect = layout(J, v); return { ...effect, def: { ...effect.def, compatibility: true } }; }), ...modes.map(mode => kineticLayout(J, mode)), ...kineticEffects].concat([
    { group: 'enter', key: 'vsgSubtitleIn', def: { name: '字幕・言葉を送る.g', inDur: (dur: number) => Math.min(.42, dur * .28),
      apply(env: PackEnv, item: PackItem, p: number) {
        item.charFns.push((i, _g, n) => {
          const q = easeOut(cap(p * 1.16 - i / Math.max(1, n - 1) * .16));
          return { a: q, dy: (1 - q) * item.size * .22 * motion(env) };
        });
      } } },
    { group: 'hold', key: 'vsgSubtitleHold', def: { name: '字幕・静かな呼吸.g',
      apply(env: PackEnv, item: PackItem) { item.charFns.push(() => ({ dy: Math.sin(env.lt * 1.6) * item.size * .012 * motion(env) })); } } },
    { group: 'exit', key: 'vsgSubtitleOut', def: { name: '字幕・次の言葉へ.g', outDur: (dur: number) => Math.min(.28, dur * .2),
      apply(env: PackEnv, item: PackItem, p: number) { item.charFns.push(() => ({ a: 1 - easeInOut(cap(p)), dx: -cap(p) * item.size * .16 * motion(env) })); } } },
    { group: 'cam', key: 'vsgSubtitleCamera', def: { name: '字幕・視点固定.g', get: () => ({ s: 1, x: 0, y: 0, rot: 0 }) } },
  ]).map(e => ({ ...e, def: { ...e.def, set, tags: ['subtitle.g'] } }));
}

export const subtitlePack: MotionPack = {
  id: 'visualsync-subtitle.g', styleKey: 'vs-subtitle.g', set, effects,
  buildStyle(J) {
    const base = structuredClone(J.STYLES.noir!);
    const bias: Record<string, Record<string, number>> = {};
    for (const effect of effects(J)) (bias[effect.group] ??= {})[effect.key] = effect.def.compatibility || ['vsgSubtitleIn', 'vsgSubtitleHold', 'vsgSubtitleOut'].includes(effect.key) ? 0 : 10;
    return { ...base, name: 'MV・シネマ字幕.g', desc: '字幕帯で一文字ずつ浮かぶ・霧・横滑り・左右集合・一段から二段・波。中央の映像を残す',
      fonts: { display: ['mincho_bold', 'gothic_med'], body: ['gothic_med'], serif: ['mincho_bold'], mono: ['mono'] },
      schemes: [{ bg: '#05080C', fg: '#F5F1E9', sub: '#F5F1E9', accent: '#D8BA7E', accent2: '#D8BA7E', ink: '#F5F1E9', dim: '#05080C', ghostA: '#D8BA7E', ghostB: '#D8BA7E' }],
      bias, decor: {}, texture: { grain: 0, paper: 0, scan: 0 }, ghost: 0, glow: 0, hud: false };
  },
  configure(project, J) {
    const own = new Set(effects(J).map(e => `${e.group}/${e.key}`));
    const enabled = { ...(project.enabled as Record<string, Record<string, boolean>> ?? {}) };
    for (const group of J.GROUP_KEYS) {
      const values = { ...(enabled[group] ?? {}) };
      for (const key of J.order(group)) if (!own.has(`${group}/${key}`)) values[key] = false;
      enabled[group] = values;
    }
    project.enabled = enabled;
    project.fx = { ...(project.fx as Record<string, unknown>), glitch: 0, chroma: 0, flash: false, hud: 'off', koma: 0, onTwos: false };
  },
};
