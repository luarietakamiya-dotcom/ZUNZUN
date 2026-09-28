import type { AudioAnalysis } from '../audio/analyze';
import type { LyricsSettings } from '../types';
import { findOnsetCandidates, type OnsetCandidate } from './candidates';
import { parseLyricsSource, type ParsedLyrics } from './parse';
import type { SnapTargets } from './snap';
import { computeLineTimes, type LineTimes } from './timing';

/**
 * Lyrics タブ (と L4 のタイムライン) が表示に使う、歌詞の「今の状態」をまとめて作る。
 * DOM に依存しないので Vitest で確かめられる。
 */

/** 行の開始時刻がどこから来たか: 手で決めた (タップ・入力・ドラッグ) / LRC・SRT のタグ / 文字数からの見積もり */
export type LineTimeSource = 'manual' | 'lrc' | 'estimate';

export interface LyricsView {
  parsed: ParsedLyrics & { srtEnds: number[] | null };
  times: LineTimes;
  startSource: LineTimeSource[];
  /** 終了を手で決めた行か */
  endManual: boolean[];
}

const hasTime = (map: Record<string, number>, i: number): boolean => {
  const v = map[String(i)];
  return typeof v === 'number' && Number.isFinite(v);
};

export function buildLyricsView(lyrics: LyricsSettings, audioDuration?: number): LyricsView {
  const parsed = parseLyricsSource(lyrics.text, lyrics.source);
  const times = computeLineTimes(parsed, lyrics.timing, { audioDuration });
  // computeLineTimes と同じ規則: すべての行にタグがあるときだけタグを使う
  const allLrc = parsed.lines.length > 0 && parsed.lines.every((l) => l.lrc != null);
  const startSource = parsed.lines.map((_, i): LineTimeSource =>
    hasTime(lyrics.timing.lineTimes, i) ? 'manual' : allLrc ? 'lrc' : 'estimate',
  );
  const endManual = parsed.lines.map((_, i) => hasTime(lyrics.timing.lineEnds, i));
  return { parsed, times, startSource, endManual };
}

export interface SyncTargets extends SnapTargets {
  /** 強さつきの歌い出し候補 (オフセット推定用) */
  onsets: OnsetCandidate[];
}

const targetCache = new WeakMap<AudioAnalysis, SyncTargets>();

/** 吸着先 (歌い出し候補とビート)。解析結果ごとに 1 度だけ計算して使い回す。 */
export function syncTargetsFor(analysis: AudioAnalysis): SyncTargets {
  let t = targetCache.get(analysis);
  if (!t) {
    const onsets = findOnsetCandidates(analysis.vocalLikeness, analysis.frameRate);
    t = { onsets, candidates: onsets.map((c) => c.t), beats: analysis.beats.slice().sort((a, b) => a - b) };
    targetCache.set(analysis, t);
  }
  return t;
}
