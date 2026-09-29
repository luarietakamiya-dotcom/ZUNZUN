import { analyzeSamples, type AudioAnalysis } from '../audio/analyze';
import { decodeAudioFile } from '../audio/decode';
import { sha256Hex } from '../hash';
import type { LyricsStem } from '../types';
import { syncTargetsFor, type SyncTargets } from './view';

/**
 * ボーカルだけの音源 (stem) を使う吸着 (Lyrics タブ専用)。
 * 伴奏入りの曲では、同じ帯域 (300Hz〜3kHz) のギター・スネア・シンセの出だしも「歌い出し候補」になる
 * (Black Rose では 3 分で 392 個)。ボーカルだけの stem から候補を拾えば、ほぼ歌い出しだけになる。
 * - 使うのは歌い出し候補だけ。ビートは元の曲から取る (ボーカルだけではビートを正しく拾えない)。
 *   再生・ビジュアライザー・書き出し・小節の頭の吸着も元の曲のまま
 * - stem の中身と解析結果はメモリにだけ置き (モジュール単位。タブを切り替えても残る)、Project JSON には
 *   ファイル名と sha256 だけを保存する (lyrics.stem)。プロジェクトを読み込んだら選び直してもらう
 */

export interface LoadedStem {
  name: string;
  sha256: string;
  duration: number;
  analysis: AudioAnalysis;
  audioBuffer: AudioBuffer;
}

let loaded: LoadedStem | null = null;

/** 読み込んである stem (無ければ null) */
export function loadedStem(): LoadedStem | null {
  return loaded;
}

/** stem を読み込んで解析する (前の stem は捨てる) */
export async function loadVocalStem(file: File): Promise<LoadedStem> {
  const decoded = await decodeAudioFile(file);
  const stem: LoadedStem = {
    name: file.name,
    sha256: await sha256Hex(decoded.raw),
    duration: decoded.duration,
    analysis: analyzeSamples(decoded.mono, decoded.sampleRate),
    audioBuffer: decoded.audioBuffer,
  };
  loaded = stem;
  return stem;
}

export function unloadVocalStem(): void {
  loaded = null;
}

/** 元の曲と長さがこれ以上違うと注意を出す (秒)。分離ツールの stem はふつう同じ長さ */
export const STEM_DURATION_TOLERANCE = 0.5;

export type StemState =
  /** 使わない設定 (stem が無い、またはオフ) */
  | { kind: 'off' }
  /** 設定はあるが、このセッションでまだ読み込んでいない (プロジェクトを読み込んだ直後など) */
  | { kind: 'missing' }
  /** 読み込んだものが設定のファイルと違う */
  | { kind: 'mismatch' }
  /** 使っている。durationGap は元の曲との長さの差 (秒、元の曲が無ければ 0) */
  | { kind: 'active'; durationGap: number };

/** 設定と読み込んだ stem から、吸着に stem を使うかどうかを決める */
export function stemState(settings: LyricsStem | null | undefined, stem: Pick<LoadedStem, 'sha256' | 'duration'> | null, mainDuration?: number): StemState {
  if (!settings || !settings.enabled) return { kind: 'off' };
  if (!stem) return { kind: 'missing' };
  if (stem.sha256 !== settings.sha256) return { kind: 'mismatch' };
  return { kind: 'active', durationGap: mainDuration && mainDuration > 0 ? stem.duration - mainDuration : 0 };
}

const mixed = new WeakMap<AudioAnalysis, WeakMap<AudioAnalysis, SyncTargets>>();
const EMPTY: SyncTargets = { onsets: [], candidates: [], beats: [] };

/**
 * 歌詞の吸着先。stem を使うときは歌い出し候補を stem から、ビートを元の曲から取る (組み合わせごとにキャッシュ)。
 * 使わないときは元の曲の吸着先そのまま。
 */
export function lyricSyncTargets(main: AudioAnalysis | null, stem: AudioAnalysis | null): SyncTargets {
  if (!stem) return main ? syncTargetsFor(main) : EMPTY;
  const beats = main ? syncTargetsFor(main).beats : [];
  const key = main ?? stem;
  let byStem = mixed.get(key);
  if (!byStem) {
    byStem = new WeakMap();
    mixed.set(key, byStem);
  }
  let t = byStem.get(stem);
  if (!t) {
    const fromStem = syncTargetsFor(stem);
    t = { onsets: fromStem.onsets, candidates: fromStem.candidates, beats: main ? beats : [] };
    byStem.set(stem, t);
  }
  return t;
}
