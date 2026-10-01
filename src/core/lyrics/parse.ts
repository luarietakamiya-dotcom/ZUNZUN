import type { LyricsSource } from '../types';

/**
 * 歌詞のパーサ。
 *
 * parseLyrics は 852wa/JIZURA (MIT License, © 2026 hakoniwa, https://github.com/852wa/JIZURA)
 * src/08_planner.js の `J.parseLyrics` を TypeScript に移植したもの (commit 8da975f 時点)。
 * 行番号 (= Project JSON の lyrics.timing.lineTimes のキー) が JIZURA とずれないよう、処理の順序と条件は変えていない。
 * SRT の読み込み (srtToLrc) は ZUNZUN で新規に書いた。JIZURA は SRT を扱わないため、LRC に変換してから渡す。
 *
 * 記法 (JIZURA と同じ):
 * - 1 行 = 1 行の歌詞。空行は「間を空ける」(gapBefore)。`#` で始まる行はコメント
 * - `[mm:ss.xx]` = LRC のタイムタグ (複数付けると同じ歌詞を繰り返す)。`[ti:…]` `[ar:…]` などはメタ情報
 * - `[間奏]` `[間奏 8]` = 歌詞なしの区間 (8 秒)。`[interlude]` `[inst]` `[간주]` なども可
 * - `歌詞|注釈` = 注釈、`*強調*` = 強調、行末の `!` = キメ、`/` = 手動の区切り
 * ZUNZUN で足した記法 (JIZURA に渡す前に stripBracketNotes で取り除く):
 * - `[Verse 1]` `[サビ]` のような [ ] で囲んだ所 (タイムタグ・メタ情報・間奏を除く) は書かなかったのと同じ。
 *   行が [ ] だけなら空行と同じ (間を空ける)
 */

export interface LyricLine {
  /** 表示する歌詞 (記号を取り除いたもの)。間奏の行は '' */
  text: string;
  /** 元の入力の何行目 (0 始まり) から来たか */
  src: number;
  /** LRC のタイムタグの時刻 (秒)。タグが無ければ null */
  lrc: number | null;
  interlude: boolean;
  /** 間奏の長さ (秒)。指定が無ければ null */
  secs: number | null;
  note: string | null;
  impact: boolean;
  emph: string[];
  manual: string[] | null;
  gapBefore: boolean;
}

export interface ParsedLyrics {
  lines: LyricLine[];
  meta: Record<string, string>;
}

const TIME_TAG = /^\[(\d+):(\d+(?:[.:]\d+)?)\]/;
const META_TAG = /^\[(ti|ar|al|by|offset):(.*)\]$/i;
const INTERLUDE = /^\[\s*(間奏|间奏|interlude|instrumental|inst|간주)(?:\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|秒|초)?)?\s*\]$/i;

/**
 * [ ] で囲んだ所を取り除く (歌詞サイトや作曲ツールの「[Verse]」「[Chorus]」などの見出し)。
 * 行の頭のタイムタグ・メタ情報 (`[ti:…]`)・間奏 (`[間奏]`) はそのまま残す。[ ] だけの行は空行にする。
 * JIZURA に渡す文 (lyricsForEngine) と行の読み取り (parseLyricsSource) の両方に通すので、行番号はずれない
 */
export function stripBracketNotes(raw: string): string {
  return String(raw || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((row) => {
      const s0 = row.trim();
      if (!s0 || s0.startsWith('#') || META_TAG.test(s0)) return row;
      let tags = '';
      let s = s0;
      let m: RegExpMatchArray | null;
      while ((m = s.match(TIME_TAG))) {
        tags += m[0];
        s = s.slice(m[0].length);
      }
      s = s.trim();
      if (INTERLUDE.test(s) || !s.includes('[')) return row;
      const rest = s.replace(/\[[^\]]*\]/g, ' ').replace(/\s{2,}/g, ' ').trim();
      return rest ? tags + rest : '';
    })
    .join('\n');
}

export function parseLyrics(raw: string): ParsedLyrics {
  const lines: LyricLine[] = [];
  const meta: Record<string, string> = {};
  let pendingGap = false;
  const rows = String(raw || '').replace(/\r/g, '').split('\n');
  for (let ri = 0; ri < rows.length; ri++) {
    const s0 = rows[ri]!.trim();
    if (!s0) {
      if (lines.length) pendingGap = true;
      continue;
    }
    if (s0.startsWith('#')) continue;
    const mm = s0.match(META_TAG);
    if (mm) {
      meta[mm[1]!.toLowerCase()] = mm[2]!.trim();
      continue;
    }
    let s = s0;
    const times: number[] = [];
    let m: RegExpMatchArray | null;
    while ((m = s.match(TIME_TAG))) {
      times.push(+m[1]! * 60 + parseFloat(m[2]!.replace(':', '.')));
      s = s.slice(m[0].length);
    }
    s = s.trim();

    const im = s.match(INTERLUDE);
    if (im) {
      const base = {
        text: '',
        interlude: true,
        secs: im[2] ? parseFloat(im[2]) : null,
        note: null,
        impact: false,
        emph: [],
        manual: null,
        gapBefore: pendingGap,
        src: ri,
      };
      pendingGap = false;
      if (times.length) for (const t of times) lines.push({ ...base, emph: [], lrc: t });
      else lines.push({ ...base, lrc: null });
      continue;
    }

    let note: string | null = null;
    const bar = s.indexOf('|');
    if (bar >= 0) {
      note = s.slice(bar + 1).trim() || null;
      s = s.slice(0, bar).trim();
    }
    let impact = false;
    // JIZURA と同じ条件 (全角の「！」はキメにしない)
    if (/[!！]$/.test(s) && s.length > 1 && /!$/.test(s)) {
      impact = true;
      s = s.slice(0, -1).trim();
    }
    const emph: string[] = [];
    s = s.replace(/\*([^*]+)\*/g, (_, w: string) => {
      emph.push(w);
      return w;
    });
    let manual: string[] | null = null;
    if (s.includes('/')) {
      manual = s
        .split('/')
        .map((x) => x.trim())
        .filter(Boolean);
      const latin = manual.some((x) => /[A-Za-z]/.test(x));
      s = manual.join(latin ? ' ' : '');
    }
    if (!s) continue;
    const base = { text: s, interlude: false, secs: null, note, impact, emph, manual, gapBefore: pendingGap, src: ri };
    pendingGap = false;
    if (times.length) for (const t of times) lines.push({ ...base, lrc: t });
    else lines.push({ ...base, lrc: null });
  }
  if (lines.some((l) => l.lrc != null)) lines.sort((a, b) => (a.lrc ?? 1e9) - (b.lrc ?? 1e9));
  return { lines, meta };
}

// ------------------------------------------------------------------ SRT

interface SrtEntry {
  start: number;
  end: number;
  text: string;
}

const SRT_TIME = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

const srtSeconds = (h: string, m: string, s: string, ms: string): number => +h * 3600 + +m * 60 + +s + +ms.padEnd(3, '0') / 1000;

function parseSrtEntries(raw: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const blocks = String(raw || '')
    .replace(/^\s+/, '') // 先頭の BOM (U+FEFF) と空白を取り除く (JS の \s は U+FEFF を含む)
    .replace(/\r/g, '')
    .split(/\n\s*\n/);
  for (const block of blocks) {
    const rows = block.split('\n');
    const ti = rows.findIndex((r) => SRT_TIME.test(r));
    if (ti < 0) continue;
    const m = rows[ti]!.match(SRT_TIME)!;
    const start = srtSeconds(m[1]!, m[2]!, m[3]!, m[4]!);
    const end = srtSeconds(m[5]!, m[6]!, m[7]!, m[8]!);
    // 字幕の中の改行は JIZURA の手動区切り `/` にする (区切りの位置で文字のまとまりが分かれる)
    const text = rows
      .slice(ti + 1)
      .map((r) => r.replace(/<[^>]*>/g, '').trim())
      .filter(Boolean)
      .join('/');
    if (!text) continue;
    entries.push({ start, end: Math.max(start, end), text });
  }
  entries.sort((a, b) => a.start - b.start);
  return entries;
}

const lrcTag = (t: number): string => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `[${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}]`;
};

/** SRT を、JIZURA が読める LRC テキストに変換する。ends は変換後の LRC の各行 (入力の行番号順) の終了時刻。 */
export function srtToLrc(raw: string): { text: string; ends: number[] } {
  const entries = parseSrtEntries(raw);
  return {
    text: entries.map((e) => lrcTag(e.start) + e.text).join('\n'),
    ends: entries.map((e) => e.end),
  };
}

/** 入力形式に関係なく、JIZURA (と parseLyrics) に渡す歌詞テキストにする。 */
export function lyricsForEngine(text: string, source: LyricsSource): string {
  return stripBracketNotes(source === 'srt' ? srtToLrc(text).text : text);
}

/**
 * 入力形式に合わせて歌詞を読む。SRT のときは、字幕ごとの終了時刻を行番号順に並べた srtEnds も返す
 * (読み込み直後の lineEnds の初期値に使える)。
 */
export function parseLyricsSource(text: string, source: LyricsSource): ParsedLyrics & { srtEnds: number[] | null } {
  if (source !== 'srt') return { ...parseLyrics(stripBracketNotes(text)), srtEnds: null };
  const converted = srtToLrc(text);
  const parsed = parseLyrics(stripBracketNotes(converted.text));
  // line.src は変換後の LRC の行番号 = SRT の字幕の番号 (並べ替え後)
  return { ...parsed, srtEnds: parsed.lines.map((l) => converted.ends[l.src] ?? l.lrc ?? 0) };
}
