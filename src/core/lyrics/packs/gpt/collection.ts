import { hyperPack } from '../kinetic-packs';
import type { MotionPack, PackEffect, PackJ, PackEnv, PackItem, PackBox } from '../types';
import { clean, piecesOf, wordsOf, mergeWords, union, type LayoutEnv } from '../design-kit';
import { easeOut, easeInOut, beatOf, flashAllowed } from '../util';

type Theme = 'Hyper' | 'Echo' | 'Rush' | 'Rose' | 'Signal' | 'Afterglow';
const cap = (x: number) => Math.max(0, Math.min(1, x));
const names: Record<Theme, string> = { Hyper: 'ハイパー・ビート', Echo: 'エコー', Rush: 'ラッシュ', Rose: 'ダークローズ', Signal: 'シグナル', Afterglow: 'アフターグロウ' };
const colors: Record<Theme, [string, string, string, string]> = {
  Hyper: ['#08090D', '#FFFFFF', '#FF48C4', '#70F4FF'], Echo: ['#060D13', '#FFFFFF', '#57DFED', '#799EA8'],
  Rush: ['#F3EDE0', '#171713', '#D1202D', '#4C4941'], Rose: ['#13070E', '#F8EBDD', '#C84760', '#CB9398'],
  Signal: ['#071525', '#E9F0E8', '#BDFA45', '#5D8395'], Afterglow: ['#F3EFE6', '#282B30', '#2754B5', '#787C84'],
};
const fontOf = (theme: Theme) => ['Rose', 'Afterglow'].includes(theme) ? 'mincho' : theme === 'Signal' ? 'gothic_med' : 'dela';
const motionOf = (env: PackEnv) => cap(env.fx.motion ?? 0.7);

/** 各テーマは自分の登録先を持つ。共有するのは描画の道具だけ。 */
function makePack(theme: Theme): MotionPack {
  const set = `vsg${theme}`, font = fontOf(theme);
  const effects = (J: PackJ): PackEffect[] => {
    const layouts = [0, 1, 2].map(v => ({ group: 'layout' as const,
      key: theme === 'Hyper' ? ['vsgHyperHero', 'vsgHyperOffset', 'vsgArtHyper2'][v]! : `vsg${theme}Layout${v}`,
      def: { name: `${names[theme]}・${['焦点', '余白', '流れ'][v]}`, fits: (n: number) => n >= 1, w: 2, portrait: 1,
        plan: (rng: { pick<T>(a: T[]): T }) => ({ font, side: rng.pick([-1, 1]), variant: v }),
        render: (env: LayoutEnv) => render(J, env, theme, v),
      },
    }));
    const animate = (group: 'enter' | 'hold' | 'exit'): PackEffect => ({ group, key: `vsg${theme}${group}`,
      def: { name: `${names[theme]}・${{ enter: '現れる', hold: '息づく', exit: '余韻' }[group]}`,
        ...(group === 'enter' ? { inDur: (dur: number) => Math.min(theme === 'Rose' ? .65 : .4, dur * .35) } : group === 'exit' ? { outDur: (dur: number) => Math.min(.45, dur * .3) } : {}),
        apply: (env: PackEnv, it: PackItem, p: number) => {
          const k = motionOf(env), q = cap(p), energetic = ['Hyper', 'Rush'].includes(theme), b = beatOf(env);
          const pulse = flashAllowed(b.index, b.len) ? Math.exp(-b.since * 10) : 0;
          it.charFns.push((i, _g, n) => {
            if (group === 'enter') {
              const u = easeOut(cap(q * 1.2 - (n > 1 ? i / (n - 1) : 0) * .2));
              return { a: u, dx: theme === 'Signal' ? -(1 - u) * it.size * .3 * k : 0,
                dy: (1 - u) * it.size * (energetic ? .7 : .18) * k,
                rot: theme === 'Rush' ? -5 * (1 - u) * k : 0, s: 1 + (energetic ? .12 : 0) * (1 - u) * k };
            }
            if (group === 'exit') return { a: 1 - easeInOut(q), dx: theme === 'Rush' ? q * it.size * .55 * k : 0,
              dy: ['Rose', 'Afterglow'].includes(theme) ? -q * it.size * .12 * k : 0 };
            return { s: energetic ? 1 + pulse * .045 * k * cap(p) : 1,
              dy: ['Rose', 'Afterglow', 'Echo'].includes(theme) ? Math.sin(env.lt * .9) * it.size * .015 * k * cap(p) : 0 };
          });
        },
      },
    });
    const base: PackEffect[] = [...layouts, animate('enter'), animate('hold'), animate('exit'), {
      group: 'cam' as const, key: `vsg${theme}Camera`, def: { name: `${names[theme]}・視点`, get: (env: PackEnv) => {
        const k = motionOf(env), b = beatOf(env), pulse = flashAllowed(b.index, b.len) ? Math.exp(-b.since * 10) : 0;
        return { s: 1 + (theme === 'Hyper' ? .009 * pulse * k : 0), x: 0, y: 0, rot: 0 };
      } },
    }];
    if (theme === 'Hyper') {
      const keys = new Set(base.map(e => e.key));
      for (const e of hyperPack.effects(J)) {
        const key = `vsg${e.key.slice(2)}`;
        if (!keys.has(key)) base.push({ ...e, key, def: { ...e.def, compatibility: true } });
      }
    }
    return base.map(e => ({ ...e, def: { ...e.def, set, tags: [`${theme}.g`] } }));
  };
  return { id: `visualsync-${theme}.g`, styleKey: `vs-${theme.toLowerCase()}.g`, set, effects,
    buildStyle(J) {
      const st = JSON.parse(JSON.stringify(J.STYLES.noir)) as Record<string, unknown> & { name: string };
      const [bg, fg, accent, accent2] = colors[theme];
      const bias: Record<string, Record<string, number>> = {};
      for (const e of effects(J)) (bias[e.group] ??= {})[e.key] = e.def.compatibility ? 0 : 10;
      return { ...st, name: `${names[theme]}.g`, desc: '承認したサムネイルを基に、大小・余白・肌を独立して設計',
        fonts: { display: [font], body: [font], serif: [font], mono: ['mono'] },
        schemes: [{ bg, fg, sub: fg, accent, accent2, ink: fg, dim: bg, ghostA: accent, ghostB: accent2 }],
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
}

function render(J: PackJ, env: LayoutEnv, theme: Theme, variant: number): PackBox | null {
  const { W, H, sc } = env, u = Math.min(W, H), portrait = W < H, font = fontOf(theme);
  const text = clean(env.cut.text); if (!text) return null;
  if (theme === 'Hyper' && env.cut.params.artText) {
    const legacy = hyperPack.effects(J).filter(e => e.group === 'layout')[variant]!;
    return (legacy.def.render as (e: LayoutEnv) => PackBox | null)(env);
  }
  // 紙の2作品は暗い映像の上でも読めるよう、本文の土台として紙色を保つ。
  // 装飾0でも本文と土台は残り、飛沫・罫線・背景文字は消える。
  if (env.pass === 'main' && (theme === 'Rush' || theme === 'Afterglow')) env.rect(0, 0, W, H, sc.bg, 1);
  const k = motionOf(env), decor = cap((env.fx.decor ?? .5) * (['Rose', 'Signal', 'Afterglow'].includes(theme) ? 1.8 : 1)), side = Number(env.cut.params.side ?? 1);
  const visible = easeOut(cap(env.pIn)) * (1 - easeOut(cap(env.pOut)));
  const parts = theme === 'Hyper' || theme === 'Rush' ? mergeWords(wordsOf(env.cut), theme === 'Rush' ? 2 : 3) : piecesOf(env.cut, 3);
  let box: PackBox | null = null;
  const word = (s: string, x: number, y: number, width: number, height: number, max: number, options: Record<string, unknown> = {}, ghost = false) => {
    const one = J.fitSize([s], font, width, height);
    const lines = one >= max * .55 ? [s] : J.splitLines(s, Math.max(2, Math.ceil([...s].length / 2)));
    const item = { text: Array.isArray(lines) ? lines.join('\n') : lines, font,
      size: Math.min(max, J.fitSize(lines, font, width, height)), x: W * x, y: H * y, color: sc.fg, ...options };
    if (ghost) { if (env.pass === 'main' && decor > 0) env.draw({ ...item, alpha: Number(options.alpha ?? .18) * decor * visible }); }
    else box = union(box, J.mainDraw(env, item));
  };
  const line = (points: [number, number][], color = sc.accent, alpha = .6, width = .0015) => {
    if (env.pass === 'main' && decor > 0) env.line(points.map(([x, y]) => [x * W, y * H]), color, u * width, alpha * decor * visible);
  };
  // 質感は時刻によらないseed由来。再生や書き出しで肌がちらつかない。
  if (env.pass === 'main' && decor > 0) {
    const seed = env.cut.line ?? 0;
    for (let i = 0; i < (theme === 'Hyper' || theme === 'Rush' ? 170 : 90); i++) {
      const x = J.r(seed, i, 17), y = J.r(seed, i, 31);
      const edge = y < .23 || y > .77;
      if (!edge && theme !== 'Afterglow') continue;
      const accent = i % 2 ? sc.accent : sc.accent2 ?? sc.accent;
      env.circle(x * W, y * H, u * (.0009 + J.r(seed, i, 43) * (theme === 'Hyper' ? .006 : .002)), accent, null, 0, decor * visible * (theme === 'Afterglow' ? .12 : .3));
    }
  }
  // 飛沫と筆跡の方向を揃え、単なる点の散布よりも画面の勢いを作る。
  if (theme === 'Hyper' || theme === 'Rush') for (let i = 0; i < 40; i++) {
    const top = i < 20, base = top ? .12 : .87, x = J.r(env.cut.line ?? 0, i, 71) * .23;
    const start = top ? x : 1 - x;
    const length = .06 + J.r(env.cut.line ?? 0, i, 75) * .2;
    const y = base + (J.r(env.cut.line ?? 0, i, 79) - .5) * .14;
    line([[start, y], [start + (top ? length : -length), y - length * .23]],
      theme === 'Rush' ? sc.fg : top ? sc.accent : sc.accent2 ?? sc.accent, .55, .0008 + J.r(i, 89) * .004);
  }
  if (theme === 'Hyper') {
    const hero = Math.floor(parts.length / 2);
    parts.forEach((p, i) => word(p, portrait || variant === 1 ? .5 + (i - hero) * .04 : .5 + (i - hero) * .25, portrait || variant === 1 ? .5 + (i - hero) * .19 : .5 + (i - hero) * (variant === 2 ? -.12 : .08),
      W * (parts.length === 1 ? .84 : portrait ? .8 : i === hero ? .46 : .23), H * .28, u * (i === hero ? .26 : .09), { rot: -4 * side, color: i === hero ? sc.fg : sc.accent, mi: i }));
    line([[.05, .19], [.3 + .04 * Math.sin(env.lt * 2) * k, .19]], sc.accent, .8, .006);
    line([[.7, .82], [.95, .82]], sc.accent2 ?? sc.accent, .8, .006);
  } else if (theme === 'Echo') {
    for (const i of [-2, -1, 1, 2]) word(text, .5 + i * .018 * side, .5 + i * .14, W * .72, H * .11, u * .15,
      { fill: false, stroke: u * .0012, color: sc.accent, rot: -4, alpha: .8 }, true);
    word(text, variant === 1 ? .46 : .5, .5, W * .8, H * .24, u * .21, { rot: -4 });
    line([[.04, .17], [.18, .09], [.3, .13]], sc.accent, .5);
    line([[.72, .88], [.85, .91], [.96, .81]], sc.accent, .5);
  } else if (theme === 'Rush') {
    const gap = portrait ? .24 : .13;
    parts.forEach((p, i) => word(p, parts.length === 1 ? .5 : portrait ? .48 + i * .04 : .32 + i * .3, parts.length === 1 ? .5 : .5 + (i - .5) * -gap,
      W * (parts.length === 1 ? .82 : portrait ? .75 : .5), H * .26, u * (parts.length === 1 || i > 0 ? .25 : .13), { rot: -9, color: i ? sc.accent : sc.fg, mi: i }));
    line([[.03, .82], [.97, .57]], sc.accent, .8, .014);
    line([[.03, .86], [.97, .61]], sc.fg, .9, .025);
    line([[.05, .3], [.94, .06]], sc.accent, .8);
  } else if (theme === 'Rose') {
    word(text, variant === 1 ? .43 : .5, variant === 2 ? .59 : .5, W * .82, H * .36, u * .20);
    // 手描きの棘と花弁。本文と重ならない上下の帯にのみ置く。
    for (const baseline of [.14, .85]) {
      const points: [number, number][] = Array.from({ length: 27 }, (_, i) => [i / 26, baseline + .055 * Math.sin(i * .35 + env.lt * .15 * k)]);
      line(points, sc.accent, 1, .004);
      for (let i = 3; i < 25; i += 3) { const [x, y] = points[i]!; line([[x - .018, y], [x, y - .03], [x + .01, y + .007]], sc.accent, .8); }
    }
    if (env.pass === 'main' && decor > 0) for (let j = 0; j < 5; j++) {
      const points: [number, number][] = Array.from({ length: 50 }, (_, i) => {
        const t = i / 49 * Math.PI * 2, radius = u * (.033 + .013 * Math.cos(5 * t + j * .8));
        return [W * .81 + Math.cos(t + j * .55) * radius, H * .18 + Math.sin(t + j * .55) * radius];
      });
      env.line(points, sc.accent, u * .0025, .95 * decor * visible);
    }
    line([[.35, .69], [.65, .69]], sc.accent, .6);
  } else if (theme === 'Signal') {
    for (let i = 1; i < 8; i++) { line([[i / 8, .08], [i / 8, .92]], sc.accent2 ?? sc.accent, .55, .001); }
    for (let i = 1; i < 6; i++) line([[.05, i / 6], [.95, i / 6]], sc.accent2 ?? sc.accent, .55, .001);
    const x = variant === 1 ? .4 : .52, y = variant === 2 ? .6 : .5;
    word(text, x, y, W * .78, H * .30, u * .17);
    line([[x - .36, y - .14], [x - .36, y - .08]], sc.accent, .9, .005);
    line([[x + .32, y + .08], [x + .32, y + .14]], sc.accent, .9, .005);
    for (let i = 0; i < 18; i++) {
      const height = .016 + .04 * (.5 + .5 * Math.sin(i * .7 + env.lt * 1.2 * k));
      line([[.57 + i * .018, .78], [.57 + i * .018, .78 - height]], sc.accent, .95, .005);
    }
  } else {
    const first = [...text][0] ?? '';
    word(first, portrait ? .64 : .76, .4, W * .6, H * .7, u * .72, { color: sc.fg, rot: -8, alpha: .27 }, true);
    word(text, variant === 1 ? .42 : .36, variant === 2 ? .6 : .72, W * .60, H * .27, u * .135);
    line([[.05, .84], [.47, .84]], sc.accent, .75);
    line([[.53, .9], [.94, .66]], sc.accent, .6);
  }
  // 補助は本文の複製ではなく一定の小さなラベル。歌詞の読む順序を崩さない。
  if (env.pass === 'main' && decor > 0) env.draw({ text: `${theme.toUpperCase()} / ${String(variant + 1).padStart(2, '0')}`,
    font: 'mono', size: u * .019, x: W * .22, y: H * .94, color: sc.accent, alpha: decor * visible * .65 });
  return box;
}
export const gptHyperPack = makePack('Hyper');
export const GPT_PACKS: readonly MotionPack[] = [gptHyperPack, ...(['Echo', 'Rush', 'Rose', 'Signal', 'Afterglow'] as Theme[]).map(makePack)];
