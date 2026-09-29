import { describe, expect, it } from 'vitest';
import { CUSTOM_STYLE_KEY, defaultLyrics } from '../types';
import { ODD_METER_SET, ODD_METER_STYLE_KEY } from './oddmeter-pack';
import {
  attachRhythm,
  buildCustomStyle,
  buildJizuraAudio,
  buildJizuraProject,
  COVERING_LAYOUTS,
  COVERING_TRANSITIONS,
  customFromStyle,
  isDarkText,
  keepLightTextSchemes,
  lyricMotionSeed,
  motionRhythmGrid,
  nearestAspect,
  normalizeEnergy,
  planRhythmAt,
  usesOddMeterPack,
  type JizuraPlan,
  type JizuraStyleDef,
} from './jizura-adapter';

// 明るさ: 白系 = 1、それ以外 = 0 の簡易版 (JIZURA の J.lum の代わり)
const lum = (c: string): number => (/^#(f|e|d)/i.test(c) ? 1 : 0);

/** noir に似た元のスタイル: 0 番 = 暗い背景 + 白文字、1 番 = 明るい背景 + 黒文字 (swap) */
const baseStyle = (): JizuraStyleDef => ({
  name: 'ノワール',
  schemes: [
    { bg: '#060607', fg: '#f5eeea', sub: '#bdb6b2', accent: '#f5a50c', accent2: '#16f4d4', ink: '#f5eeea', dim: '#2a2a2e', ghostA: '#f5a50c', ghostB: '#16f4d4' },
    { bg: '#f2ede8', fg: '#0b0b0c', sub: '#4a4644', accent: '#e0600c', accent2: '#0fae98', ink: '#0b0b0c', ghostA: '#f5a50c', ghostB: '#16c4b4', swap: true },
  ],
  fonts: { display: ['gothic_black', 'dela'], serif: ['mincho_light'], body: ['gothic_med'], mono: ['mono'] },
  texture: { grain: 0.9, paper: 0, scan: 0 },
  ghost: 1,
  bias: { layout: { vcols: 2 } },
});

describe('オリジナルのスタイル (L7)', () => {
  it('customFromStyle: 元のスタイルの「重ねて読める」配色・最初の書体・質感を初期値にする', () => {
    const c = customFromStyle('noir', baseStyle(), lum);
    expect(c.base).toBe('noir');
    expect(c.name).toBe('ノワール のアレンジ');
    expect(c.colors).toEqual({ fg: '#f5eeea', sub: '#bdb6b2', accent: '#f5a50c', accent2: '#16f4d4', ghostA: '#f5a50c', ghostB: '#16f4d4' });
    expect(c.fonts).toEqual({ display: 'gothic_black', serif: 'mincho_light', body: 'gothic_med' });
    expect(c.texture).toEqual({ grain: 0.9, scan: 0, ghost: 1, glow: 0 });
  });

  it('buildCustomStyle: 暗い背景の配色だけ残して色を差し替え、書体・質感・名前を差し替える。演出の好みは元のまま', () => {
    const custom = {
      ...customFromStyle('noir', baseStyle(), lum),
      name: 'わたしの',
      colors: { fg: '#ffffff', sub: '#dddddd', accent: '#ff00aa', accent2: '#00ffcc', ghostA: '#ff0000', ghostB: '#0000ff' },
      fonts: { display: 'dela', serif: 'no_such_font', body: '' },
      texture: { grain: 0.2, scan: 0.7, ghost: 0.5, glow: 0.8 },
    };
    const base = baseStyle();
    const st = buildCustomStyle(base, custom, lum, (k) => k === 'dela');
    expect(st.name).toBe('わたしの');
    // 明るい背景の配色 (swap) は捨てる
    expect(st.schemes).toHaveLength(1);
    expect(st.schemes[0]).toMatchObject({ bg: '#060607', fg: '#ffffff', sub: '#dddddd', accent: '#ff00aa', accent2: '#00ffcc', ghostA: '#ff0000', ghostB: '#0000ff', ink: '#ffffff', dim: '#2a2a2e' });
    // 書体: 存在するものだけ差し替え、存在しない・空は元のまま
    expect(st.fonts.display).toEqual(['dela']);
    expect(st.fonts.serif).toEqual(['mincho_light']);
    expect(st.fonts.body).toEqual(['gothic_med']);
    expect(st.texture).toEqual({ grain: 0.2, paper: 0, scan: 0.7 });
    expect(st.ghost).toBe(0.5);
    expect(st.glow).toBe(0.8);
    expect(st.bias).toEqual({ layout: { vcols: 2 } });
    // 元のスタイルは書き換えない
    expect(base.schemes).toHaveLength(2);
    expect(base.fonts.display).toEqual(['gothic_black', 'dela']);
  });

  it('buildCustomStyle: 暗い背景の配色が 1 つも無ければ、最初の配色を黒い背景にして使う', () => {
    const base = baseStyle();
    base.schemes = [base.schemes[1]!];
    const st = buildCustomStyle(base, customFromStyle('noir', baseStyle(), lum), lum, () => true);
    expect(st.schemes).toHaveLength(1);
    expect(st.schemes[0]).toMatchObject({ bg: '#000000', swap: false });
  });

  it('isDarkText: 重ねると読みにくい暗い文字色か', () => {
    expect(isDarkText('#111111', lum)).toBe(true);
    expect(isDarkText('#ffffff', lum)).toBe(false);
  });
});

describe('keepLightTextSchemes', () => {
  // 明るさ: #fff = 1、#000 = 0 のような簡易版
  const lum = (c: string): number => (c === '#fff' ? 1 : c === '#ccc' ? 0.8 : 0);
  const plan = (): JizuraPlan => ({
    W: 1920,
    H: 1080,
    duration: 10,
    lines: [],
    // 0: 暗い背景 + 白文字、1: 明るい背景 + 黒文字、2: 暗い背景 + 明るい灰色の文字
    style: { schemes: [{ bg: '#000', fg: '#fff' }, { bg: '#fff', fg: '#000' }, { bg: '#000', fg: '#ccc' }] },
    cuts: [{ scheme: 0 }, { scheme: 1 }, { scheme: 2 }, { scheme: 4 }, {}],
  });

  it('文字が明るい配色だけを残し、カットの配色番号を付け替える', () => {
    const p = keepLightTextSchemes(plan(), lum);
    expect(p.style.schemes).toEqual([{ bg: '#000', fg: '#fff' }, { bg: '#000', fg: '#ccc' }]);
    // 0 → 0、1 (暗い文字) → 1 % 2 = 1、2 → 1、4 (= 4 % 3 = 1 番、暗い文字) → 4 % 2 = 0、番号の無いカットはそのまま
    expect(p.cuts).toEqual([{ scheme: 0 }, { scheme: 1 }, { scheme: 1 }, { scheme: 0 }, {}]);
  });

  it('すべて明るい文字、またはすべて暗い文字なら何もしない', () => {
    const allDark = plan();
    allDark.style.schemes = [{ bg: '#fff', fg: '#000' }];
    expect(keepLightTextSchemes(allDark, lum).style.schemes).toHaveLength(1);
    const allLight = plan();
    allLight.style.schemes = [{ bg: '#000', fg: '#fff' }];
    expect(keepLightTextSchemes(allLight, lum).cuts[1]).toEqual({ scheme: 1 });
  });
});

describe('nearestAspect', () => {
  it('書き出しサイズに最も近い JIZURA の比率を選ぶ', () => {
    expect(nearestAspect(1920, 1080)).toBe('16:9');
    expect(nearestAspect(1080, 1920)).toBe('9:16');
    expect(nearestAspect(1080, 1080)).toBe('1:1');
    expect(nearestAspect(1080, 1350)).toBe('4:5');
    expect(nearestAspect(2560, 1080)).toBe('21:9');
    expect(nearestAspect(1440, 1080)).toBe('4:3');
    expect(nearestAspect(1920, 1200)).toBe('16:9');
    expect(nearestAspect(0, 0)).toBe('1:1');
  });
});

describe('normalizeEnergy', () => {
  it('95 パーセンタイルで 0..1 にし、NaN は 0', () => {
    const rms = new Float32Array(100);
    for (let i = 0; i < 100; i++) rms[i] = i / 100;
    rms[3] = Number.NaN;
    const e = normalizeEnergy(rms);
    expect(e[95]).toBeCloseTo(1);
    expect(e[99]).toBe(1);
    expect(e[50]).toBeCloseTo(0.5 / 0.95, 3);
    expect(e[3]).toBe(0);
    expect(normalizeEnergy(new Float32Array(0)).length).toBe(0);
    expect(Array.from(normalizeEnergy(new Float32Array(3)))).toEqual([0, 0, 0]);
  });
});

describe('変拍子 (R3): motionRhythmGrid / buildJizuraAudio / attachRhythm', () => {
  const rhythm = { enabled: true, bars: [1, 2.75, 4.5], meters: [{ bar: 0, pattern: '2+2+3' }] };

  it('変拍子モードがオフ・小節が作れないときは null (自動検出のビートを使う)', () => {
    expect(motionRhythmGrid(null)).toBeNull();
    expect(motionRhythmGrid({ ...rhythm, enabled: false })).toBeNull();
    expect(motionRhythmGrid({ ...rhythm, bars: [1] })).toBeNull();
    expect(motionRhythmGrid(rhythm)!.beats.slice(0, 4)).toEqual([1, 1.5, 2, 2.75]);
  });

  it('小節と拍子があれば、ビートは自動検出のものではなく拍 (まとまりの頭) にする', () => {
    const analysis = { duration: 10, beats: [0.5, 1, 1.5, 2, 2.5], rms: new Float32Array(10), frameRate: 60 };
    const grid = motionRhythmGrid(rhythm)!;
    expect(buildJizuraAudio(analysis, grid).beats).toEqual(grid.beats);
    expect(buildJizuraAudio(analysis, null).beats).toEqual(analysis.beats);
  });

  it('attachRhythm: plan に小節の並びを添え、null なら外す。planRhythmAt で位置が分かる', () => {
    const grid = motionRhythmGrid(rhythm)!;
    const plan = { W: 1920, H: 1080, duration: 10, lines: [], cuts: [], style: { schemes: [] } };
    expect(attachRhythm(plan, grid).zzRhythm).toBe(grid);
    expect(planRhythmAt(plan, 2.1)).toMatchObject({ pulse: { bar: 0, group: 2 } });
    expect(attachRhythm(plan, null).zzRhythm).toBeUndefined();
    expect(planRhythmAt(plan, 2.1)).toBeNull();
  });
});

describe('buildJizuraAudio', () => {
  it('長さ・ビート (昇順)・正規化した音量・フレームレートを渡す', () => {
    const a = buildJizuraAudio({ duration: 10, beats: [2, 1], rms: new Float32Array([0, 1]), frameRate: 60 });
    expect(a.duration).toBe(10);
    expect(a.beats).toEqual([1, 2]);
    expect(a.energyRate).toBe(60);
    expect(a.energy.length).toBe(2);
  });
});

describe('buildJizuraProject', () => {
  const defaults = { style: 'noir', seed: 1, fx: { motion: 0.7 }, timing: { bpm: 0, offset: 0.4, snap: true, lineTimes: {} } };

  it('歌詞・seed・比率・fps と、手で決めた開始・終了を渡す (SRT は LRC にして渡す)', () => {
    const lyrics = {
      ...defaultLyrics(),
      source: 'srt' as const,
      text: '1\n00:00:01,000 --> 00:00:02,000\nあ',
      timing: { lineTimes: { '0': 1.2 }, lineEnds: { '0': 1.9 }, snap: true, snapWindowMs: 150 },
    };
    const p = buildJizuraProject(lyrics, defaults, { seed: 99, aspect: '9:16', fps: 30 });
    expect(p.lyrics).toBe('[00:01.000]あ');
    expect(p.seed).toBe(99);
    expect(p.aspect).toBe('9:16');
    expect(p.fps).toBe(30);
    // 歌詞モーションの設定 (既定値) がスタイルと fx に入る
    expect(p.style).toBe('noir');
    expect(p.fx).toEqual({ motion: 0.7, decor: 0.5, density: 0.55 });
    // 画面を覆う場面転換は使わない (JIZURA の enabled で無効にする)
    const { trans, layout } = p.enabled as { trans: Record<string, boolean>; layout: Record<string, boolean> };
    for (const k of COVERING_TRANSITIONS) expect(trans[k]).toBe(false);
    for (const k of COVERING_LAYOUTS) expect(layout[k]).toBe(false);
    expect(p.timing).toEqual({ bpm: 0, offset: 0.4, snap: true, lineTimes: { '0': 1.2 }, lineEnds: { '0': 1.9 } });
    // 渡した設定と共有しない (JIZURA 側で書き換えられても ZUNZUN の状態は変わらない)
    expect((p.timing as { lineTimes: object }).lineTimes).not.toBe(lyrics.timing.lineTimes);
  });

  it('歌詞モーションの seed は project.seed から決まる (同じなら同じ、違えば違う)', () => {
    expect(lyricMotionSeed(20260927)).toBe(lyricMotionSeed(20260927));
    expect(lyricMotionSeed(20260927)).not.toBe(lyricMotionSeed(20260928));
  });
});

describe('変拍子パック (R4) を使う条件と、JIZURA に渡すプロジェクト', () => {
  const grid = motionRhythmGrid({ enabled: true, bars: [1, 2.75, 4.5], meters: [{ bar: 0, pattern: '2+2+3' }] });
  const motion = (o: Partial<ReturnType<typeof defaultLyrics>['motion']>) => ({ ...defaultLyrics().motion, ...o });

  it('変拍子モードがオン (小節がある) で、変拍子用スタイルか、それを元にしたマイスタイルのときだけ', () => {
    expect(usesOddMeterPack(motion({ style: ODD_METER_STYLE_KEY }), grid)).toBe(true);
    expect(usesOddMeterPack(motion({ style: ODD_METER_STYLE_KEY }), null)).toBe(false);
    expect(usesOddMeterPack(motion({ style: 'noir' }), grid)).toBe(false);
    const custom = { name: 'x', base: ODD_METER_STYLE_KEY } as NonNullable<ReturnType<typeof defaultLyrics>['motion']['custom']>;
    expect(usesOddMeterPack(motion({ style: CUSTOM_STYLE_KEY, custom }), grid)).toBe(true);
    expect(usesOddMeterPack(motion({ style: CUSTOM_STYLE_KEY, custom: { ...custom, base: 'noir' } }), grid)).toBe(false);
  });

  it('使うときは部品セットをオンにし、「4 拍でひと回り」の演出を無効にする。使わないときは何も足さない', () => {
    const defaults = { timing: {}, enabled: { hold: { windGust: true, still: true } } };
    const on = buildJizuraProject(defaultLyrics(), defaults, { seed: 1, aspect: '16:9', fps: 30, oddMeter: true });
    expect(on[ODD_METER_SET]).toBe(true);
    const hold = (on.enabled as Record<string, Record<string, boolean>>).hold!;
    expect(hold).toMatchObject({ windGust: false, pluckString: false, still: true });
    const off = buildJizuraProject(defaultLyrics(), defaults, { seed: 1, aspect: '16:9', fps: 30 });
    expect(off[ODD_METER_SET]).toBeUndefined();
    expect((off.enabled as Record<string, Record<string, boolean>>).hold).toEqual({ windGust: true, still: true });
  });
});

