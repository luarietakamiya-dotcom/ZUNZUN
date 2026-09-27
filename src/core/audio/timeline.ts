import type { AudioFrame } from '../types';
import type { AudioAnalysis } from './analyze';
import { BAND_COUNT } from './analyze';

const EMPTY_BANDS = new Float32Array(BAND_COUNT);

/** ビートパルスの減衰時間 (秒)。ビート直後を 1、ここで指定した秒数で概ね減衰しきる。 */
const BEAT_DECAY = 0.18;

/**
 * AudioAnalysis (固定フレームレートの特徴量シリーズ) から、任意の時刻 t の AudioFrame を
 * 補間して取り出す。プレビュー再生でも書き出しでも、この同じクラスから同じ結果を読むことで
 * 音ズレが原理的に起きないようにする (docs/ARCHITECTURE.md の「解析は事前、描画は時刻駆動」)。
 */
export class AudioTimeline {
  constructor(private readonly analysis: AudioAnalysis) {}

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
