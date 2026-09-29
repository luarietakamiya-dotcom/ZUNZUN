import type { RhythmMeter, RhythmSettings } from '../types';
import { parseGrouping } from './grouping';

/**
 * 小節の頭 (タップした時刻) と区間ごとの拍子から、拍 (= まとまりの頭) の並びと小節の頭を作る。
 * 拍の間隔は不規則になる (例: 7/8 の 2+2+3 なら 1 小節に 3 拍、長・長・短)。
 * 歌詞モーション (JIZURA) にはこの拍の並びをビートとして渡し (R3)、変拍子向けの演出 (R4) は位置の情報を使う。
 */

export interface RhythmBar {
  start: number;
  end: number;
  /** この小節の拍のまとまり (例: [2, 2, 3]) */
  groups: number[];
}

export interface RhythmPulse {
  /** 秒 */
  t: number;
  /** 何小節目か (0 始まり) */
  bar: number;
  /** 小節の中で何番目のまとまりか (0 始まり) */
  group: number;
  groupsInBar: number;
  /** 小節の頭か */
  barHead: boolean;
  /** このまとまりの長さ (秒) */
  length: number;
}

export interface RhythmGrid {
  bars: RhythmBar[];
  pulses: RhythmPulse[];
  /** 拍の時刻 (昇順)。JIZURA にビートとして渡す */
  beats: number[];
  /** 小節の頭の時刻 (昇順) */
  accents: number[];
}

/** 既定の拍子 (壊れた指定のとき) */
const FALLBACK_GROUPS = [1, 1, 1, 1];
/** これより短い小節は捨てる (誤タップ) */
const MIN_BAR = 0.2;
/** これより近い小節の頭は 1 つにまとめる */
const DEDUPE = 0.05;

/** bar 番目の小節の拍のまとまり (その小節以前で最後に指定された拍子) */
export function groupsForBar(meters: readonly RhythmMeter[], bar: number): number[] {
  let pattern: string | null = null;
  let at = -1;
  for (const m of meters) {
    if (m.bar <= bar && m.bar >= at) {
      at = m.bar;
      pattern = m.pattern;
    }
  }
  return (pattern != null ? parseGrouping(pattern) : null) ?? FALLBACK_GROUPS;
}

/** 小節の頭を昇順に並べ、近すぎるものをまとめる */
export function normalizeBars(bars: readonly number[]): number[] {
  const sorted = bars.filter((t) => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of sorted) if (out.length === 0 || t - out[out.length - 1]! > DEDUPE) out.push(t);
  return out;
}

export function buildRhythmGrid(rhythm: Pick<RhythmSettings, 'bars' | 'meters'>): RhythmGrid {
  const heads = normalizeBars(rhythm.bars);
  const bars: RhythmBar[] = [];
  for (let k = 0; k < heads.length; k++) {
    const start = heads[k]!;
    // 最後の小節の終わりは、ひとつ前の小節と同じ長さとみなす (1 つしか無ければ長さが分からないので作らない)
    const end = k + 1 < heads.length ? heads[k + 1]! : k > 0 ? start + (start - heads[k - 1]!) : NaN;
    if (!Number.isFinite(end) || end - start < MIN_BAR) continue;
    bars.push({ start, end, groups: groupsForBar(rhythm.meters, k) });
  }
  const pulses: RhythmPulse[] = [];
  bars.forEach((b, bi) => {
    const units = b.groups.reduce((a, g) => a + g, 0);
    const unitLen = (b.end - b.start) / units;
    let u = 0;
    b.groups.forEach((g, gi) => {
      pulses.push({ t: b.start + u * unitLen, bar: bi, group: gi, groupsInBar: b.groups.length, barHead: gi === 0, length: g * unitLen });
      u += g;
    });
  });
  return { bars, pulses, beats: pulses.map((p) => p.t), accents: bars.map((b) => b.start) };
}

export interface RhythmPosition {
  pulse: RhythmPulse;
  /** まとまりの中の進み具合 (0..1) */
  phase: number;
  /** 小節の中の進み具合 (0..1) */
  barPhase: number;
}

/** 時刻 t がどの小節・どのまとまりの中か。どの小節にも入っていなければ null */
export function rhythmPositionAt(grid: RhythmGrid, t: number): RhythmPosition | null {
  const p = grid.pulses;
  let lo = 0;
  let hi = p.length - 1;
  let i = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (p[m]!.t <= t) {
      i = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  if (i < 0) return null;
  const pulse = p[i]!;
  const bar = grid.bars[pulse.bar]!;
  if (t >= bar.end) return null;
  return {
    pulse,
    phase: Math.min(1, (t - pulse.t) / pulse.length),
    barPhase: Math.min(1, (t - bar.start) / (bar.end - bar.start)),
  };
}
