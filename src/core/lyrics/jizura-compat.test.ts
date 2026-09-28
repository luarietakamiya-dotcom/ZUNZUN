import { beforeAll, describe, expect, it } from 'vitest';
import { installTimingPatch, type JizuraApi } from './jizura-adapter';
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
});
