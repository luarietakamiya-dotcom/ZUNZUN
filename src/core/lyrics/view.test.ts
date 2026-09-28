import { describe, expect, it } from 'vitest';
import type { AudioAnalysis } from '../audio/analyze';
import { defaultLyrics, type LyricsSettings } from '../types';
import { buildLyricsView, syncTargetsFor } from './view';

const lyrics = (o: Partial<LyricsSettings> & { lineTimes?: Record<string, number>; lineEnds?: Record<string, number> }): LyricsSettings => {
  const base = defaultLyrics();
  return {
    ...base,
    ...o,
    timing: { ...base.timing, lineTimes: o.lineTimes ?? {}, lineEnds: o.lineEnds ?? {} },
  };
};

describe('buildLyricsView', () => {
  it('行の開始の由来: 手で決めた時刻 > LRC のタグ (全行にあるとき) > 見積もり', () => {
    const lrc = buildLyricsView(lyrics({ source: 'lrc', text: '[00:01.00]a\n[00:05.00]b', lineTimes: { '1': 6 } }));
    expect(lrc.startSource).toEqual(['lrc', 'manual']);
    expect(lrc.times.starts).toEqual([1, 6]);
    const text = buildLyricsView(lyrics({ text: 'a\nb', lineTimes: { '0': 2 } }));
    expect(text.startSource).toEqual(['manual', 'estimate']);
  });

  it('終了を手で決めた行と、音源の長さを反映する', () => {
    const v = buildLyricsView(lyrics({ source: 'lrc', text: '[00:01.00]a\n[00:05.00]b', lineEnds: { '0': 3 } }), 200);
    expect(v.endManual).toEqual([true, false]);
    expect(v.times.ends[0]).toBe(3);
    expect(v.times.duration).toBe(200);
  });

  it('SRT は字幕の終了時刻も返す', () => {
    const v = buildLyricsView(lyrics({ source: 'srt', text: '1\n00:00:01,000 --> 00:00:02,500\nあ' }));
    expect(v.parsed.srtEnds).toEqual([2.5]);
    expect(v.startSource).toEqual(['lrc']);
  });

  it('歌詞が空でも落ちない', () => {
    const v = buildLyricsView(lyrics({ text: '' }));
    expect(v.parsed.lines).toEqual([]);
    expect(v.startSource).toEqual([]);
  });
});

describe('syncTargetsFor', () => {
  it('解析結果ごとに一度だけ計算し、ビートは昇順にそろえる', () => {
    const vocal = new Float32Array(240).fill(0.1);
    for (let f = 60; f < 90; f++) vocal[f] = 0.8;
    const analysis = { vocalLikeness: vocal, frameRate: 60, beats: [2, 0.5, 1] } as unknown as AudioAnalysis;
    const a = syncTargetsFor(analysis);
    expect(syncTargetsFor(analysis)).toBe(a);
    expect(a.beats).toEqual([0.5, 1, 2]);
    expect(a.candidates).toHaveLength(1);
    expect(Math.abs(a.candidates[0]! - 1)).toBeLessThan(0.05);
  });
});
