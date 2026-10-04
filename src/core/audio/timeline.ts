import type { AudioFrame, SongContext } from '../types';
import type { AudioAnalysis } from './analyze';
import { BAND_COUNT } from './analyze';
import { buildSongMood, type SongMood } from './mood';

const EMPTY_BANDS = new Float32Array(BAND_COUNT);

/** ビートパルスの減衰時間 (秒)。ビート直後を 1、ここで指定した秒数で概ね減衰しきる。 */
const BEAT_DECAY = 0.18;

/** 曲全体の前計算 (曲調・自動の区間) は解析結果ごとに 1 回だけ。withCues() で作った複製とも共有する */
const moodCache = new WeakMap<object, SongMood>();

/**
 * AudioAnalysis (固定フレームレートの特徴量シリーズ) から、任意の時刻 t の AudioFrame を
 * 補間して取り出す。プレビュー再生でも書き出しでも、この同じクラスから同じ結果を読むことで
 * 音ズレが原理的に起きないようにする (docs/ARCHITECTURE.md の「解析は事前、描画は時刻駆動」)。
 */
export class AudioTimeline {
  /** 歌詞の見出しなどから決めた区間の境目 (秒、昇順)。null なら音の変化から自動で見つけたものを使う */
  private cues: readonly number[] | null = null;

  constructor(private readonly analysis: AudioAnalysis) {}

  /** 区間の境目を外から決める (歌詞の [サビ] などの見出しの時刻)。null / 空で自動に戻す */
  setSectionCues(times: readonly number[] | null): void {
    this.cues = times && times.length > 0 ? [...times].filter((t) => Number.isFinite(t)).sort((a, b) => a - b) : null;
  }

  /** 区間の境目だけが違う複製 (書き出しの開始時点の歌詞の区切りを固定するため。解析結果と前計算は共有) */
  withCues(times: readonly number[] | null): AudioTimeline {
    const copy = new AudioTimeline(this.analysis);
    copy.setSectionCues(times);
    return copy;
  }

  private songMood(): SongMood {
    let m = moodCache.get(this.analysis);
    if (!m) {
      m = buildSongMood(this.analysis);
      moodCache.set(this.analysis, m);
    }
    return m;
  }

  /** 時刻 t の曲全体の情報 (曲調・区間)。曲が空なら undefined */
  private songAt(t: number, i0: number, i1: number, frac: number): SongContext | undefined {
    const sm = this.songMood();
    if (sm.mood.length === 0) return undefined;
    const mood = sm.mood[i0]! + (sm.mood[i1]! - sm.mood[i0]!) * frac;
    const bounds = this.cues ?? sm.autoBoundaries;
    let section = 0;
    while (section < bounds.length && bounds[section]! <= t) section++;
    return { mood, section, sectionStart: section > 0 ? bounds[section - 1]! : 0, sectionCount: bounds.length + 1 };
  }

  get duration(): number {
    return this.analysis.duration;
  }

  get bpm(): number {
    return this.analysis.bpm;
  }

  get beats(): readonly number[] {
    return this.analysis.beats;
  }

  /** 時刻 t (秒) における AudioFrame を返す。prevT を渡すと dt が正しく埋まる。 */
  at(t: number, prevT = t): AudioFrame {
    const a = this.analysis;
    const n = a.times.length;
    const clamped = Math.max(0, Math.min(t, a.duration));

    if (n === 0) {
      return this.emptyFrame(clamped, clamped - prevT);
    }

    const hop = n > 1 ? a.times[1]! - a.times[0]! : 1 / a.frameRate;
    const posF = hop > 0 ? clamped / hop : 0;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(posF)));
    const i1 = Math.min(n - 1, i0 + 1);
    const frac = i1 > i0 ? posF - i0 : 0;

    const lerp = (arr: Float32Array): number => arr[i0]! + (arr[i1]! - arr[i0]!) * frac;
    const lerpBand = (): Float32Array => {
      const b0 = a.bands[i0] ?? EMPTY_BANDS;
      const b1 = a.bands[i1] ?? EMPTY_BANDS;
      const out = new Float32Array(b0.length);
      for (let k = 0; k < out.length; k++) out[k] = b0[k]! + (b1[k]! - b0[k]!) * frac;
      return out;
    };

    const { beat, beatIndex } = this.beatPulse(clamped);

    return {
      t: clamped,
      dt: clamped - prevT,
      bass: lerp(a.bass),
      mid: lerp(a.mid),
      high: lerp(a.high),
      rms: lerp(a.rms),
      peak: lerp(a.peak),
      beat,
      beatIndex,
      spectralEnergy: lerp(a.spectralEnergy),
      flux: lerp(a.flux),
      bands: lerpBand(),
      song: this.songAt(clamped, i0, i1, frac),
    };
  }

  /** 半自動タップ同期用: 時刻 t における「歌声らしさ」を直接取り出す (AudioFrame には含めない)。 */
  vocalLikenessAt(t: number): number {
    const a = this.analysis;
    const n = a.vocalLikeness.length;
    if (n === 0) return 0;
    const hop = n > 1 ? a.times[1]! - a.times[0]! : 1 / a.frameRate;
    const i = Math.max(0, Math.min(n - 1, Math.round(t / Math.max(hop, 1e-9))));
    return a.vocalLikeness[i] ?? 0;
  }

  private beatPulse(t: number): { beat: number; beatIndex: number } {
    const beats = this.analysis.beats;
    if (beats.length === 0) return { beat: 0, beatIndex: -1 };
    // 二分探索で t 以下の最後のビートを探す
    let lo = 0, hi = beats.length - 1;
    if (t < beats[0]!) return { beat: 0, beatIndex: -1 };
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (beats[mid]! <= t) lo = mid; else hi = mid - 1;
    }
    const since = t - beats[lo]!;
    const beat = since < 0 ? 0 : Math.min(1, Math.exp(-since / BEAT_DECAY));
    return { beat, beatIndex: lo };
  }

  private emptyFrame(t: number, dt: number): AudioFrame {
    return {
      t, dt, bass: 0, mid: 0, high: 0, rms: 0, peak: 0, beat: 0, beatIndex: -1,
      spectralEnergy: 0, flux: 0, bands: EMPTY_BANDS,
    };
  }
}
