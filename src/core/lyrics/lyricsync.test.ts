import { describe, expect, it } from 'vitest';
import { readLyricSyncResult } from './lyricsync';
import { parseLyrics, stripBracketNotes } from './parse';

const lines = parseLyrics(stripBracketNotes('[Intro]\n赤いライトが\n鼓動を撃った\n\n[間奏 8]\n夜を越えて')).lines;
// 0: 赤いライトが / 1: 鼓動を撃った / 2: 間奏 / 3: 夜を越えて

describe('LyricSync の結果の読み込み', () => {
  it('files.zunzun の形をそのまま読む。snap の設定は持ち込まない。間奏の行は時刻を付けない', () => {
    const r = readLyricSyncResult({ lineTimes: { '0': 1.2, '1': 3.4, '2': 5, '3': 14 }, lineEnds: { '0': 3, '1': 5, '3': 16 }, snap: true, snapWindowMs: 150 }, lines, 30);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.lineTimes).toEqual({ '0': 1.2, '1': 3.4, '3': 14 });
    expect(r.value.lineEnds).toEqual({ '0': 3, '1': 5, '3': 16 });
    expect(r.value.warnings).toEqual([]);
    expect(r.value).not.toHaveProperty('snap');
  });

  it('応答の JSON 全体（files.zunzun が文字列でも）と、自信の低い行（番号・行の status）を読む', () => {
    const res = { files: { zunzun: JSON.stringify({ lineTimes: { '0': 1, '1': 3, '3': 14 }, lineEnds: {} }) }, data: { review: [1, { line: 3 }, 99], lines: [{ text: '赤いライトが', status: 'ok' }, { text: '鼓動を撃った', status: 'low' }, { text: '夜を越えて', status: 'estimated' }] } };
    const r = readLyricSyncResult(res, lines);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.review).toEqual([1, 2, 3]);
  });

  it('行の数が違う・本文が違う・値がおかしい・形が違う、は取り込まない', () => {
    expect(readLyricSyncResult({ lineTimes: { '0': 1, '7': 9 } }, lines).ok).toBe(false);
    expect(readLyricSyncResult({ files: { zunzun: { lineTimes: { '0': 1 } } }, data: { lines: ['別の歌', '鼓動を撃った', '夜を越えて'] } }, lines).ok).toBe(false);
    expect(readLyricSyncResult({ lineTimes: { '0': -1 } }, lines).ok).toBe(false);
    expect(readLyricSyncResult({ lineTimes: { '0': 'x' } }, lines).ok).toBe(false);
    expect(readLyricSyncResult({ lineTimes: {} }, lines).ok).toBe(false);
    expect(readLyricSyncResult({ hello: 1 }, lines).ok).toBe(false);
    expect(readLyricSyncResult('text', lines).ok).toBe(false);
  });

  it('本文が間奏を含む数でも、含まない数でも照らし合わせる。表記ゆれ（空白・記号）は無視する', () => {
    expect(readLyricSyncResult({ files: { zunzun: { lineTimes: { '0': 1 } } }, data: { lines: ['赤いライトが', '鼓動を 撃った！', '', '夜を越えて'] } }, lines).ok).toBe(true);
    expect(readLyricSyncResult({ files: { zunzun: { lineTimes: { '0': 1 } } }, data: { lines: ['赤いライトが', '鼓動を撃った', '夜を越えて'] } }, lines).ok).toBe(true);
  });

  it('気をつける点: 時刻の順の入れ替わり・曲より後ろ・時刻の無い行。終わりは始まりより前にしない', () => {
    const r = readLyricSyncResult({ lineTimes: { '0': 5, '1': 3 }, lineEnds: { '0': 4 } }, lines, 4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.lineEnds['0']).toBe(5);
    expect(r.value.warnings.length).toBe(3);
  });
});
