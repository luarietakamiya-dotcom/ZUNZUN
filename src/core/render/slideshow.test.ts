import { describe, expect, it } from 'vitest';
import type { Section } from '../lyrics/sections';
import { barGrid, slideAt, slideSchedule } from './slideshow';

/** 120 BPM (1 拍 0.5 秒、1 小節 2 秒) の拍 */
const beats120 = (duration: number): number[] => Array.from({ length: Math.floor(duration / 0.5) }, (_, i) => i * 0.5);
const sec = (kind: Section['kind'], start: number, end: number): Section => ({ kind, label: kind, start, end });
/** 切り替えの間隔 (秒) を区切りごとに */
const gaps = (cues: { t: number }[], from: number, to: number): number[] => {
  const ts = cues.map((c) => c.t).filter((t) => t >= from && t < to);
  return ts.slice(1).map((t, i) => +(t - ts[i]!).toFixed(3));
};

describe('barGrid (小節の頭)', () => {
  it('拍を 4 つずつ。前後は同じ長さで 0 秒から曲の終わりまで埋める', () => {
    const g = barGrid(
      Array.from({ length: 20 }, (_, i) => 1 + i * 0.5),
      null,
      14,
    );
    expect(g.slice(0, 4)).toEqual([0, 1, 3, 5]);
    expect(g[g.length - 1]).toBeLessThan(14);
    expect(g[g.length - 1]).toBeGreaterThan(11);
  });
  it('0 秒のすぐ近くの小節の頭は 0 秒と重ねる (曲の頭で 2 回切り替わらない)', () => {
    const g = barGrid(
      Array.from({ length: 20 }, (_, i) => 0.3 + i * 0.5),
      null,
      12,
    );
    expect(g[0]).toBe(0);
    expect(g[1]).toBeCloseTo(2.3, 9);
  });
  it('変拍子モードの小節があればそれ、拍が無ければ 2 秒ごと', () => {
    expect(barGrid(beats120(20), [0, 1.75, 3.5, 5.25], 6).slice(0, 4)).toEqual([0, 1.75, 3.5, 5.25]);
    expect(barGrid([], null, 7)).toEqual([0, 2, 4, 6]);
  });
});

describe('slideSchedule (切り替え表)', () => {
  const grid = barGrid(beats120(120), null, 120);

  it('0 枚なら空、1 枚なら最初から最後まで同じ画像', () => {
    expect(slideSchedule({ names: [], sections: [], grid, duration: 120, pace: 0.5 })).toEqual([]);
    expect(slideSchedule({ names: ['a.jpg'], sections: [], grid, duration: 120, pace: 0.5 })).toEqual([{ t: 0, index: 0, kind: 'other' }]);
  });

  it('小節の頭で切り替え、枚数が多いほど速い (8 小節より遅く、1 小節より速くはしない)', () => {
    const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${String(i).padStart(2, '0')}.jpg`);
    const few = slideSchedule({ names: names(3), sections: [], grid, duration: 120, pace: 0.5 });
    const many = slideSchedule({ names: names(40), sections: [], grid, duration: 120, pace: 0.5 });
    const huge = slideSchedule({ names: names(100), sections: [], grid, duration: 120, pace: 0.5 });
    for (const cues of [few, many, huge]) for (const c of cues) expect(Math.abs(c.t / 2 - Math.round(c.t / 2))).toBeLessThan(1e-9);
    expect(Math.min(...gaps(few, 0, 120))).toBe(16); // 8 小節
    expect(Math.max(...gaps(many, 0, 120))).toBeLessThanOrEqual(4);
    expect(Math.min(...gaps(huge, 0, 120))).toBe(2); // 1 小節
    // 多いときは全部の画像が出る
    expect(new Set(many.map((c) => c.index)).size).toBe(40);
  });

  it('区切りの頭では必ず切り替え (近い小節の頭にそろえる)。サビは速く、イントロはゆっくり', () => {
    const sections = [sec('intro', 0, 16.3), sec('verse', 16.3, 48.2), sec('chorus', 48.2, 80), sec('outro', 80, 120)];
    const names = Array.from({ length: 12 }, (_, i) => `p${i}.jpg`);
    const cues = slideSchedule({ names, sections, grid, duration: 120, pace: 0.5 });
    for (const t of [0, 16, 48, 80]) expect(cues.some((c) => c.t === t), String(t)).toBe(true);
    const intro = Math.min(...gaps(cues, 0, 16).concat([16]));
    const verse = Math.min(...gaps(cues, 16, 48));
    const chorus = Math.min(...gaps(cues, 48, 80));
    expect(chorus).toBeLessThan(verse);
    expect(intro).toBeGreaterThanOrEqual(verse);
  });

  it('切り替えごとに、その画像が出る区切りの種類を覚えている (画像の動きの強さに使う)', () => {
    const sections = [sec('intro', 0, 16.3), sec('verse', 16.3, 48.2), sec('chorus', 48.2, 80), sec('outro', 80, 120)];
    const names = Array.from({ length: 12 }, (_, i) => `p${i}.jpg`);
    const cues = slideSchedule({ names, sections, grid, duration: 120, pace: 0.5 });
    for (const c of cues) {
      const want = c.t < 16 ? 'intro' : c.t < 48 ? 'verse' : c.t < 80 ? 'chorus' : 'outro';
      expect(c.kind, String(c.t)).toBe(want);
    }
  });

  it('「切り替えの細かさ」を上げると速く、下げると遅く', () => {
    const names = Array.from({ length: 10 }, (_, i) => `p${i}.jpg`);
    const count = (pace: number): number => slideSchedule({ names, sections: [], grid, duration: 120, pace }).length;
    expect(count(1)).toBeGreaterThan(count(0.5));
    expect(count(0)).toBeLessThan(count(0.5));
  });

  it('ファイル名に区切りの言葉がある画像は、その区切りだけで出す。言葉の無い画像は、ほかの区切りで出す', () => {
    const names = ['[サビ]_01.jpg', 'サビ_02.jpg', '街.jpg', '空.jpg', 'intro-sky.png'];
    const sections = [sec('intro', 0, 16), sec('verse', 16, 48), sec('chorus', 48, 80), sec('verse', 80, 120)];
    const cues = slideSchedule({ names, sections, grid, duration: 120, pace: 0.5 });
    const shown = (from: number, to: number): Set<number> => new Set(cues.filter((c) => c.t >= from && c.t < to).map((c) => c.index));
    expect([...shown(0, 16)]).toEqual([4]);
    expect([...shown(16, 48)].every((i) => i === 2 || i === 3)).toBe(true);
    expect([...shown(48, 80)].every((i) => i === 0 || i === 1)).toBe(true);
    expect(shown(48, 80).size).toBe(2);
    expect([...shown(80, 120)].every((i) => i === 2 || i === 3)).toBe(true);
    // 続けて同じ画像にはしない
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.index).not.toBe(cues[i - 1]!.index);
  });

  it('ユーザーが決めた区切り (kinds) は、ファイル名の言葉より優先する。決めていない画像はファイル名の言葉で', () => {
    // a, b: ファイル名に言葉は無いが、サビ・イントロの入れ場所に入れた。c: 名前は「サビ」だがイントロの入れ場所に入れた。d: 指定なし (名前の言葉もなし)
    const names = ['a.jpg', 'b.jpg', 'サビ.jpg', 'd.jpg', 'intro-x.png'];
    const kinds = ['chorus', 'chorus', 'intro', undefined, undefined] as const;
    const sections = [sec('intro', 0, 16), sec('verse', 16, 48), sec('chorus', 48, 80), sec('verse', 80, 120)];
    const cues = slideSchedule({ names, kinds, sections, grid, duration: 120, pace: 0.5 });
    const shown = (from: number, to: number): Set<number> => new Set(cues.filter((c) => c.t >= from && c.t < to).map((c) => c.index));
    // イントロ: 入れ場所のイントロ (2) と、名前にイントロの言葉がある指定なしの画像 (4)
    expect([...shown(0, 16)].every((i) => i === 2 || i === 4)).toBe(true);
    // サビ: 入れ場所のサビ (0, 1)。名前が「サビ」でもイントロに入れた画像 (2) は出ない
    expect([...shown(48, 80)].sort()).toEqual([0, 1]);
    // Aメロ: 専用の画像が無いので、区切りが決まっていない画像 (3) だけ (決まっている画像は出ない)
    expect([...shown(16, 48)]).toEqual([3]);
  });

  it('同じ入力なら同じ表 (乱数を使わない)。拍が無い曲は 2 秒ごとの区切りで', () => {
    const names = ['a.jpg', 'b.jpg', 'c.jpg'];
    const a = slideSchedule({ names, sections: [], grid: barGrid([], null, 60), duration: 60, pace: 0.5 });
    const b = slideSchedule({ names, sections: [], grid: barGrid([], null, 60), duration: 60, pace: 0.5 });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(1);
  });
});

describe('slideAt', () => {
  it('今の画像・ひとつ前の画像・切り替えてからの秒数', () => {
    const cues = [
      { t: 0, index: 0 },
      { t: 4, index: 2 },
      { t: 8, index: 1 },
    ];
    expect(slideAt(cues, 1)).toEqual({ index: 0, prev: -1, since: 1, cue: 0 });
    expect(slideAt(cues, 5)).toEqual({ index: 2, prev: 0, since: 1, cue: 1 });
    expect(slideAt(cues, 8)).toEqual({ index: 1, prev: 2, since: 0, cue: 2 });
    expect(slideAt([], 3).index).toBe(-1);
  });
});
