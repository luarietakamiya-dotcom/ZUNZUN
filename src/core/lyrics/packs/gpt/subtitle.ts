import type { MotionPack, PackEffect, PackJ, PackEnv, PackItem } from '../types';
import { clean, type LayoutEnv } from '../design-kit';
import { easeOut, easeInOut } from '../util';

const set = 'vsgSubtitle';
const cap = (v: number) => Math.max(0, Math.min(1, v));
const motion = (env: PackEnv) => cap(env.fx.motion ?? .7);

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
  return [0, 1, 2].map(v => layout(J, v)).concat([
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
    for (const effect of effects(J)) (bias[effect.group] ??= {})[effect.key] = 10;
    return { ...base, name: 'MV・シネマ字幕.g', desc: '画面下の字幕帯だけで動く。中央・左下・右下二段。映像の主役と余白を残す',
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
