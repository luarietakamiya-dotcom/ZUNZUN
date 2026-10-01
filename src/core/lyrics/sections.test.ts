import { describe, expect, it } from 'vitest';
import { defaultLyrics, type LyricsSettings } from '../types';
import { findSections, sectionAt, sectionKindOf } from './sections';
import { buildLyricsView } from './view';

const sectionsOf = (text: string, lineTimes: Record<string, number> = {}, duration = 100, o: Partial<LyricsSettings> = {}) => {
  const lyrics: LyricsSettings = { ...defaultLyrics(), text, ...o, timing: { ...defaultLyrics().timing, lineTimes } };
  const view = buildLyricsView(lyrics, duration);
  return findSections(lyrics.text, lyrics.source, view.parsed.lines, view.times, duration);
};

describe('sectionKindOf (見出し・ファイル名の言葉)', () => {
  it('英語・日本語の見出しを見分ける。Pre-Chorus は Chorus より先、大文字小文字・全角は気にしない', () => {
    const cases: [string, string | null][] = [
      ['Intro', 'intro'],
      ['イントロ', 'intro'],
      ['Verse 1', 'verse'],
      ['Aメロ', 'verse'],
      ['Ａ メロ', 'verse'],
      ['Bメロ', 'prechorus'],
      ['Pre-Chorus', 'prechorus'],
      ['CHORUS', 'chorus'],
      ['サビ', 'chorus'],
      ['大サビ', 'chorus'],
      ['Hook', 'chorus'],
      ['Bridge', 'bridge'],
      ['Cメロ', 'bridge'],
      ['Guitar Solo', 'interlude'],
      ['間奏', 'interlude'],
      ['Outro', 'outro'],
      ['アウトロ', 'outro'],
      ['ハモ', null],
    ];
    for (const [text, kind] of cases) expect(sectionKindOf(text), text).toBe(kind);
  });

  it('ファイル名でも見分ける。英字の言葉は前後が英字でないときだけ (universe は verse ではない)', () => {
    expect(sectionKindOf('[サビ]_01.jpg')).toBe('chorus');
    expect(sectionKindOf('chorus_02.png')).toBe('chorus');
    expect(sectionKindOf('03-Intro.webp')).toBe('intro');
    expect(sectionKindOf('universe.jpg')).toBeNull();
    expect(sectionKindOf('droplet.png')).toBeNull();
    expect(sectionKindOf('街.jpg')).toBeNull();
  });
});

describe('findSections (歌詞の見出しから区切り)', () => {
  it('見出しが無ければ空', () => {
    expect(sectionsOf('あ\nい')).toEqual([]);
  });

  it('見出しのあとの最初の行から次の見出しまで。最後は曲の終わりまで。歌詞の無い最初の区切り (イントロ) は 0 秒から', () => {
    const s = sectionsOf('[Intro]\n\n[Verse 1]\nあ\nい\n[サビ]\nう\nえ\n[Outro]', { 0: 10, 1: 14, 2: 30, 3: 34 }, 100);
    expect(s.map((x) => [x.kind, x.label])).toEqual([
      ['intro', 'Intro'],
      ['verse', 'Verse 1'],
      ['chorus', 'サビ'],
      ['outro', 'Outro'],
    ]);
    expect(s[0]).toMatchObject({ start: 0, end: 10 });
    expect(s[1]).toMatchObject({ start: 10, end: 30 });
    expect(s[2]!.start).toBe(30);
    // 歌詞の無い最後の区切りは、前の歌詞の終わりから
    expect(s[3]!.start).toBeGreaterThan(34);
    expect(s[3]!.end).toBe(100);
    expect(s[2]!.end).toBe(s[3]!.start);
  });

  it('最初の見出しより前に歌詞があれば、0 秒から「その他」。見出しが最初の行なら 0 秒から始まる', () => {
    const a = sectionsOf('あ\n[Chorus]\nい', { 0: 5, 1: 20 }, 60);
    expect(a.map((x) => [x.kind, x.start, x.end])).toEqual([
      ['other', 0, 20],
      ['chorus', 20, 60],
    ]);
    const b = sectionsOf('[Verse]\nあ\n[Chorus]\nい', { 0: 5, 1: 20 }, 60);
    expect(b.map((x) => [x.kind, x.start])).toEqual([
      ['verse', 0],
      ['chorus', 20],
    ]);
  });

  it('[間奏] の行も区切りになる。LRC で見出しに時刻があればその時刻', () => {
    const s = sectionsOf('[00:01.00]あ\n[00:10.00][Chorus]\n[00:12.00]い\n[00:20.00][間奏]\n[00:30.00]う', {}, 40, { source: 'lrc' });
    expect(s.map((x) => [x.kind, x.start])).toEqual([
      ['other', 0],
      ['chorus', 10],
      ['interlude', 20],
    ]);
  });

  it('sectionAt で時刻からどの区切りかを引く', () => {
    const s = sectionsOf('[Verse]\nあ\n[Chorus]\nい', { 0: 5, 1: 20 }, 60);
    expect(sectionAt(s, 0)).toBe(0);
    expect(sectionAt(s, 19.9)).toBe(0);
    expect(sectionAt(s, 20)).toBe(1);
    expect(sectionAt(s, 60)).toBe(-1);
    expect(sectionAt([], 1)).toBe(-1);
  });
});
