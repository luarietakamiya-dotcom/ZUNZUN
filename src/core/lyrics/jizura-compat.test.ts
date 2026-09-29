import { beforeAll, describe, expect, it } from 'vitest';
import { defaultLyrics } from '../types';
import { attachRhythm, buildJizuraProject, installTimingPatch, motionRhythmGrid, planRhythmAt, usesOddMeterPack, type JizuraApi } from './jizura-adapter';
import { ODD_METER_STYLE_KEY, registerOddMeterPack, type PackApi } from './oddmeter-pack';
import { parseLyrics } from './parse';
import { computeLineTimes } from './timing';

/**
 * 同梱した本物の JIZURA (vendor/jizura/jizura-engine.js) と、TypeScript に移植した parseLyrics / computeLineTimes が
 * 同じ結果を返すかを確かめる。行番号 (lineTimes のキー) の数え方がずれると、手で決めた時刻が別の行に付いてしまうため。
 * L1 では一回限りの手作業で比べていたものを、JIZURA を同梱した L5 で自動のテストにした。
 */

let J: JizuraApi;

beforeAll(async () => {
  // JIZURA は読み込み時に文字の幅を測るための canvas を作る。jsdom には canvas が無く「未実装」の警告が出るので、
  // このテスト (canvas を使わない parseLyrics / computeTiming だけを比べる) では空の getContext に置き換える
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  await import('../../../vendor/jizura/jizura-engine.js');
  J = (globalThis as unknown as { J: JizuraApi }).J;
  installTimingPatch(J);
});

const FIXTURES = [
  '夜明けの色を/覚えてる\nほどけた声が遠くで鳴った\nねえ、まだ間に合うかな\n*透明*なままじゃ終われない!',
  '[ti:t]\n[ar:a]\n[00:10.50]二\n[00:01.00][00:20:00]サビ\n\n[01:02.3]end|note',
  '[間奏]\n[間奏 8]\n[inst:4s]\n[간주]\n[間奏って]\n\n\n# c\n / \nhello/world!\n叫べ！\n!',
  'a\r\n\r\nb\n  \n*x*y*z*\n[00:05.00]mixed\nplain',
  '',
  '[00:01.00][間奏]\n[00:03.00]x',
  'あいうえお\nかきくけこさしすせそ\n\nたちつてと\nlong line of english words here',
];

type Line = { text: string; src: number; lrc: number | null; interlude?: boolean; secs?: number | null; note: string | null; impact: boolean; emph: string[]; manual: string[] | null; gapBefore: boolean };
const norm = (l: Line) => ({ text: l.text, src: l.src, lrc: l.lrc, interlude: !!l.interlude, secs: l.secs ?? null, note: l.note, impact: l.impact, emph: l.emph, manual: l.manual, gapBefore: l.gapBefore });

describe('JIZURA との一致 (同梱した本物と比べる)', () => {
  it('parseLyrics: 行・行番号・記号の扱いがすべて同じ', () => {
    for (const text of FIXTURES) {
      const theirs = J.parseLyrics(text);
      const ours = parseLyrics(text);
      expect((theirs.lines as Line[]).map(norm)).toEqual(ours.lines.map((l) => norm(l as Line)));
      expect(theirs.meta).toEqual(ours.meta);
    }
  });

  it('computeTiming: BPM・手で決めた開始と終了・音源の長さの組み合わせで同じ時刻になる', () => {
    const cases: { bpm: number; lineTimes: Record<string, number>; lineEnds: Record<string, number> }[] = [
      { bpm: 0, lineTimes: {}, lineEnds: {} },
      { bpm: 120, lineTimes: { '1': 3.3 }, lineEnds: {} },
      { bpm: 97, lineTimes: {}, lineEnds: { '0': 1.5 } },
      { bpm: 0, lineTimes: { '0': 1 }, lineEnds: { '2': 30 } },
    ];
    for (const text of FIXTURES) {
      for (const c of cases) {
        for (const duration of [0, 200]) {
          const parsed = J.parseLyrics(text);
          const audio = duration ? { duration, beats: [], energy: new Float32Array(0), energyRate: 60 } : null;
          const theirs = J.computeTiming({ timing: { bpm: c.bpm, lineTimes: c.lineTimes, lineEnds: c.lineEnds } }, parsed, audio);
          const ours = computeLineTimes(parseLyrics(text), c, { bpm: c.bpm, audioDuration: duration || undefined });
          expect({ starts: theirs.starts, ends: theirs.ends, duration: theirs.duration }).toEqual(ours);
        }
      }
    }
  });

  it('変拍子 (R3): 拍子から作った拍をビートとして渡すと、plan のビートがそれになり、行の中のカットの切れ目もその拍に乗る', () => {
    // 7/8 (2+2+3)、1 小節 1.75 秒 → 拍は 0.5・0.5・0.75 秒の不規則な間隔
    const rhythm = { enabled: true, bars: [2, 3.75, 5.5, 7.25, 9, 10.75, 12.5], meters: [{ bar: 0, pattern: '2+2+3' }] };
    const grid = motionRhythmGrid(rhythm)!;
    const lyrics = {
      ...defaultLyrics(),
      text: 'ながいながい一行目の歌詞を/ここで/細かく/区切って/見せる\nもうひとつの/長い行を/たくさんの/カットに/分けて',
      motion: { ...defaultLyrics().motion, density: 1 },
      timing: { ...defaultLyrics().timing, lineTimes: { '0': 2, '1': 7.25 }, lineEnds: { '0': 7.1, '1': 14 } },
    };
    const project = buildJizuraProject(lyrics, J.defaultProject(), { seed: 7, aspect: '16:9', fps: 30 });
    const audio = { duration: 16, beats: grid.beats, energy: new Float32Array(16 * 60), energyRate: 60 };
    const plan = attachRhythm(J.plan(project, audio), grid);
    expect(plan.beats).toEqual(grid.beats);
    const cuts = plan.cuts as { line: number; start: number }[];
    const inner = cuts.filter((c, i) => i > 0 && c.line >= 0 && cuts[i - 1]!.line === c.line).map((c) => c.start);
    expect(inner.length).toBeGreaterThan(2);
    // JIZURA は ±0.13 秒以内のビートへ寄せる: 近くに拍がある切れ目は、どれもちょうど拍の上にある
    for (const t of inner) {
      const nearest = Math.min(...grid.beats.map((b) => Math.abs(b - t)));
      if (nearest < 0.13) expect(nearest).toBeLessThan(1e-9);
    }
    expect(inner.some((t) => grid.beats.includes(t))).toBe(true);
    // plan に添えた小節の情報から、時刻の位置が分かる (5.5 秒 = 3 小節目の頭、6.6 秒 = 3 番目のまとまり)
    expect(planRhythmAt(plan, 5.5)).toMatchObject({ pulse: { bar: 2, group: 0, barHead: true } });
    expect(planRhythmAt(plan, 6.6)!.pulse.group).toBe(2);
    expect(planRhythmAt(plan, 1)).toBeNull();
  });

  it('変拍子パック (R4): 登録しても既存のスタイルのカット割りは 1 つも変わらず、変拍子用スタイル + 変拍子モードのときだけ使われる', () => {
    const rhythm = motionRhythmGrid({ enabled: true, bars: [2, 3.75, 5.5, 7.25, 9, 10.75, 12.5, 14.25], meters: [{ bar: 0, pattern: '2+2+3' }] })!;
    const text = Array.from({ length: 8 }, (_, i) => `${i + 1}行目の/歌詞を/ここで/区切る`).join('\n');
    const lineTimes = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(i), 2 + i * 1.75]));
    const lyricsOf = (style: string) => ({
      ...defaultLyrics(),
      text,
      motion: { ...defaultLyrics().motion, style, density: 0.8, decor: 1, motion: 1 },
      timing: { ...defaultLyrics().timing, lineTimes },
    });
    const audio = { duration: 18, beats: rhythm.beats, energy: new Float32Array(18 * 60), energyRate: 60 };
    const planOf = (style: string, withRhythm: boolean) => {
      const lyrics = lyricsOf(style);
      const grid = withRhythm ? rhythm : null;
      const project = buildJizuraProject(lyrics, J.defaultProject(), { seed: 11, aspect: '16:9', fps: 30, oddMeter: usesOddMeterPack(lyrics.motion, grid) });
      return JSON.stringify(J.plan(project, audio));
    };
    expect((J as unknown as PackApi).__zunzunOddMeter).toBeFalsy();
    const before = ['noir', 'crimson'].map((s) => planOf(s, true));
    registerOddMeterPack(J as unknown as PackApi);
    expect(['noir', 'crimson'].map((s) => planOf(s, true))).toEqual(before);

    type Cut = { hold?: string; cam?: string; decor?: { id: string }[] };
    const used = (json: string) => {
      const cuts = JSON.parse(json).cuts as Cut[];
      return {
        hold: cuts.filter((c) => c.hold === 'zzGroupPulse').length,
        cam: cuts.filter((c) => c.cam === 'zzBarPunch').length,
        decor: cuts.filter((c) => c.decor?.some((d) => d.id === 'zzMeterBar')).length,
        fourBeat: cuts.filter((c) => c.hold === 'windGust' || c.hold === 'pluckString').length,
        cuts: cuts.length,
      };
    };
    const odd = used(planOf(ODD_METER_STYLE_KEY, true));
    expect(odd.hold).toBeGreaterThan(0);
    expect(odd.cam).toBeGreaterThan(0);
    expect(odd.decor).toBeGreaterThan(0);
    expect(odd.fourBeat).toBe(0);
    // 変拍子用スタイルでも、変拍子モードがオフなら使わない
    expect(used(planOf(ODD_METER_STYLE_KEY, false))).toMatchObject({ hold: 0, cam: 0, decor: 0 });
  });
});

