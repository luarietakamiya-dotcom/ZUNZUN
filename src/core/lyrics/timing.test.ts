import { describe, expect, it } from 'vitest';
import { parseLyrics } from './parse';
import { computeLineTimes, lineAt, MIN_LINE_DURATION } from './timing';

const none = { lineTimes: {}, lineEnds: {} };

describe('computeLineTimes (JIZURA の J.computeTiming と同じ規則 + lineEnds)', () => {
  it('タイムタグが無ければ文字数から見積もる (1 行目は offset)', () => {
    const parsed = parseLyrics('あいうえお\nかきくけこさしすせそ');
    const { starts, ends } = computeLineTimes(parsed, none);
    expect(starts[0]).toBeCloseTo(0.4);
    // 5 文字 → clamp(0.8 + 5 * 0.17, 1.3, 5.2) = 1.65 秒
    expect(starts[1]).toBeCloseTo(0.4 + 1.65);
    expect(ends[0]).toBeCloseTo(starts[1]!);
    // 最後の行: clamp(0.8 + 10 * 0.17, 1.5, 5.2) = 2.5 秒
    expect(ends[1]).toBeCloseTo(starts[1]! + 2.5);
  });

  it('BPM があれば見積もりをビートの整数倍 (最低 2 拍) にそろえ、空行でさらに 2 拍あける', () => {
    const parsed = parseLyrics('あいうえお\n\nかきくけこ');
    const { starts } = computeLineTimes(parsed, none, { bpm: 120, offset: 0 });
    // 1.65 秒 → 0.5 秒拍で 3 拍 = 1.5 秒、空行で +1 秒
    expect(starts[1]).toBeCloseTo(2.5);
  });

  it('すべての行に LRC のタグがあればタグの時刻、手で決めた時刻はそれより優先', () => {
    const parsed = parseLyrics('[00:01.00]a\n[00:05.00]b\n[00:09.00]c');
    expect(computeLineTimes(parsed, none).starts).toEqual([1, 5, 9]);
    expect(computeLineTimes(parsed, { lineTimes: { '1': 6.5 }, lineEnds: {} }).starts).toEqual([1, 6.5, 9]);
  });

  it('タグの無い行が混ざると、タグは使わずに見積もる (JIZURA と同じ)', () => {
    const parsed = parseLyrics('[00:10.00]a\nb');
    expect(computeLineTimes(parsed, none).starts[0]).toBeCloseTo(0.4);
  });

  it('間奏は指定の秒数 (無ければ 4 秒) の長さ', () => {
    const parsed = parseLyrics('[間奏 8]\n[間奏]\nx');
    const { starts } = computeLineTimes(parsed, none, { offset: 0 });
    expect(starts).toEqual([0, 8, 12]);
  });

  it('lineEnds で行を早く終わらせられるが、次の行より後ろには伸びず、最短の長さは保つ', () => {
    const parsed = parseLyrics('[00:01.00]a\n[00:05.00]b\n[00:09.00]c');
    const { ends } = computeLineTimes(parsed, { lineTimes: {}, lineEnds: { '0': 3, '1': 20, '2': 9.1 } });
    expect(ends[0]).toBe(3);
    expect(ends[1]).toBe(9);
    expect(ends[2]).toBeCloseTo(9 + MIN_LINE_DURATION);
  });

  it('全体の長さは最後の行 + 余白、音源があれば音源の長さ以上', () => {
    const parsed = parseLyrics('[00:01.00]a\n[00:05.00]b');
    const noAudio = computeLineTimes(parsed, none);
    expect(noAudio.duration).toBeCloseTo(noAudio.ends[1]! + 0.9);
    expect(computeLineTimes(parsed, none, { audioDuration: 180 }).duration).toBe(180);
  });

  it('壊れた lineTimes の値 (NaN) は無視する', () => {
    const parsed = parseLyrics('[00:01.00]a\n[00:05.00]b');
    expect(computeLineTimes(parsed, { lineTimes: { '0': Number.NaN }, lineEnds: {} }).starts).toEqual([1, 5]);
  });
});

describe('lineAt', () => {
  it('時刻に表示中の行を返し、行の外なら -1', () => {
    const times = { starts: [1, 5, 9], ends: [3, 9, 12] };
    expect(lineAt(times, 0.5)).toBe(-1);
    expect(lineAt(times, 1)).toBe(0);
    expect(lineAt(times, 4)).toBe(-1);
    expect(lineAt(times, 8.99)).toBe(1);
    expect(lineAt(times, 9)).toBe(2);
    expect(lineAt(times, 12)).toBe(-1);
  });

  it('手で決めた時刻が順番どおりでなくても、開始が最も遅い行を返す', () => {
    const times = { starts: [5, 1], ends: [8, 7] };
    expect(lineAt(times, 2)).toBe(1);
    expect(lineAt(times, 6)).toBe(0);
  });
});
