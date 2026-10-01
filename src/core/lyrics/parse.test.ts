import { describe, expect, it } from 'vitest';
import { lyricsForEngine, parseLyrics, parseLyricsSource, srtToLrc, stripBracketNotes } from './parse';

describe('parseLyrics (JIZURA の J.parseLyrics と同じ規則)', () => {
  it('1 行 = 1 行。空行は次の行の gapBefore、# はコメント', () => {
    const { lines } = parseLyrics('夜明けの色を\n# コメント\n\nほどけた声が\n');
    expect(lines.map((l) => l.text)).toEqual(['夜明けの色を', 'ほどけた声が']);
    expect(lines.map((l) => l.gapBefore)).toEqual([false, true]);
    expect(lines.map((l) => l.src)).toEqual([0, 3]);
    expect(lines.every((l) => l.lrc === null && !l.interlude)).toBe(true);
  });

  it('/ は手動の区切り (日本語は詰め、英字を含むと空白で結ぶ)。/ だけの行は捨てる', () => {
    const { lines } = parseLyrics('夜明けの/色を\nhello/world\n / ');
    expect(lines).toHaveLength(2);
    expect(lines[0]!.text).toBe('夜明けの色を');
    expect(lines[0]!.manual).toEqual(['夜明けの', '色を']);
    expect(lines[1]!.text).toBe('hello world');
  });

  it('*強調*・行末の ! (半角のみ)・| の注釈', () => {
    const { lines } = parseLyrics('*透明*なままじゃ終われない!\n叫べ！\n歌詞|ちゅうしゃく');
    expect(lines[0]!.text).toBe('透明なままじゃ終われない');
    expect(lines[0]!.emph).toEqual(['透明']);
    expect(lines[0]!.impact).toBe(true);
    expect(lines[1]!.text).toBe('叫べ！');
    expect(lines[1]!.impact).toBe(false);
    expect(lines[2]!.text).toBe('歌詞');
    expect(lines[2]!.note).toBe('ちゅうしゃく');
  });

  it('LRC: タグの時刻で並べ替え、複数タグは同じ歌詞を繰り返す。メタ情報は meta へ', () => {
    const { lines, meta } = parseLyrics('[ti:タイトル]\n[ar:うた]\n[00:10.50]二行目\n[00:01.00][00:20:00]サビ');
    expect(meta).toEqual({ ti: 'タイトル', ar: 'うた' });
    expect(lines.map((l) => [l.text, l.lrc])).toEqual([
      ['サビ', 1],
      ['二行目', 10.5],
      ['サビ', 20],
    ]);
  });

  it('[間奏] [間奏 8] [inst:4s] は歌詞なしの行', () => {
    const { lines } = parseLyrics('[間奏]\n[間奏 8]\n[inst:4s]\n[간주]\n[間奏って]');
    expect(lines.slice(0, 4).map((l) => [l.interlude, l.secs, l.text])).toEqual([
      [true, null, ''],
      [true, 8, ''],
      [true, 4, ''],
      [true, null, ''],
    ]);
    // 間奏の記法に合わない [...] は普通の歌詞として扱う
    expect(lines[4]!.interlude).toBe(false);
    expect(lines[4]!.text).toBe('[間奏って]');
  });

  it('空や CRLF の入力でも落ちない', () => {
    expect(parseLyrics('').lines).toEqual([]);
    expect(parseLyrics('a\r\nb').lines.map((l) => l.text)).toEqual(['a', 'b']);
  });
});

/** 先頭の BOM (U+FEFF)。ファイルに直接書くと lint (no-irregular-whitespace) に引っかかるので文字コードから作る */
const BOM = String.fromCharCode(0xfeff);
const SRT = `${BOM}2
00:00:05,500 --> 00:00:08,000
<i>二番目の</i>
字幕

1
00:00:01,000 --> 00:00:03.25
最初の字幕

3
00:01:02,000 --> 00:01:04,000
`;

describe('SRT', () => {
  it('時刻順に並べ、字幕内の改行は / (手動の区切り) にし、タグを取り除いた LRC にする', () => {
    const { text, ends } = srtToLrc(SRT);
    expect(text).toBe('[00:01.000]最初の字幕\n[00:05.500]二番目の/字幕');
    expect(ends).toEqual([3.25, 8]);
  });

  it('parseLyricsSource は SRT の終了時刻を行番号順に返す', () => {
    const parsed = parseLyricsSource(SRT, 'srt');
    expect(parsed.lines.map((l) => [l.text, l.lrc])).toEqual([
      ['最初の字幕', 1],
      ['二番目の字幕', 5.5],
    ]);
    expect(parsed.srtEnds).toEqual([3.25, 8]);
  });

  it('1 時間を超える時刻も分に直す', () => {
    const { text } = srtToLrc('1\n01:02:03,004 --> 01:02:05,000\nlate');
    expect(text).toBe('[62:03.004]late');
    expect(parseLyrics(text).lines[0]!.lrc).toBeCloseTo(3723.004, 6);
  });

  it('lyricsForEngine: テキストと LRC はそのまま、SRT は LRC に変換', () => {
    expect(lyricsForEngine('a\nb', 'text')).toBe('a\nb');
    expect(lyricsForEngine('[00:01.00]a', 'lrc')).toBe('[00:01.00]a');
    expect(lyricsForEngine(SRT, 'srt')).toContain('[00:01.000]最初の字幕');
    expect(parseLyricsSource('a', 'text').srtEnds).toBeNull();
  });
});

describe('[ ] で囲んだ所 (見出しなど) は書かなかったのと同じ', () => {
  it('[ ] だけの行は空行と同じ (次の行の gapBefore)。行の中の [ ] は取り除く', () => {
    const { lines } = parseLyricsSource('[Verse 1]\n夜明けの色を\n[サビ]\nほどけた [ハモ] 声が\n[]', 'text');
    expect(lines.map((l) => l.text)).toEqual(['夜明けの色を', 'ほどけた 声が']);
    expect(lines.map((l) => l.gapBefore)).toEqual([false, true]);
    // 元の入力の行番号は変わらない
    expect(lines.map((l) => l.src)).toEqual([1, 3]);
  });

  it('タイムタグ・メタ情報・間奏はそのまま残る', () => {
    expect(stripBracketNotes('[ti:曲名]\n[00:01.00][Chorus]\n[00:02.00]歌詞[x]\n[間奏 8]')).toBe('[ti:曲名]\n\n[00:02.00]歌詞\n[間奏 8]');
    const { lines, meta } = parseLyricsSource('[ti:曲名]\n[00:01.00][Chorus]\n[00:02.00]歌詞\n[間奏 8]', 'lrc');
    expect(meta.ti).toBe('曲名');
    expect(lines.map((l) => [l.text, l.lrc, l.interlude])).toEqual([
      ['歌詞', 2, false],
      ['', null, true],
    ]);
  });

  it('JIZURA に渡す文も同じように取り除く (行番号がずれない)。SRT の [Music] だけの字幕も消える', () => {
    expect(lyricsForEngine('[Intro]\nあ', 'text')).toBe('\nあ');
    const srt = '1\n00:00:01,000 --> 00:00:02,000\n[Music]\n\n2\n00:00:03,000 --> 00:00:04,000\n歌う\n';
    expect(parseLyricsSource(srt, 'srt').lines.map((l) => l.text)).toEqual(['歌う']);
    expect(parseLyricsSource(srt, 'srt').srtEnds).toEqual([4]);
    expect(lyricsForEngine(srt, 'srt')).not.toContain('Music');
  });
});
