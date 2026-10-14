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
import type { LyricLine } from './parse';

export interface LyricSyncTiming {
  lineTimes: Record<string, number>;
  lineEnds: Record<string, number>;
  /** 自信の低い行（行番号、昇順） */
  review: number[];
  /** 取り込めたが気をつけてほしいこと（画面に出す） */
  warnings: string[];
}
export type LyricSyncResult = { ok: true; value: LyricSyncTiming } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const norm = (s: string): string => s.replace(/[\s\u3000、。，．,.!！?？…・「」『』（）()"'“”‘’~〜ー―-]/g, '').toLowerCase();

/** 応答の JSON 全体か files.zunzun のどちらからでも、時刻の表・自信の低い行・行の本文を取り出す */
function unwrap(raw: unknown): { timing: Obj | null; review: unknown; lines: unknown } {
  if (!isObj(raw)) return { timing: null, review: null, lines: null };
  if (isObj(raw.lineTimes)) return { timing: raw, review: raw.review, lines: raw.lines };
  const files = isObj(raw.files) ? raw.files : null;
  let z: unknown = files?.zunzun ?? raw.zunzun;
  if (typeof z === 'string') { try { z = JSON.parse(z); } catch { z = null; } }
  const data = isObj(raw.data) ? raw.data : raw;
  return { timing: isObj(z) && isObj(z.lineTimes) ? z : null, review: data.review ?? raw.review, lines: data.lines ?? raw.lines };
}

/** review は [3, 7] でも [{line: 3}, {index: 7}] でもよい。lines の status が low / estimated の行も自信が低い扱い */
function reviewOf(review: unknown, lines: unknown): number[] {
  const out = new Set<number>();
  const add = (v: unknown) => { const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN; if (Number.isInteger(n) && n >= 0) out.add(n); };
  if (Array.isArray(review)) for (const r of review) add(isObj(r) ? (r.line ?? r.index ?? r.i) : r);
  if (Array.isArray(lines)) lines.forEach((l, i) => { if (isObj(l) && (l.status === 'low' || l.status === 'estimated')) add(l.index ?? l.line ?? i); });
  return [...out].sort((a, b) => a - b);
}

/** 結果に行の本文があれば、今の歌詞と同じかを確かめる（行番号のずれ防止）。本文が無ければ確かめない */
function textsOf(lines: unknown): string[] | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const t = lines.map((l) => (typeof l === 'string' ? l : isObj(l) && typeof l.text === 'string' ? l.text : null));
  return t.every((x): x is string => x !== null) ? t : null;
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
  const { timing, review, lines: resLines } = unwrap(raw);
  if (!timing) return { ok: false, error: 'LyricSync の結果の形ではありません（lineTimes が見つかりません）' };
  const starts = tableOf(timing.lineTimes), ends = tableOf(timing.lineEnds ?? {});
  if (!starts || !ends) return { ok: false, error: '時刻の値がおかしい行があります（数でない・負の値）' };
  if (starts.length === 0) return { ok: false, error: '時刻が 1 行も入っていません' };
  const n = lines.length;
  const over = [...starts, ...ends].find(([i]) => i >= n);
  if (over) return { ok: false, error: `歌詞の行の数が違います（結果は ${over[0] + 1} 行目以降もあるが、今の歌詞は ${n} 行）。同じ歌詞で合わせ直してください` };
  const texts = textsOf(resLines);
  if (texts) {
    const sung = lines.map((l, i) => ({ l, i })).filter(({ l }) => !l.interlude);
    const same = texts.length === n ? texts.every((t, i) => lines[i]!.interlude || norm(t) === norm(lines[i]!.text)) : texts.length === sung.length && sung.every(({ l }, k) => norm(texts[k]!) === norm(l.text));
    if (!same) return { ok: false, error: '結果の歌詞が、今の歌詞と違います。同じ歌詞で合わせ直してください' };
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
  return { ok: true, value: { lineTimes, lineEnds, review: reviewOf(review, resLines).filter((i) => i < n), warnings } };
}
