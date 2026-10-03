import { sectionKindOf, type Section, type SectionKind } from '../lyrics/sections';
import { buildLyricsView } from '../lyrics/view';
import type { LyricsSettings, RhythmSettings } from '../types';

/**
 * 背景のスライドショーの切り替え表 (いつ・どの画像にするか)。計算だけ (DOM・WebGL を使わない)。
 * docs/ARCHITECTURE.md「曲の区切りと、背景のスライドショー」②。
 *
 * - 区切り (歌詞の [サビ] などの見出し) の頭では必ず切り替える。区切りの頭は、すぐ近く (1/4 小節以内) の小節の頭にそろえる
 *   (それより遠ければ歌詞の始まりちょうど。半小節まで寄せると、後ろの小節へずれて歌い出しより遅れて見えた)
 * - 区切りの中は小節の頭で切り替える。何小節ごとか (1・2・4・8・16) は:
 *   - 枚数: 全部の画像がだいたい 1 回ずつ出る速さ。ただし 8 小節より遅くも、1 小節より速くもしない
 *   - 区切りの種類: サビは速く (重み 2)、イントロ・アウトロはゆっくり (0.6) など
 *   - pace (切り替えの細かさ 0..1、0.5 が既定): 全体を 0.5 倍〜2 倍
 *   - BPM: 小節の長さが曲の速さで決まるので、速い曲ほど切り替えも速い
 * - 画像の区切りは、ユーザーが決めたもの (入れ場所・フォルダ名・一覧の選択。kinds) を優先し、無ければ
 *   ファイル名の言葉 (サビ・Chorus・Intro など) で決める。区切りが決まっている画像は、その種類の区切りの間だけ出す。
 *   決まっていない画像は、専用の画像が無い区切りで使う (決まっていない画像も無ければ全部から)
 * - 同じ区切りの種類の中では、ファイル名の順にくり返す。続けて同じ画像にはしない (2 枚以上あるとき)
 * 乱数は使わない (同じ入力なら同じ表)。
 */

export interface SlideCue {
  /** 切り替える時刻 (秒) */
  t: number;
  /** 何枚目の画像か (names の番号) */
  index: number;
  /** その画像が出る区切りの種類 (画像の動きの強さに使う。core/render/slide-motion.ts) */
  kind?: SectionKind;
}

const WEIGHT: Record<SectionKind, number> = {
  intro: 0.6,
  verse: 1,
  prechorus: 1.4,
  chorus: 2,
  bridge: 1,
  interlude: 1.2,
  outro: 0.6,
  other: 1,
};

/** 拍が無いときの小節の代わり (秒) */
const FALLBACK_BAR_SEC = 2;

/**
 * 小節の頭の並びを作る。変拍子モードで叩いた小節があればそれを、無ければ自動で見つけた拍を 4 拍ずつ、
 * 拍も無ければ 2 秒ごと。どれも 0 秒から曲の終わりまでを埋める (最初の小節より前・最後の小節より後ろも同じ長さで伸ばす)
 */
export function barGrid(beats: readonly number[], rhythmBars: readonly number[] | null, duration: number): number[] {
  const end = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const clean = (xs: readonly number[]): number[] => [...new Set(xs.filter((x) => Number.isFinite(x) && x >= 0 && x <= end))].sort((a, b) => a - b);
  let heads = rhythmBars && rhythmBars.length >= 2 ? clean(rhythmBars) : [];
  if (heads.length < 2) {
    const b = clean(beats);
    heads = b.length >= 8 ? b.filter((_, i) => i % 4 === 0) : [];
  }
  if (heads.length < 2) {
    const out: number[] = [];
    for (let t = 0; t < end; t += FALLBACK_BAR_SEC) out.push(t);
    return out.length ? out : [0];
  }
  const first = heads[1]! - heads[0]!;
  const last = heads[heads.length - 1]! - heads[heads.length - 2]!;
  const before: number[] = [];
  for (let t = heads[0]! - first; t > 1e-6; t -= first) before.unshift(t);
  const after: number[] = [];
  for (let t = heads[heads.length - 1]! + last; t < end - 1e-6; t += last) after.push(t);
  // 0 秒のすぐ近く (半小節より手前) の小節の頭は 0 秒と重ねる (曲の頭で 2 回切り替わらないように)
  const near0 = first / 2;
  return [0, ...before.filter((t) => t >= near0), ...heads.filter((t) => t >= near0), ...after];
}

/** 1・2・4・8・16 のうち、x 以下でいちばん大きいもの (切り捨てるので、全部の画像が出る速さより遅くならない) */
function pow2(x: number): number {
  const v = Math.floor(Math.log2(Math.max(1, Math.min(16, x))) + 1e-9);
  return 2 ** Math.max(0, Math.min(4, v));
}

export interface SlideScheduleInput {
  /** 画像のファイル名 (並べる順。区切りの言葉を見る) */
  names: readonly string[];
  /** 画像ごとの、ユーザーが決めた区切りの種類 (names と同じ順。無い・undefined の画像はファイル名の言葉で決める) */
  kinds?: readonly (SectionKind | null | undefined)[];
  /** 曲の区切り (無ければ曲全体を 1 つの区切りとして扱う) */
  sections: readonly Section[];
  /** 小節の頭 (barGrid の結果) */
  grid: readonly number[];
  duration: number;
  /** 切り替えの細かさ 0..1 (0.5 が既定。上げるほど速い) */
  pace: number;
}

export function slideSchedule(input: SlideScheduleInput): SlideCue[] {
  const n = input.names.length;
  const duration = Number.isFinite(input.duration) && input.duration > 0 ? input.duration : 0;
  if (n === 0 || duration <= 0) return [];
  if (n === 1) return [{ t: 0, index: 0, kind: input.sections[0]?.kind ?? 'other' }];
  const grid = input.grid.length ? [...input.grid].sort((a, b) => a - b) : [0];
  const sections: Section[] = input.sections.length ? input.sections.map((s) => ({ ...s })) : [{ kind: 'other', label: '', start: 0, end: duration }];
  // 区切りの頭を、すぐ近く (1/4 小節以内) の小節の頭にそろえる
  const barLen = grid.length >= 2 ? (grid[grid.length - 1]! - grid[0]!) / (grid.length - 1) : FALLBACK_BAR_SEC;
  const snap = (t: number): number => {
    let best = t;
    let bestD = barLen / 4 + 1e-9;
    for (const h of grid) {
      const d = Math.abs(h - t);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  };
  const spans = sections
    .map((s, k) => ({ kind: s.kind, start: k === 0 ? 0 : snap(s.start), end: s.end }))
    .map((s, k, arr) => ({ ...s, end: k + 1 < arr.length ? arr[k + 1]!.start : duration }))
    .filter((s) => s.end - s.start > 1e-6);
  const headsIn = (s: { start: number; end: number }): number[] => {
    const hs = grid.filter((h) => h > s.start + 1e-6 && h < s.end - 1e-6);
    return [s.start, ...hs];
  };
  // 速さ: 全部の画像がだいたい 1 回ずつ出る切り替えの回数。8 小節より遅く・1 小節より速くはしない
  const bars = spans.map((s) => headsIn(s).length);
  const total = bars.reduce((a, b) => a + b, 0);
  const weighted = spans.reduce((a, s, k) => a + bars[k]! * WEIGHT[s.kind], 0);
  const pace = Number.isFinite(input.pace) ? Math.min(1, Math.max(0, input.pace)) : 0.5;
  const switches = Math.min(total, Math.max(total / 8, n)) * 2 ** ((pace - 0.5) * 2);
  const base = weighted / Math.max(1, switches);

  // 区切りの種類ごとの画像の組 (ファイル名に言葉がある画像はその種類だけ)
  const kinds = input.names.map((name, i) => input.kinds?.[i] ?? sectionKindOf(name));
  const untagged = input.names.map((_, i) => i).filter((i) => kinds[i] == null);
  const poolFor = (kind: SectionKind): number[] => {
    const own = input.names.map((_, i) => i).filter((i) => kinds[i] === kind && kind !== 'other');
    if (own.length) return own;
    return untagged.length ? untagged : input.names.map((_, i) => i);
  };
  const counters = new Map<string, number>();
  const cues: SlideCue[] = [];
  let prev = -1;
  for (const s of spans) {
    const pool = poolFor(s.kind);
    const key = pool.join(',');
    const step = pow2(base / WEIGHT[s.kind]);
    const heads = headsIn(s);
    for (let h = 0; h < heads.length; h += step) {
      let c = counters.get(key) ?? 0;
      let index = pool[c % pool.length]!;
      if (index === prev && pool.length > 1) {
        c++;
        index = pool[c % pool.length]!;
      }
      counters.set(key, c + 1);
      if (index !== prev) cues.push({ t: heads[h]!, index, kind: s.kind });
      prev = index;
    }
  }
  return cues;
}

/** 時刻 t に出す画像と、ひとつ前の画像・切り替えてからの秒数 (じわっと切り替えるとき用) */
export function slideAt(cues: readonly SlideCue[], t: number): { index: number; prev: number; since: number; cue: number } {
  if (cues.length === 0) return { index: -1, prev: -1, since: Infinity, cue: -1 };
  let k = 0;
  for (let i = cues.length - 1; i >= 0; i--) {
    if (t >= cues[i]!.t) {
      k = i;
      break;
    }
  }
  const cur = cues[k]!;
  return { index: cur.index, prev: k > 0 ? cues[k - 1]!.index : -1, since: Math.max(0, t - cur.t), cue: k };
}

/** 切り替え表を、今のプロジェクトの状態から作るための材料 (プレビューと書き出しで同じものを使う) */
export interface SlidePlanInput {
  /** 画像のファイル名 (BackgroundSlides.items の ref) */
  names: readonly string[];
  /** 画像ごとの、ユーザーが決めた区切りの種類 (BackgroundSlides.items の kind) */
  kinds?: readonly (SectionKind | null | undefined)[];
  pace: number;
  /** 歌詞 (区切りを読む。無ければ曲全体を 1 つの区切り) */
  lyrics: LyricsSettings | null;
  /** 自動で見つけた拍 */
  beats: readonly number[];
  /** 変拍子モード (オンで小節を叩いてあればその小節を使う) */
  rhythm: RhythmSettings | null;
  duration: number;
}

export function slidePlan(input: SlidePlanInput): SlideCue[] {
  const sections = input.lyrics && input.lyrics.text.trim() ? buildLyricsView(input.lyrics, input.duration).sections : [];
  const bars = input.rhythm?.enabled && input.rhythm.bars.length >= 2 ? input.rhythm.bars : null;
  return slideSchedule({ names: input.names, kinds: input.kinds, sections, grid: barGrid(input.beats, bars, input.duration), duration: input.duration, pace: input.pace });
}

/** slidePlan の材料が同じかを見分けるキー (プレビューで、変わったときだけ作り直す) */
export function slidePlanKey(input: SlidePlanInput): string {
  const l = input.lyrics;
  return JSON.stringify([
    input.names,
    input.kinds ?? null,
    input.pace,
    l ? [l.source, l.text, l.timing.lineTimes, l.timing.lineEnds] : null,
    input.beats.length,
    input.beats[0] ?? null,
    input.beats[input.beats.length - 1] ?? null,
    input.rhythm?.enabled ? input.rhythm.bars : null,
    input.duration,
  ]);
}
