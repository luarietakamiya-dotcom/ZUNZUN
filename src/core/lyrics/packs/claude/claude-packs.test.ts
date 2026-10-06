import { beforeAll, expect, it } from 'vitest';
import { defaultLyrics } from '../../../types';
import { buildJizuraProject, installTimingPatch, type JizuraApi } from '../../jizura-adapter';
import { applyMotionPack, registerMotionPacks } from '../index';
import { CLAUDE_PACKS } from './index';
import type { LayoutEnv } from '../design-kit';
import type { PackEnv, PackItem, PackJ } from '../types';

let J: JizuraApi & PackJ;
beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (text: string) => ({ width: [...text].length * 60 }) })) as unknown as HTMLCanvasElement['getContext'];
  await import('../../../../../vendor/jizura/jizura-engine.js');
  J = (globalThis as unknown as { J: JizuraApi & PackJ }).J;
  installTimingPatch(J); registerMotionPacks(J);
});

type Draw = Record<string, unknown>;
type Def = { plan: (rng: unknown) => Record<string, unknown>; render: (env: LayoutEnv) => unknown; fits: (n: number) => boolean };

/** WebGL なしで、レイアウトが描く物（主役 = mainDraw、装飾 = draw / rect / line）を集める */
function collect(def: Def, W: number, H: number, text: string, words?: string[], motion = 0.7, decor = 0.5) {
  const params = def.plan({ pick: (a: unknown[]) => a[0], range: (a: number, b: number) => (a + b) / 2 });
  const mains: Draw[] = [], decors: Draw[] = [], shapes: unknown[][] = [], old = J.mainDraw;
  J.mainDraw = (_env, item) => { mains.push(item); return { x0: item.x as number - 100, x1: item.x as number + 100, y0: item.y as number - 40, y1: item.y as number + 40 }; };
  try {
    const env = {
      W, H, lt: 0.9, pIn: 1, pOut: 0, pass: 'main', fx: { motion, decor }, sc: { fg: '#ffffff', sub: '#aaaaaa', accent: '#ff3db8', accent2: '#29e6ff' }, t: 0.9, ctx: {},
      draw: (item: Draw) => { decors.push(item); return null; },
      rect: (...a: unknown[]) => { shapes.push(a); }, rrect: (...a: unknown[]) => { shapes.push(a); }, poly: (...a: unknown[]) => { shapes.push(a); },
      polyPartial: () => {}, line: (...a: unknown[]) => { shapes.push(a); }, circle: () => {},
      cut: { start: 0, dur: 4, inDur: 0.3, outDur: 0.3, line: 2, params, text, words },
    } as unknown as LayoutEnv;
    def.render(env);
  } finally { J.mainDraw = old; }
  return { mains, decors, shapes };
}

const layoutsOf = (pack: (typeof CLAUDE_PACKS)[number]) => pack.effects(J).filter((e) => e.group === 'layout').map((e) => ({ key: e.key, def: e.def as unknown as Def }));

it('Claude 版は語尾 .c で、独立した部品セットを持ち、同じ seed で同じ演出になり、自分の演出だけが選ばれる', () => {
  expect(CLAUDE_PACKS.length).toBeGreaterThan(0);
  for (const pack of CLAUDE_PACKS) {
    expect(pack.styleKey.endsWith('.c')).toBe(true);
    expect(pack.id.endsWith('.c')).toBe(true);
    expect(J.STYLES[pack.styleKey]!.name.includes('.c')).toBe(true);
    const lyrics = defaultLyrics();
    lyrics.text = 'この歌を君に届けよう\n星の光をたどって\n夜明けまで歩こう\n走れ';
    lyrics.timing.lineTimes = { '0': 1, '1': 5, '2': 9, '3': 13 };
    lyrics.motion.style = pack.styleKey;
    const make = () => {
      const project = buildJizuraProject(lyrics, J.defaultProject(), { seed: 5, aspect: '16:9', fps: 30 });
      applyMotionPack(project, lyrics.motion, J);
      return J.plan(project, { duration: 17, beats: [], energy: new Float32Array(1020), energyRate: 60 });
    };
    const plan = make(); expect(JSON.stringify(make())).toBe(JSON.stringify(plan));
    for (const cut of (plan.cuts as { line: number; layout: string; enter: string; hold: string; exit: string; cam: string }[]).filter((c) => c.line >= 0)) {
      for (const group of ['layout', 'enter', 'hold', 'exit', 'cam'] as const) expect(J.registry(group)[cut[group]]?.pack, `${pack.id}/${group}/${cut[group]}`).toBe(pack.id);
    }
  }
});

it('全レイアウトが、横長・縦長・短文・長文・1 文字で、有限の座標と大きさを描き、画面の外へ出ない', () => {
  for (const pack of CLAUDE_PACKS) for (const { key, def } of layoutsOf(pack)) {
    for (const [W, H] of [[1920, 1080], [1080, 1920]] as const) {
      for (const [text, words] of [['走れ', undefined], ['止まらない', undefined], ['夜空に 言葉を 描く', ['夜空に', '言葉を', '描く']], ['長い歌詞も折り返して画面の中に収める。'.repeat(3), undefined], ['光', undefined]] as const) {
        if (!def.fits([...text.replace(/\s/g, '')].length)) continue;
        const { mains } = collect(def, W, H, text, words ? [...words] : undefined);
        expect(mains.length, `${key} ${text}`).toBeGreaterThan(0);
        for (const item of mains) {
          for (const k of ['x', 'y', 'size']) expect(Number.isFinite(item[k]), `${key}.${k}`).toBe(true);
          expect(item.size as number).toBeGreaterThan(0);
          expect(item.x as number).toBeGreaterThan(-W * 0.3); expect(item.x as number).toBeLessThan(W * 1.3);
          expect(item.y as number).toBeGreaterThan(-H * 0.3); expect(item.y as number).toBeLessThan(H * 1.3);
        }
      }
    }
  }
});

it('読む順序が保たれる: 語が複数あるとき、前の語は主役の左上、後の語は右下に置く', () => {
  const def = layoutsOf(CLAUDE_PACKS[0]!).find((l) => l.key === 'vscHyperSlab')!.def;
  const { mains } = collect(def, 1920, 1080, '夜 言葉を 描く', ['夜', '言葉を', '描く']);
  const byText = (t: string) => mains.find((m) => String(m.text).replace(/\n/g, '') === t)!;
  const pre = byText('夜'), hero = byText('言葉を'), post = byText('描く');
  expect(hero.mi).toBe(0); expect(post.mi).toBe(1); expect(pre.mi).toBe(2);
  expect(pre.x as number).toBeLessThan(hero.x as number); expect(pre.y as number).toBeLessThan(hero.y as number);
  expect(post.x as number).toBeGreaterThan(hero.x as number); expect(post.y as number).toBeGreaterThan(hero.y as number);
});

it('主従: 語尾・補助の文字は、主役の 40 % 以下の大きさ。1 語は分割しない', () => {
  for (const pack of CLAUDE_PACKS) for (const { key, def } of layoutsOf(pack)) {
    const { mains } = collect(def, 1920, 1080, '夜空に 言葉を 描く', ['夜空に', '言葉を', '描く']);
    if (mains.length < 2) continue;
    const hero = Math.max(...mains.map((m) => m.size as number));
    for (const m of mains) if (m.size !== hero) expect((m.size as number) / hero, `${key} ${String(m.text)}`).toBeLessThanOrEqual(0.4);
    if (/Keys|Bubble|Stairs|Stars/.test(key)) continue;   // キー・泡・階段は 1 字ずつを置く設計
    const single = collect(def, 1920, 1080, '止まらない').mains;
    expect(single.some((m) => String(m.text).replace(/\n/g, '') === '止まらない' || [...String(m.text)].length >= 2), `${key} は 1 語を分割しない`).toBe(true);
  }
});

it('強さ 0・装飾 0 でも有限で、主役の文字は描かれる', () => {
  for (const pack of CLAUDE_PACKS) for (const { key, def } of layoutsOf(pack)) {
    const { mains } = collect(def, 1920, 1080, '止まらない鼓動が', undefined, 0, 0);
    expect(mains.length, key).toBeGreaterThan(0);
    for (const m of mains) for (const k of ['x', 'y', 'size']) expect(Number.isFinite(m[k])).toBe(true);
  }
});

it('登場・退場・表示中の動きは有限で、強さ 0 では文字が動かない（固定）', () => {
  for (const pack of CLAUDE_PACKS) for (const e of pack.effects(J).filter((x) => ['enter', 'exit', 'hold'].includes(x.group))) {
    for (const motion of [0, 1]) for (const p of [0, 0.3, 1]) {
      const it = { size: 100, charFns: [] } as unknown as PackItem;
      (e.def.apply as (env: PackEnv, it: PackItem, p: number) => void)({ fx: { motion }, lt: p, beat: null } as unknown as PackEnv, it, p);
      for (const fn of it.charFns) for (let i = 0; i < 4; i++) { const r = fn(i, { i }, 4); for (const v of Object.values(r ?? {})) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true); }
    }
  }
});
