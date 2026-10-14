/**
 * LyricSync（利用者の PC で動く、歌詞の自動タイミング合わせのツール）の結果を、ZUNZUN の歌詞の時刻にする。
 * 計画: docs/LYRICSYNC_INTEGRATION_PLAN.md（2026-10-14 姫の承認）。LyricSync を入れた人だけが使う「おまけ」の機能。
 *
 * 受け取れる形（LyricSync の資料 HANDOFF_ZUNZUN.md より）:
 *  - `files.zunzun` そのもの: {"lineTimes": {"0": 秒, ...}, "lineEnds": {...}, "snap": true, "snapWindowMs": 150}
 *  - 応答の JSON 全体: {"files": {"zunzun": 上の形（または文字列の JSON）}, "data": {"review": [行番号...], "lines": [...]}}
 * 行番号は ZUNZUN の parseLyrics と同じ数え方（LyricSync が移植して一致を確かめている）。間奏の行には時刻が付かない。
 * 取り込むのは lineTimes / lineEnds だけ。snap / snapWindowMs は姫の設定を上書きしないため使わない。
 * 自動の結果に吸着はかけない（LyricSync の評価で、歌い出しへの吸着はクリック音に引っぱられて精度が下がった）。
 */
import { parseLyrics, stripBracketNotes, type LyricLine } from './parse';

export interface LyricSyncTiming {
  lineTimes: Record<string, number>;
  lineEnds: Record<string, number>;
  /** 自信の低い行（行番号、昇順） */
  review: number[];
  /** 取り込めたが気をつけてほしいこと（画面に出す） */
  warnings: string[];
  /**
   * 結果の歌詞が今の歌詞と同じだと確かめられたか。結果に行の本文（data.lines）か歌詞の全文（lyrics）が無いと false。
   * false のときは画面に「歌詞の一致は未確認」と出す（時刻の表だけでは総行数も確定できないため）
   */
  verified: boolean;
}
export type LyricSyncResult = { ok: true; value: LyricSyncTiming } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const norm = (s: string): string => s.replace(/[\s\u3000、。，．,.!！?？…・「」『』（）()"'“”‘’~〜ー―-]/g, '').toLowerCase();

/** 応答の JSON 全体か files.zunzun のどちらからでも、時刻の表・自信の低い行・行の本文を取り出す */
function unwrap(raw: unknown): { timing: Obj | null; review: unknown; lines: unknown; lyrics: unknown } {
  if (!isObj(raw)) return { timing: null, review: null, lines: null, lyrics: null };
  if (isObj(raw.lineTimes)) return { timing: raw, review: raw.review, lines: raw.lines, lyrics: raw.lyrics };
  const files = isObj(raw.files) ? raw.files : null;
  let z: unknown = files?.zunzun ?? raw.zunzun;
  if (typeof z === 'string') { try { z = JSON.parse(z); } catch { z = null; } }
  const data = isObj(raw.data) ? raw.data : raw;
  return { timing: isObj(z) && isObj(z.lineTimes) ? z : null, review: data.review ?? raw.review, lines: data.lines ?? raw.lines, lyrics: data.lyrics ?? raw.lyrics };
}

/**
 * review は [3, 7] でも [{line: 3}, {index: 7}] でもよい（ZUNZUN と同じ行番号）。
 * lines の status が low / estimated の行も自信が低い扱い。lines に明示の番号が無いときは、本文の照合で作った
 * 対応表 map（結果の配列の位置 → ZUNZUN の行番号。間奏を除いた配列でもずれない）で番号を決める
 */
function reviewOf(review: unknown, lines: unknown, map: readonly number[] | null): number[] {
  const out = new Set<number>();
  const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);
  const add = (n: number) => { if (Number.isInteger(n) && n >= 0) out.add(n); };
  if (Array.isArray(review)) for (const r of review) add(num(isObj(r) ? (r.line ?? r.index ?? r.i) : r));
  if (Array.isArray(lines)) lines.forEach((l, k) => {
    if (!isObj(l) || (l.status !== 'low' && l.status !== 'estimated')) return;
    const explicit = num(l.index ?? l.line);
    add(Number.isInteger(explicit) ? explicit : map ? (map[k] ?? NaN) : k);
  });
  return [...out].sort((a, b) => a - b);
}

/** 結果の行の本文。1 行でも本文が欠けていたら 'partial'（照合できないので取り込まない）。本文が無ければ null */
function textsOf(lines: unknown): string[] | 'partial' | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const t = lines.map((l) => (typeof l === 'string' ? l : isObj(l) && typeof l.text === 'string' ? l.text : null));
  if (t.every((x) => x === null)) return null;
  return t.every((x): x is string => x !== null) ? t : 'partial';
}

/** 結果の本文の並びを、今の歌詞の行番号に対応づける（全部の行・間奏を除いた行のどちらの数でもよい）。合わなければ null */
function mapTexts(texts: readonly string[], lines: readonly LyricLine[]): number[] | null {
  const n = lines.length;
  if (texts.length === n && texts.every((t, i) => lines[i]!.interlude || norm(t) === norm(lines[i]!.text))) return lines.map((_, i) => i);
  const sung = lines.map((l, i) => ({ l, i })).filter(({ l }) => !l.interlude);
  if (texts.length === sung.length && sung.every(({ l }, k) => norm(texts[k]!) === norm(l.text))) return sung.map(({ i }) => i);
  return null;
}

const tableOf = (v: unknown): [number, number][] | null => {
  if (!isObj(v)) return null;
  const out: [number, number][] = [];
  for (const [k, t] of Object.entries(v)) {
    if (!/^\d+$/.test(k) || typeof t !== 'number' || !Number.isFinite(t) || t < 0) return null;
    out.push([Number(k), t]);
  }
  return out;
};

/**
 * LyricSync の結果を、今の歌詞（lines）と曲の長さ（duration、分からなければ NaN）に合わせて確かめ、時刻にする。
 * 行の数が合わない・本文が違う・数がおかしい、のどれかなら取り込まない（error）。
 */
export function readLyricSyncResult(raw: unknown, lines: readonly LyricLine[], duration = NaN): LyricSyncResult {
  const { timing, review, lines: resLines, lyrics } = unwrap(raw);
  if (!timing) return { ok: false, error: 'LyricSync の結果の形ではありません（lineTimes が見つかりません）' };
  const starts = tableOf(timing.lineTimes), ends = tableOf(timing.lineEnds ?? {});
  if (!starts || !ends) return { ok: false, error: '時刻の値がおかしい行があります（数でない・負の値）' };
  if (starts.length === 0) return { ok: false, error: '時刻が 1 行も入っていません' };
  const n = lines.length;
  const over = [...starts, ...ends].find(([i]) => i >= n);
  if (over) return { ok: false, error: `歌詞の行の数が違います（結果は ${over[0] + 1} 行目以降もあるが、今の歌詞は ${n} 行）。同じ歌詞で合わせ直してください` };
  // 歌詞の一致: 行の本文（data.lines）か全文（lyrics）で確かめる。どちらも無ければ「未確認」
  let map: number[] | null = null, verified = false;
  const texts = textsOf(resLines);
  if (texts === 'partial') return { ok: false, error: '結果の行の本文が一部だけ欠けていて、今の歌詞と照らし合わせられません' };
  if (texts) {
    map = mapTexts(texts, lines);
    if (!map) return { ok: false, error: '結果の歌詞が、今の歌詞と違います。同じ歌詞で合わせ直してください' };
    verified = true;
  } else if (typeof lyrics === 'string' && lyrics.trim()) {
    const theirs = parseLyrics(stripBracketNotes(lyrics)).lines;
    if (!mapTexts(theirs.map((l) => (l.interlude ? '' : l.text)), lines) || theirs.length !== n) return { ok: false, error: '結果の歌詞が、今の歌詞と違います。同じ歌詞で合わせ直してください' };
    verified = true;
  }
  const warnings: string[] = [];
  const lineTimes: Record<string, number> = {}, lineEnds: Record<string, number> = {};
  for (const [i, t] of starts) { if (lines[i]!.interlude) continue; lineTimes[String(i)] = t; }
  for (const [i, t] of ends) { const s = lineTimes[String(i)]; if (lines[i]!.interlude || s === undefined) continue; lineEnds[String(i)] = Math.max(s, t); }
  const ordered = Object.keys(lineTimes).map(Number).sort((a, b) => a - b);
  if (ordered.some((i, k) => k > 0 && lineTimes[String(i)]! < lineTimes[String(ordered[k - 1]!)]!)) warnings.push('行の順と時刻の順が入れ替わっている所があります');
  if (Number.isFinite(duration) && ordered.some((i) => lineTimes[String(i)]! > duration + 0.5)) warnings.push('曲の長さより後ろの時刻があります（別の曲の結果かもしれません）');
  const sungCount = lines.filter((l) => !l.interlude).length;
  if (ordered.length < sungCount) warnings.push(`${sungCount - ordered.length} 行は時刻が付いていません（前後の行から仮の時刻を付けます）`);
  if (!verified) warnings.push('結果に歌詞の本文が無いので、今の歌詞と同じかは確かめられていません（歌詞の一致は未確認）');
  return { ok: true, value: { lineTimes, lineEnds, review: reviewOf(review, resLines, map).filter((i) => i < n && !lines[i]!.interlude), warnings, verified } };
}
