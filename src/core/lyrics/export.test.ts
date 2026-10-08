import { describe, expect, it } from 'vitest';
import { defaultLyrics } from '../types';
import { lrcTime, lyricsToLrc, lyricsToSrt, srtTime } from './export';
import { parseLyricsSource } from './parse';
import { buildLyricsView } from './view';

const lyricsOf = (text: string, lineTimes: Record<string, number>, lineEnds: Record<string, number> = {}) => {
  const l = defaultLyrics();
  l.text = text; l.timing = { ...l.timing, lineTimes, lineEnds };
  return l;
};

describe('歌詞の書き出し (SRT / LRC)', () => {
  it('時刻の書式: 繰り上げ・ゼロ詰め', () => {
    expect(srtTime(0)).toBe('00:00:00,000'); expect(srtTime(3661.2345)).toBe('01:01:01,235'); expect(srtTime(59.9996)).toBe('00:01:00,000');
    expect(lrcTime(0)).toBe('[00:00.00]'); expect(lrcTime(75.456)).toBe('[01:15.46]'); expect(lrcTime(59.999)).toBe('[01:00.00]'); expect(srtTime(-1)).toBe('00:00:00,000');
  });

  it('SRT: 歌詞のある行だけ。間奏と見出しは出ない。手動の改行は字幕の改行', () => {
    const view = buildLyricsView(lyricsOf('[Intro]\n夜明けの色を/覚えてる\n\n[間奏 8]\n光の向こうへ', { '0': 1, '2': 12.5 }, { '0': 4, '2': 15 }));
    const srt = lyricsToSrt(view);
    expect(srt).toBe('1\n00:00:01,000 --> 00:00:04,000\n夜明けの色を\n覚えてる\n\n2\n00:00:12,500 --> 00:00:15,000\n光の向こうへ\n');
    expect(srt).not.toMatch(/Intro|間奏/);
  });

  it('LRC: 開始時刻だけ。改行は / でつなぐ', () => {
    const view = buildLyricsView(lyricsOf('夜明けの色を/覚えてる\n光の向こうへ', { '0': 1, '1': 12.5 }, { '0': 4, '1': 15 }));
    expect(lyricsToLrc(view)).toBe('[00:01.00]夜明けの色を/覚えてる\n[00:12.50]光の向こうへ');
  });

  it('SRT を書き出して読み直すと、時刻・終了・本文（改行は / ）が戻る', () => {
    const view = buildLyricsView(lyricsOf('止まらない/鼓動が\n夜を切り裂いて\n高く叫べ', { '0': 2.25, '1': 5.5, '2': 9 }, { '0': 5, '1': 8.75, '2': 11.5 }));
    const back = parseLyricsSource(lyricsToSrt(view), 'srt');
    expect(back.lines.map((l) => l.lrc)).toEqual([2.25, 5.5, 9]);
    expect(back.srtEnds).toEqual([5, 8.75, 11.5]);
    expect(back.lines.map((l) => l.text)).toEqual(['止まらない鼓動が', '夜を切り裂いて', '高く叫べ']);
    expect(back.lines[0]!.manual).toEqual(['止まらない', '鼓動が']);
  });

  it('歌詞が空なら空の文字列', () => {
    expect(lyricsToSrt(buildLyricsView(defaultLyrics()))).toBe('');
    expect(lyricsToLrc(buildLyricsView(defaultLyrics()))).toBe('');
  });
});
