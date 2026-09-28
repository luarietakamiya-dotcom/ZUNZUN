import type { LyricsTiming } from '../types';
import type { ParsedLyrics } from './parse';

/**
 * 歌詞の各行の開始・終了時刻を決める。
 *
 * 852wa/JIZURA (MIT License, © 2026 hakoniwa) src/08_planner.js の `J.computeTiming` を移植したもの
 * (commit 8da975f 時点)。優先順位は JIZURA と同じで、手で決めた時刻 (lineTimes) > LRC のタグ > 文字数からの見積もり。
 * JIZURA には無い lineEnds (行の終了) の反映だけを ZUNZUN で足している。L5 の JIZURA アダプタも同じ規則で
 * `J.computeTiming` を包むので、Lyrics タブのタイムラインと歌詞モーションの表示時刻は一致する。
 */

export interface LineTimingOptions {
  /** 見積もりをビートの整数倍にそろえるための BPM (0 ならそろえない) */
  bpm?: number;
  /** 1 行目の開始 (見積もりのとき) */
  offset?: number;
  /** 最後の行のあとの余白 (秒) */
  tail?: number;
  /** 見積もりの行の長さの倍率 */
  lineScale?: number;
  /** 音源の長さ (秒)。あれば全体の長さはこれ以上になる */
  audioDuration?: number;
}

export interface LineTimes {
  starts: number[];
  ends: number[];
  duration: number;
}

/** 行の終了は、開始から最低この秒数あとにする (JIZURA と同じ最小値) */
export const MIN_LINE_DURATION = 0.35;

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

function lookup(map: Record<string, number> | undefined, i: number): number | null {
  const v = map?.[String(i)];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function computeLineTimes(
  parsed: ParsedLyrics,
  timing: Pick<LyricsTiming, 'lineTimes' | 'lineEnds'>,
  opts: LineTimingOptions = {},
): LineTimes {
  const lines = parsed.lines;
  const bpm = opts.bpm ?? 0;
  const beat = bpm > 0 ? 60 / bpm : 0;
  const lineScale = opts.lineScale || 1;
  const allLrc = lines.length > 0 && lines.every((l) => l.lrc != null);
  const starts: number[] = [];

  lines.forEach((l, i) => {
    const man = lookup(timing.lineTimes, i);
    let s: number;
    if (man != null) s = man;
    else if (allLrc) s = l.lrc!;
    else if (i > 0) {
      const pl = lines[i - 1]!;
      const n = [...pl.text].length;
      let d = pl.interlude ? (pl.secs != null && pl.secs > 0 ? pl.secs : 4) : clamp(0.8 + n * 0.17, 1.3, 5.2) * lineScale;
      if (beat && !(pl.interlude && pl.secs != null && pl.secs > 0)) d = Math.max(2, Math.round(d / beat)) * beat;
      s = starts[i - 1]! + d + (l.gapBefore ? (beat ? beat * 2 : 0.8) : 0);
    } else s = opts.offset ?? 0.4;
    starts.push(s);
  });

  const ends = starts.map((s, i) => {
    let e: number;
    if (i < starts.length - 1) e = Math.max(s + MIN_LINE_DURATION, starts[i + 1]!);
    else {
      const L = lines[i]!;
      const n = [...L.text].length;
      let d = L.interlude ? (L.secs != null && L.secs > 0 ? L.secs : 4) : clamp(0.8 + n * 0.17, 1.5, 5.2) * lineScale;
      if (beat && !(L.interlude && L.secs != null && L.secs > 0)) d = Math.max(2, Math.round(d / beat)) * beat;
      e = s + d;
    }
    return e;
  });
  applyManualEnds(starts, ends, timing.lineEnds);

  let duration = (ends.length ? ends[ends.length - 1]! : 3) + (opts.tail ?? 0.9);
  if (opts.audioDuration) duration = Math.max(opts.audioDuration, ends.length ? ends[ends.length - 1]! + 0.2 : 1);
  return { starts, ends, duration };
}

/**
 * ZUNZUN の拡張: 手で決めた行の終了 (lineEnds) を ends に反映する (ends を書き換える)。
 * 次の行より後ろには伸ばさない (JIZURA のカット割りは行が重ならない前提)。最後の行は次の行が無いので、
 * 見積もりより長くても手で決めた終了をそのまま使う。開始 + MIN_LINE_DURATION より短くはしない。
 * computeLineTimes と、JIZURA の J.computeTiming を包むアダプタ (jizura-adapter.ts) の両方がこれを使うので、
 * Lyrics タブのタイムラインと歌詞モーションで行の終わりが食い違わない。
 */
export function applyManualEnds(starts: readonly number[], ends: number[], lineEnds: Record<string, number> | undefined): void {
  for (let i = 0; i < ends.length; i++) {
    const manEnd = lookup(lineEnds, i);
    if (manEnd == null) continue;
    const wanted = Math.max(starts[i]! + MIN_LINE_DURATION, manEnd);
    ends[i] = i < ends.length - 1 ? Math.min(ends[i]!, wanted) : wanted;
  }
}

/**
 * 時刻 t に表示中の行の番号。どの行にも入っていなければ -1。
 * 手で決めた開始時刻は順番どおりとは限らないので、二分探索ではなく全行を見る (歌詞の行数なら十分速い)。
 * 複数の行に入っている場合は、開始が最も遅い行を返す。
 */
export function lineAt(times: Pick<LineTimes, 'starts' | 'ends'>, t: number): number {
  let ans = -1;
  for (let i = 0; i < times.starts.length; i++) {
    const s = times.starts[i]!;
    if (s <= t && t < times.ends[i]! && (ans < 0 || s >= times.starts[ans]!)) ans = i;
  }
  return ans;
}
