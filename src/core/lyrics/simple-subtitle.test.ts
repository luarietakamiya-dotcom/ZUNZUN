import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultLyrics, defaultProject, defaultSubtitle, type LyricsSettings } from '../types';
import { sanitizeProject } from '../project/validate';
import { LyricMotion } from './jizura-adapter';
import { createLyricRenderer } from './lyric-renderer';
import { LyricMotionProvider, motionKey, type MotionRequest } from './motion-provider';
import { SimpleSubtitle } from './simple-subtitle';
import { wrapLyric } from './split-lines';
import { subtitleFontFamily, subtitleWeight } from './subtitle-fonts';

const lyrics = (o: Partial<LyricsSettings> = {}): LyricsSettings => ({
  ...defaultLyrics(),
  engine: 'subtitle',
  text: '赤いライトが\n[間奏]\nMaybe I\'m stuck in the silence',
  timing: { ...defaultLyrics().timing, lineTimes: { '0': 1, '1': 4, '2': 6 }, lineEnds: { '0': 3, '2': 9 } },
  ...o,
});

/** 描いた文字と、そのときの濃さ・位置・書体・ふちどりを覚える、まねの canvas */
function fakeCtx(width = 1920, height = 1080) {
  const calls: { op: string; text: string; x: number; y: number; alpha: number; font: string }[] = [];
  let cleared = 0;
  const ctx = {
    canvas: { width, height },
    globalAlpha: 1, font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '', shadowColor: '', shadowBlur: 0, shadowOffsetY: 0, lineWidth: 0, lineJoin: '',
    save() {}, restore() {}, setTransform() {},
    clearRect() { cleared++; },
    measureText: (s: string) => ({ width: [...s].length * 60 }),
    fillText(text: string, x: number, y: number) { calls.push({ op: 'fill', text, x, y, alpha: ctx.globalAlpha, font: ctx.font }); },
    strokeText(text: string, x: number, y: number) { calls.push({ op: 'stroke', text, x, y, alpha: ctx.globalAlpha, font: ctx.font }); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, cleared: () => cleared };
}

describe('シンプル字幕 (JIZURA を使わない)', () => {
  it('行の時刻どおりに出て、間奏の行と行の外では何も出さない', async () => {
    const sub = await SimpleSubtitle.create(lyrics(), { width: 1920, height: 1080 });
    expect(sub.frameAt(0.5)).toBeNull();
    expect(sub.frameAt(2)).toEqual({ line: 0, alpha: 1 });
    expect(sub.frameAt(5)).toBeNull(); // [間奏]
    expect(sub.frameAt(7)?.line).toBe(2);
    expect(sub.frameAt(9.5)).toBeNull();
  });

  it('表示中は位置・大きさ・濃さが変わらない (動きなし)。出入りだけフェード', async () => {
    const sub = await SimpleSubtitle.create(lyrics(), { width: 1920, height: 1080 });
    const draw = (t: number) => { const f = fakeCtx(); sub.render(f.ctx, t); return f.calls.filter((c) => c.op === 'fill'); };
    const a = draw(1.5), b = draw(2.4), c = draw(2.7);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a.every((x) => x.alpha === 1)).toBe(true);
    expect(draw(1)).toEqual([]); // 出始めは濃さ 0
    expect(draw(1.1)[0]!.alpha).toBeCloseTo(0.5, 5); // 0.2 秒のフェードの半分
    expect(draw(2.9)[0]!.alpha).toBeCloseTo(0.5, 5);
  });

  it('フェード 0 ならパッと切り替わる。ふちどり 0 なら縁を描かない', async () => {
    const sub = await SimpleSubtitle.create(lyrics({ subtitle: { ...defaultSubtitle(), fade: 0, outline: 0 } }), { width: 1920, height: 1080 });
    const f = fakeCtx();
    sub.render(f.ctx, 1.001);
    expect(f.calls.length).toBeGreaterThan(0);
    expect(f.calls.every((c) => c.op === 'fill' && c.alpha === 1)).toBe(true);
  });

  it('毎回 canvas を透明にしてから描く。位置は下・中央・上で変わる', async () => {
    const ys: Record<string, number> = {};
    for (const position of ['bottom', 'middle', 'top'] as const) {
      const sub = await SimpleSubtitle.create(lyrics({ subtitle: { ...defaultSubtitle(), position } }), { width: 1920, height: 1080 });
      const f = fakeCtx();
      sub.render(f.ctx, 2);
      expect(f.cleared()).toBe(1);
      ys[position] = f.calls.find((c) => c.op === 'fill')!.y;
    }
    expect(ys.top! < ys.middle! && ys.middle! < ys.bottom!).toBe(true);
  });

  it('画面の幅に入らない行は単語・言葉の切れ目で折り返す', async () => {
    const sub = await SimpleSubtitle.create(lyrics(), { width: 1080, height: 1920 });
    const f = fakeCtx(1080, 1920);
    sub.render(f.ctx, 7);
    const rows = f.calls.filter((c) => c.op === 'fill').map((c) => c.text);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.join(' ')).toBe("Maybe I'm stuck in the silence");
  });

  it('書体: Google の書体と、この PC の書体', () => {
    expect(subtitleFontFamily('noto-serif')).toBe('"Noto Serif JP", sans-serif');
    expect(subtitleFontFamily('local:游ゴシック')).toBe('"游ゴシック", sans-serif');
    expect(subtitleFontFamily('unknown')).toBe('"Noto Sans JP", sans-serif');
    expect(subtitleWeight('dela', true)).toBe(400); // 太字の無い書体
    expect(subtitleWeight('noto-sans', true)).toBe(700);
  });
});

describe('wrapLyric', () => {
  it('英字は単語の間、日本語は言葉の切れ目、混ざった行は英字を切らない', () => {
    expect(wrapLyric('And the silence', 8)).toEqual(['And the', 'silence']);
    expect(wrapLyric('赤いライトが鼓動を撃った', 7)).toEqual(['赤いライトが', '鼓動を撃った']);
    expect(wrapLyric('Midnight 光の向こうへ', 6)).toEqual(['Midnight', '光の向こうへ']);
    expect(wrapLyric('短い', 10)).toEqual(['短い']);
  });
});

describe('保存と選び分け', () => {
  it('描き方と字幕の見た目を保存でき、おかしな値は直す', () => {
    const withSub = (sub: Record<string, unknown>, engine: unknown = 'subtitle') => {
      const l = defaultLyrics();
      return JSON.parse(JSON.stringify({ ...defaultProject(), lyrics: { ...l, text: 'a', engine, subtitle: sub } }));
    };
    const ok = sanitizeProject(withSub({ ...defaultSubtitle(), font: 'local:游明朝', position: 'top', size: 1.5 })).lyrics!;
    expect(ok.engine).toBe('subtitle');
    expect(ok.subtitle).toMatchObject({ font: 'local:游明朝', position: 'top', size: 1.5 });
    const bad = sanitizeProject(withSub({ font: 'local:"}<x>', position: 'left', size: 9, color: 'red', fade: -1 }, 'other')).lyrics!;
    expect(bad.engine).toBe('jizura');
    expect(bad.subtitle).toMatchObject({ font: 'noto-sans', position: 'bottom', size: 2, color: '#ffffff', fade: 0 });
    expect(sanitizeProject(JSON.parse(JSON.stringify({ ...defaultProject(), lyrics: { ...defaultLyrics(), text: 'a' } }))).lyrics!.engine).toBe('jizura');
  });

  afterEach(() => vi.restoreAllMocks());

  it('シンプル字幕のときは JIZURA を作らない', async () => {
    const spy = vi.spyOn(LyricMotion, 'create');
    const r = await createLyricRenderer(lyrics(), null, { projectSeed: 1, width: 1280, height: 720, fps: 30 });
    expect(r).toBeInstanceOf(SimpleSubtitle);
    expect(r.plan).toEqual({ W: 1280, H: 720 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('描き方や字幕の見た目を変えると作り直す。時刻だけの変更も「反映」を待たずに作る', async () => {
    const req = (l: LyricsSettings): MotionRequest => ({ lyrics: l, analysis: null, projectSeed: 1, width: 1280, height: 720, fps: 30 });
    const base = lyrics();
    expect(motionKey(req(base) as MotionRequest & { lyrics: LyricsSettings })).not.toBe(motionKey(req({ ...base, engine: 'jizura' }) as MotionRequest & { lyrics: LyricsSettings }));
    expect(motionKey(req(base) as MotionRequest & { lyrics: LyricsSettings })).not.toBe(motionKey(req({ ...base, subtitle: { ...defaultSubtitle(), size: 1.4 } }) as MotionRequest & { lyrics: LyricsSettings }));
    let clock = 0;
    const p = new LyricMotionProvider(() => (clock += 10_000));
    p.get(req(base));
    await new Promise((r) => setTimeout(r, 0));
    const first = p.get(req(base));
    expect(first).toBeInstanceOf(SimpleSubtitle);
    const moved = { ...base, timing: { ...base.timing, lineTimes: { ...base.timing.lineTimes, '0': 1.5 } } };
    p.get(req(moved));
    await new Promise((r) => setTimeout(r, 0));
    const second = p.get(req(moved));
    expect(second).not.toBe(first);
    expect((second as SimpleSubtitle).frameAt(1.2)).toBeNull(); // 新しい時刻 (1.5 秒から) で作り直されている
  });
});
