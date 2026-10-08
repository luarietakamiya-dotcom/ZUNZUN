import type { MotionPack, PackEffect, PackJ, PackEnv, PackItem, CharMod } from '../types';
import { clean } from '../design-kit';
import type { LayoutEnv } from '../design-kit';
import type { Section } from '../../sections';
import { easeOut, easeInOut } from '../util';
import { subtitlePack, subtitleLines } from './subtitle';

const set = 'vsgMoonFeather', FONT = 'brush';
const cap = (n: number) => Math.max(0, Math.min(1, n));
const kanji = (c: string) => /[\p{Script=Han}]/u.test(c);
const kOf = (env: PackEnv) => cap(env.fx.motion ?? .7);
type MoonItem = PackItem & { moonChars?: string[]; moonDirections?: number[] };
export const moonPhase = (kind: Section['kind']): number => kind === 'chorus' ? 1 : kind === 'intro' || kind === 'outro' ? .18 : kind === 'prechorus' ? .78 : kind === 'bridge' ? .3 : .52;

/** 前の字の挿入時間の1/3後に、次の字を入れ始める。 */
export function insertionClock(lt: number, index: number, count: number, duration: number): { progress: number; landedAt: number } {
  const gap = Math.max(.01, duration / (count + 2));
  return { progress: cap((lt - index * gap) / (gap * 3)), landedAt: (index + 3) * gap };
}

export function insertionMod(q: number, direction: number, size: number, large: boolean, strength: number, glyphHeight = size): CharMod {
  const scale = large ? 1.16 : 1, dy = direction * size * 1.55 * (1 - easeOut(q)) * (strength > 0 ? .55 + .45 * strength : 0);
  const local = dy / (glyphHeight * scale);
  // マスクは定位置に置いたまま。近づいてきた字の一部から見える。
  return { dy, s: scale, a: cap(q * 1.8), ...(q < 1 && strength > 0 ? { clipY: [-.6 - local, .6 - local] as [number, number] } : {}) };
}

/** 英字は上、漢字は下。かなは直前の語の方向を引き継ぎ、空白で交代。 */
export function insertionDirections(chars: string[]): number[] {
  let direction = -1;
  return chars.map(ch => { if (/\s/.test(ch)) direction *= -1; else if (/[A-Za-z0-9]/.test(ch)) direction = -1; else if (kanji(ch)) direction = 1; return direction; });
}

export function prepareMoonPlan(plan: { cuts: unknown[] }, sections: readonly Section[], starts: readonly number[]): void {
  for (const value of plan.cuts) {
    const cut = value as Record<string, unknown>, line = Number(cut.line);
    const at = starts[line] ?? Number(cut.start), section = sections.find(s => at >= s.start && at < s.end);
    cut.params = { ...(cut.params as Record<string, unknown>), moonPhase: moonPhase(line < 0 ? 'intro' : section?.kind ?? 'other') };
    if (cut.layout === 'title' || cut.layout === 'interlude') {
      const params = cut.params as Record<string, unknown>;
      if (cut.layout === 'interlude') cut.text = params.showTitle ? params.titleText : '';
      Object.assign(cut, { layout: 'vsgMoonFeatherLayout', enter: 'vsgMoonFeatherIn', hold: 'vsgMoonFeatherHold', exit: 'vsgMoonFeatherOut',
        cam: 'vsgMoonFeatherCamera', camP: {}, decor: [], bg: 'none', trans: 'none', morph: null });
    }
  }
}

function feather(g: CanvasRenderingContext2D, x: number, y: number, length: number, rotation: number, alpha: number): void {
  g.save(); g.translate(x, y); g.rotate(rotation); g.globalAlpha *= alpha;
  g.fillStyle = '#F7EDD7'; g.beginPath(); g.moveTo(0, -length / 2);
  g.bezierCurveTo(length * .34, -length * .25, length * .22, length * .22, 0, length / 2);
  g.bezierCurveTo(-length * .22, length * .12, -length * .19, -length * .28, 0, -length / 2); g.fill();
  g.strokeStyle = '#BFA56C'; g.lineWidth = Math.max(.5, length * .025); g.beginPath(); g.moveTo(0, -length * .43); g.lineTo(0, length * .63);
  for (let i = 0; i < 5; i++) { const yy = length * (-.28 + i * .12); g.moveTo(0, yy + length * .12); g.lineTo(length * .16, yy); }
  g.stroke(); g.restore();
}

function lunar(g: CanvasRenderingContext2D, x: number, y: number, r: number, phase: number, alpha: number): void {
  g.save(); g.globalAlpha *= alpha; g.fillStyle = '#E9CF8C';
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  if (phase < .99) {
    const cx = x + r * (phase < .5 ? phase * 2 : .9), cr = r * (phase < .5 ? 1 : 2 - phase * 2);
    g.moveTo(cx + cr, y); g.arc(cx, y, cr, 0, Math.PI * 2, true);
  }
  g.fill('evenodd');
  // クレーターは月の形の中だけへ。三日月には重ねない。
  if (phase > .99) { g.fillStyle = '#A88F58'; for (const [dx, dy, rr] of [[-.3, -.15, .16], [.3, .25, .2], [-.1, .4, .1]]) { g.beginPath(); g.arc(x + r * dx!, y + r * dy!, r * rr!, 0, Math.PI * 2); g.fill(); } }
  g.restore();
}

function effects(J: PackJ): PackEffect[] {
  return [
    { group: 'layout', key: 'vsgMoonFeatherLayout', def: { name: '月と羽根・上下の挿入.g', fits: () => true, w: 1, portrait: 1, plan: () => ({ font: FONT }),
      render(env: LayoutEnv) {
        const { W, H, ctx } = env, text = clean(env.cut.text); if (!text) return null;
        const width = W * .79, max = Math.min(Math.min(W, H) * .069, H * .052);
        const lines = subtitleLines(text, J.fitSize([text], FONT, width, H * .1) < max * .75);
        const display = lines.join('\n'), chars = [...display.replace(/\n/g, '')];
        const size = Math.min(max, J.fitSize(lines, FONT, width, H * .095, { track: .08, lead: 1.4 })) / 1.16;
        const measured = J.measure({ text: display, font: FONT, size, track: .08, lead: 1.4 });
        const x = W / 2, y = H * .849, k = kOf(env), decor = cap(env.fx.decor ?? .5);
        const shown = easeOut(cap(env.pIn)) * (1 - easeInOut(cap(env.pOut)));
        const duration = Math.max(.01, env.cut.inDur), phase = Number(env.cut.params.moonPhase ?? .52);
        ctx.save(); ctx.beginPath(); ctx.rect(W * .06, H * .77, W * .88, H * .16); ctx.clip();
        try {
          if (env.pass === 'main' && decor > 0) {
            const progress = k > 0 ? cap(env.lt / Math.max(.1, env.cut.dur)) : .5;
            lunar(ctx, W * (.09 + .82 * progress), H * .845, H * .062, phase, cap(decor * 1.6) * shown * .7);
          }
          const box = J.mainDraw(env, { text: display, font: FONT, size, x, y, track: .08, lead: 1.4, color: '#FFF5DF',
            shadow: { color: '#000000dd', blur: size * .14, dy: size * .05 }, moonChars: chars, moonDirections: insertionDirections(chars) });
          if (env.pass === 'main' && decor > 0) measured.lay.forEach((glyph, i) => {
            if (/\s/.test(glyph.ch)) return;
            const age = env.lt - insertionClock(env.lt, i, measured.lay.length, duration).landedAt;
            if (age < 0 || age > 1.8) return;
            for (let j = 0; j < 2; j++) {
              const random = J.r(env.cut.seed ?? 1, i, j, 37), side = j ? 1 : -1;
              const px = x + glyph.x + side * size * (age * .9 + Math.sin(age * 3 + random * 6) * age * .4) * k;
              const py = y + glyph.y + size * (-age * .6 + age * age * .28) * k;
              feather(ctx, px, py, size * (.5 + random * .4), side * (.35 + age * 1.7) * k,
                decor * shown * Math.sin(Math.PI * age / 1.8) * .95);
            }
          });
          return box;
        } finally { ctx.restore(); }
      } } },
    { group: 'enter', key: 'vsgMoonFeatherIn', def: { name: '月と羽根・時間差の上下挿入.g', inDur: (dur: number) => Math.min(1.8, dur * .43),
      apply(env: PackEnv, raw: PackItem) {
        const item = raw as MoonItem;
        item.charFns.push((i, glyph, n) => insertionMod(insertionClock(env.lt, i, n, env.cut.inDur).progress, item.moonDirections?.[i] ?? (i % 2 ? 1 : -1), item.size, kanji(item.moonChars?.[i] ?? ''), kOf(env), (glyph as { h?: number }).h ?? item.size));
      } } },
    { group: 'hold', key: 'vsgMoonFeatherHold', def: { name: '月と羽根・漢字の大小.g', apply(env: PackEnv, raw: PackItem) {
      const item = raw as MoonItem; item.charFns.push(i => ({ s: env.lt >= env.cut.inDur && kanji(item.moonChars?.[i] ?? '') ? 1.16 : 1 }));
    } } },
    { group: 'exit', key: 'vsgMoonFeatherOut', def: { name: '月と羽根・消える.g', outDur: (dur: number) => Math.min(.6, dur * .23),
      apply(_env: PackEnv, item: PackItem, p: number) { item.charFns.push(() => ({ a: 1 - easeInOut(cap(p)) })); } } },
    { group: 'cam', key: 'vsgMoonFeatherCamera', def: { name: '月と羽根・視点固定.g', get: () => ({ s: 1, x: 0, y: 0, rot: 0 }) } },
  ].map(e => ({ ...e, def: { ...e.def, set, tags: ['moonfeather.g'] } })) as PackEffect[];
}

export const moonFeatherPack: MotionPack = {
  id: 'visualsync-moonfeather.g', styleKey: 'vs-moonfeather.g', set, effects,
  buildStyle(J) {
    const base = subtitlePack.buildStyle(J), bias: Record<string, Record<string, number>> = {};
    for (const e of effects(J)) (bias[e.group] ??= {})[e.key] = 10;
    return { ...base, name: '月と羽根・字幕.g', desc: '時間差で上下から挿入し、定位置の近づいた部分から現れる。着地から羽根、背面を流れる月',
      fonts: { display: [FONT], body: [FONT], serif: [FONT], mono: ['mono'] }, bias };
  },
  configure(project, J) {
    const own = new Set(effects(J).map(e => `${e.group}/${e.key}`)), enabled = { ...(project.enabled as Record<string, Record<string, boolean>> ?? {}) };
    for (const group of J.GROUP_KEYS) { const values = { ...(enabled[group] ?? {}) }; for (const key of J.order(group)) if (!own.has(`${group}/${key}`)) values[key] = false; enabled[group] = values; }
    project.enabled = enabled;
    project.fx = { ...(project.fx as Record<string, unknown>), glitch: 0, chroma: 0, flash: false, hud: 'off', koma: 0, onTwos: false };
  },
};
