import type { LyricBlank } from '../types';

/**
 * 歌詞の空白 (2026-10-01 ユーザー: 長い間奏の間も JIZURA がずっと動いているので、空白を作りたい)。
 * JIZURA は行の間が 1.3 秒より長いと自分で「間奏の場面」(曲名と飾り) を差し込み、[間奏] の行も飾りで動き続けるので、
 * 空白は JIZURA の外 (歌詞の層を描くかどうか) で作る:
 * - mode 'none': 何も出さない (始まりと終わりは FADE_SEC かけて消える・戻る。急に変わらないように)
 * - mode 'interlude': JIZURA の間奏の動き (飾り・効果だけ) をそのまま出す (空白の前の行はそこで終わらせてあるので、JIZURA が間奏の場面にする)
 * 空白は歌詞の動きの作り直しの材料に入れない (描くかどうかだけなので、変えてもすぐ効く)。
 */

export const BLANK_FADE_SEC = 0.3;
/** 空白のいちばん短い長さ (秒) */
export const MIN_BLANK_SEC = 0.5;
export const MAX_BLANKS = 200;

/** 並べ直して、重なったものはまとめ、短すぎるものは捨てる */
export function normalizeBlanks(blanks: readonly LyricBlank[], duration = Infinity): LyricBlank[] {
  const clean = blanks
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end))
    .map((b) => ({ start: Math.max(0, Math.min(b.start, duration)), end: Math.max(0, Math.min(b.end, duration)), mode: b.mode === 'interlude' ? ('interlude' as const) : ('none' as const) }))
    .filter((b) => b.end - b.start >= MIN_BLANK_SEC - 1e-9)
    .sort((a, b) => a.start - b.start);
  const out: LyricBlank[] = [];
  for (const b of clean) {
    const last = out[out.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else out.push({ ...b });
  }
  return out.slice(0, MAX_BLANKS);
}

/** 時刻 t の歌詞の濃さの倍率 (何も出さない空白の中は 0、端はなめらかに。それ以外は 1) */
export function blankAlpha(blanks: readonly LyricBlank[] | undefined, t: number): number {
  if (!blanks?.length || !Number.isFinite(t)) return 1;
  for (const b of blanks) {
    if (b.mode !== 'none' || t < b.start || t > b.end) continue;
    const fade = Math.min(BLANK_FADE_SEC, (b.end - b.start) / 2);
    const k = Math.min(1, (t - b.start) / fade, (b.end - t) / fade);
    const a = 1 - Math.max(0, k);
    return a * a * (3 - 2 * a);
  }
  return 1;
}

/** 時刻 t がどの空白の中か (無ければ -1) */
export function blankAt(blanks: readonly LyricBlank[] | undefined, t: number): number {
  return blanks?.findIndex((b) => t >= b.start && t < b.end) ?? -1;
}

/**
 * 再生位置 t から空白を作る。終わりは t より後に始まる最初の行の始まり (無ければ曲の終わり、それも無ければ 4 秒後)。
 * t が行の途中なら、その行は t で終わらせる (cut)。短すぎる (MIN_BLANK_SEC 未満) ときは null
 */
export function blankFromPlayhead(
  t: number,
  starts: readonly number[],
  ends: readonly number[],
  duration: number,
  mode: LyricBlank['mode'] = 'none',
): { blank: LyricBlank; cut: { line: number; end: number } | null } | null {
  if (!Number.isFinite(t) || t < 0) return null;
  let next = Infinity;
  for (const s of starts) if (s > t + 1e-6 && s < next) next = s;
  const end = Number.isFinite(next) ? next : Number.isFinite(duration) && duration > t ? duration : t + 4;
  if (end - t < MIN_BLANK_SEC) return null;
  let cut: { line: number; end: number } | null = null;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i]! < t && (ends[i] ?? -Infinity) > t) cut = { line: i, end: t };
  }
  return { blank: { start: t, end, mode }, cut };
}
