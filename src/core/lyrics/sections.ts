import type { LyricsSource } from '../types';
import type { LyricLine } from './parse';
import { srtToLrc } from './parse';
import type { LineTimes } from './timing';

/**
 * 曲の区切り (セクション)。歌詞に書いた `[Intro]` `[サビ]` などの見出しから読む (2026-10-01 ユーザー案)。
 * 見出しは歌詞の行にはならない (parse.ts の stripBracketNotes で取り除く) が、ここでは区切りとして使う。
 * 使い道: 背景のスライドショー (区切りで切り替え、サビは速く、ファイル名の言葉でその区切りだけの画像)、
 * のちに歌詞の動き (サビは激しく、イントロは静か)。
 *
 * 区切りの時刻:
 * - 見出しのあとに歌詞があれば、その最初の行の始まり (LRC で見出しに時刻が付いていればその時刻)
 * - 歌詞の無い区切り (例: [Intro] のすぐあとに [Verse]) は、前の歌詞の終わり (最初なら 0 秒) から、次の区切りまで
 * - 最初の区切りより前に歌詞があれば、0 秒からを種類「その他」の区切りにする
 * - `[間奏]` `[inst]` など (JIZURA の間奏の行) も、種類「間奏」の区切りにする
 */

export type SectionKind = 'intro' | 'verse' | 'prechorus' | 'chorus' | 'bridge' | 'interlude' | 'outro' | 'other';

export interface Section {
  kind: SectionKind;
  /** 見出しの文字 (例: "Chorus 2")。区切りの前の部分は '' */
  label: string;
  start: number;
  end: number;
}

/** ローマ字の言葉は前後が英字でないときだけ (universe の verse・_chorus_01 の chorus を区別する) */
const latin = (w: string): string => `(?<![a-z])(?:${w})(?![a-z])`;

/**
 * 見出し・ファイル名の言葉 → 種類。いちばん前に出てくる言葉で決める
 * (「Intro Hook」はイントロ、「Pre-Chorus」は B メロ、「Final Chorus」はサビ)。
 * 2026-10-01 ユーザーの歌詞 (Cold Open / Lift / Build / Break / Afterglow など) で見分けられなかった言葉を足した
 */
const KIND_WORDS: [SectionKind, RegExp][] = [
  ['prechorus', new RegExp(`${latin('pre[\\s_-]?(?:chorus|hook)|lift|build(?:[\\s_-]?up)?|rise|climb')}|プレ\\s*サビ|b\\s*メロ`, 'gi')],
  ['chorus', new RegExp(`${latin('chorus|hook|refrain|drop')}|サビ|さび`, 'gi')],
  ['intro', new RegExp(`${latin('intro|introduction|opening|cold[\\s_-]?open|prologue')}|イントロ|前奏|オープニング`, 'gi')],
  ['verse', new RegExp(`${latin('verse')}|a\\s*メロ|ヴァース|バース`, 'gi')],
  ['bridge', new RegExp(`${latin('bridge|break(?:down)?')}|[cd]\\s*メロ|ブリッジ`, 'gi')],
  ['interlude', new RegExp(`${latin('interlude|instrumental|inst|solo')}|間奏|间奏|ソロ|간주`, 'gi')],
  ['outro', new RegExp(`${latin('outro|ending|end|coda|afterglow|epilogue')}|アウトロ|エンディング|後奏`, 'gi')],
];

/** 文字 (見出し・ファイル名) から区切りの種類を見分ける。どれでもなければ null */
export function sectionKindOf(text: string): SectionKind | null {
  const s = text.normalize('NFKC');
  let best: SectionKind | null = null;
  let bestAt = Infinity;
  for (const [kind, re] of KIND_WORDS) {
    re.lastIndex = 0;
    const m = re.exec(s);
    if (m && m.index < bestAt) {
      bestAt = m.index;
      best = kind;
    }
  }
  return best;
}

const TIME_TAG = /^\[(\d+):(\d+(?:[.:]\d+)?)\]/;
const META_TAG = /^\[(ti|ar|al|by|offset):(.*)\]$/i;
const INTERLUDE = /^\[\s*(間奏|间奏|interlude|instrumental|inst|간주)(?:\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|秒|초)?)?\s*\]$/i;

interface Marker {
  row: number;
  label: string;
  kind: SectionKind;
  lrc: number | null;
  /** [間奏] の行 (その行自体が歌詞の行として残る) */
  interlude: boolean;
}

/** 歌詞の入力から見出しを拾う (行番号は parse.ts と同じ入力の行番号) */
function findMarkers(text: string, source: LyricsSource): Marker[] {
  const raw = source === 'srt' ? srtToLrc(text).text : text;
  const rows = String(raw || '').replace(/\r/g, '').split('\n');
  const markers: Marker[] = [];
  rows.forEach((row, ri) => {
    const s0 = row.trim();
    if (!s0 || s0.startsWith('#') || META_TAG.test(s0)) return;
    let s = s0;
    let lrc: number | null = null;
    let m: RegExpMatchArray | null;
    while ((m = s.match(TIME_TAG))) {
      lrc ??= +m[1]! * 60 + parseFloat(m[2]!.replace(':', '.'));
      s = s.slice(m[0].length);
    }
    s = s.trim();
    if (INTERLUDE.test(s)) {
      markers.push({ row: ri, label: s.slice(1, -1).trim(), kind: 'interlude', lrc, interlude: true });
      return;
    }
    // 見出しだけの行 ([ ] の外に文字が無い)
    if (!s.startsWith('[') || s.replace(/\[[^\]]*\]/g, '').trim() !== '') return;
    const label = [...s.matchAll(/\[([^\]]*)\]/g)].map((x) => x[1]!.trim()).filter(Boolean).join(' ');
    if (!label) return;
    markers.push({ row: ri, label, kind: sectionKindOf(label) ?? 'other', lrc, interlude: false });
  });
  return markers;
}

/**
 * 曲の区切りを、時刻の順に並べて返す。見出しが 1 つも無ければ空。
 * lines は parse の結果 (src = 入力の行番号)、times はその行の時刻
 */
export function findSections(text: string, source: LyricsSource, lines: readonly LyricLine[], times: LineTimes, duration: number): Section[] {
  const markers = findMarkers(text, source);
  if (markers.length === 0) return [];
  const end = Number.isFinite(duration) && duration > 0 ? duration : Math.max(0, ...times.ends.filter(Number.isFinite));
  // 入力の行番号の順に、歌詞の行を並べる (LRC は時刻で並べ替わっているため)
  const order = lines.map((l, i) => ({ src: l.src, i })).sort((a, b) => a.src - b.src || a.i - b.i);
  const firstLineFrom = (row: number, untilRow: number): number => {
    const hit = order.find((o) => o.src >= row && o.src < untilRow);
    return hit ? hit.i : -1;
  };
  const lastLineBefore = (row: number): number => {
    let best = -1;
    for (const o of order) if (o.src < row) best = o.i;
    return best;
  };
  const starts: { kind: SectionKind; label: string; start: number | null; emptyFrom: number }[] = markers.map((mk, k) => {
    const nextRow = markers[k + 1]?.row ?? Infinity;
    const li = firstLineFrom(mk.row, nextRow);
    const prev = lastLineBefore(mk.row);
    const emptyFrom = prev >= 0 ? (times.ends[prev] ?? 0) : 0;
    if (mk.lrc != null) return { kind: mk.kind, label: mk.label, start: mk.lrc, emptyFrom };
    return { kind: mk.kind, label: mk.label, start: li >= 0 ? (times.starts[li] ?? null) : null, emptyFrom };
  });
  // 歌詞の無い区切り: 前の歌詞の終わりから (最初なら 0 秒)。次の区切りより後ろにはしない
  const out: Section[] = [];
  let prevStart = 0;
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k]!;
    let start = s.start ?? (k === 0 && lastLineBefore(markers[0]!.row) < 0 ? 0 : s.emptyFrom);
    if (!Number.isFinite(start)) start = prevStart;
    start = Math.min(Math.max(start, prevStart), end);
    out.push({ kind: s.kind, label: s.label, start, end });
    prevStart = start;
  }
  // 最初の区切りより前に歌詞 (や時間) があれば、0 秒から「その他」
  if (out[0]!.start > 0.05 && lastLineBefore(markers[0]!.row) >= 0) out.unshift({ kind: 'other', label: '', start: 0, end });
  else out[0]!.start = 0;
  for (let k = 0; k < out.length; k++) out[k]!.end = out[k + 1]?.start ?? end;
  // 長さ 0 の区切りは除く (同じ所に見出しが 2 つ並んだときなど)
  return out.filter((s) => s.end - s.start > 1e-6);
}

/** 時刻 t がどの区切りか (区切りが無い・範囲外なら -1) */
export function sectionAt(sections: readonly Section[], t: number): number {
  for (let k = sections.length - 1; k >= 0; k--) if (t >= sections[k]!.start) return t < sections[k]!.end ? k : -1;
  return -1;
}
