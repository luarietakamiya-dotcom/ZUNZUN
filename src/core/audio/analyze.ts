/**
 * オフライン音声解析: モノラル PCM から、固定フレームレートの特徴量シリーズと BPM/ビートグリッドを求める。
 *
 * 設計は 852wa/JIZURA (MIT License, https://github.com/852wa/JIZURA) の src/10_audio.js
 * (エネルギー包絡線、onset flux、自己相関による BPM 推定、位相探索) を参考にしているが、
 * 帯域分解 (bass/mid/high/64帯域) と歌声らしさ (vocalLikeness) は FFT ベースで新規に実装した。
 * 実装はゼロから書き起こし、JIZURA のコードはコピーしていない。
 */
import { hannWindow, magnitudeSpectrum, nextPow2 } from './fft';

export const FRAME_RATE = 60; // AudioTimeline のフレームレート (docs/ARCHITECTURE.md)
export const BAND_COUNT = 64;

export interface AudioAnalysis {
  frameRate: number;
  duration: number;
  sampleRate: number;
  /** フレームごとの時刻 (秒) */
  times: Float32Array;
  bass: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  rms: Float32Array;
  peak: Float32Array;
  spectralEnergy: Float32Array;
  flux: Float32Array;
  /** 歌声が乗りやすい帯域 (300Hz-3kHz) の相対的な強さ + 立ち上がり。半自動歌詞タップの吸着に使う */
  vocalLikeness: Float32Array;
  /** フレームごとの 64 帯域エネルギー (対数間隔, 20Hz .. sampleRate/2) */
  bands: Float32Array[];
  bpm: number;
  /** 秒単位のビート時刻 */
  beats: number[];
  /**
   * 細かい時刻の音量 (出だしの時刻の合わせ直し用。core/lyrics/candidates.ts の refineOnsetTimes)。
   * 上の特徴量は約 46ms の窓の真ん中を時刻にしているため、鋭い出だしほど早い時刻に出る (キックで約 30ms)。
   * rate 回/秒の区間ごとの RMS (区間 i は i / rate 秒から)。energy = 音全体、vocal = 300Hz〜3kHz。
   * analyzeSamples は必ず入れる (テスト用の手作りの解析結果には無いことがある)
   */
  fine?: FineEnvelope;
}

export interface FineEnvelope {
  rate: number;
  energy: Float32Array;
  vocal: Float32Array;
}

/** 細かい時刻の音量の区間の数 (回/秒)。5ms */
export const FINE_RATE = 200;

const BASS_HZ: [number, number] = [20, 250];
const MID_HZ: [number, number] = [250, 2000];
const HIGH_HZ: [number, number] = [2000, 8000];
const VOCAL_HZ: [number, number] = [300, 3000];

function hzToBin(hz: number, sampleRate: number, fftSize: number): number {
  return Math.round((hz / sampleRate) * fftSize);
}

function bandEnergy(mag: Float64Array, sampleRate: number, fftSize: number, loHz: number, hiHz: number): number {
  const lo = Math.max(0, hzToBin(loHz, sampleRate, fftSize));
  const hi = Math.min(mag.length - 1, hzToBin(hiHz, sampleRate, fftSize));
  if (hi <= lo) return 0;
  let sum = 0;
  for (let k = lo; k <= hi; k++) sum += mag[k]!;
  return sum / (hi - lo + 1);
}

/** 20Hz .. sampleRate/2 を対数間隔で BAND_COUNT 分割したエネルギー配列。 */
function logBands(mag: Float64Array, sampleRate: number, fftSize: number): Float32Array {
  const out = new Float32Array(BAND_COUNT);
  const nyquist = sampleRate / 2;
  const loLog = Math.log2(20);
  const hiLog = Math.log2(nyquist);
  for (let b = 0; b < BAND_COUNT; b++) {
    const f0 = 2 ** (loLog + ((hiLog - loLog) * b) / BAND_COUNT);
    const f1 = 2 ** (loLog + ((hiLog - loLog) * (b + 1)) / BAND_COUNT);
    out[b] = bandEnergy(mag, sampleRate, fftSize, f0, f1);
  }
  return out;
}

function percentile95(series: Float32Array): number {
  const sorted = Float32Array.from(series).sort();
  return sorted[Math.floor(sorted.length * 0.95)] || 1e-9;
}

/** 0..1 に正規化 (95パーセンタイルでクリップ)。JIZURA の正規化方法を参考にしている。 */
function normalize(series: Float32Array): Float32Array {
  const p95 = percentile95(series);
  const out = new Float32Array(series.length);
  for (let i = 0; i < series.length; i++) out[i] = Math.min(1, series[i]! / p95);
  return out;
}

/**
 * 複数シリーズを「同じ基準」で 0..1 に正規化する。bass/mid/high のように互いの大小を
 * 比較する必要があるシリーズは、これぞれ独立に normalize() すると相対関係が失われるため、
 * 共通の 95 パーセンタイル (各シリーズの p95 の最大値) を基準にする。
 */
function normalizeTogether(seriesList: Float32Array[]): Float32Array[] {
  const ref = Math.max(...seriesList.map(percentile95), 1e-9);
  return seriesList.map((series) => {
    const out = new Float32Array(series.length);
    for (let i = 0; i < series.length; i++) out[i] = Math.min(1, series[i]! / ref);
    return out;
  });
}

/** 自己相関によるテンポ推定 (70..180 BPM) + 放物線補間 + 位相探索。 */
function estimateTempo(onset: Float32Array, frameRate: number, duration: number): { bpm: number; beats: number[] } {
  const n = onset.length;
  const minLag = Math.round((frameRate * 60) / 180);
  const maxLag = Math.round((frameRate * 60) / 70);
  let bestLag = Math.round(frameRate * 0.5);
  let best = -Infinity;
  const scores = new Map<number, number>();
  for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
    let s = 0;
    for (let f = lag; f < n; f++) s += onset[f]! * onset[f - lag]!;
    scores.set(lag, s);
    if (s > best) { best = s; bestLag = lag; }
  }
  let lagF = bestLag;
  const a = scores.get(bestLag - 1), b = scores.get(bestLag), c = scores.get(bestLag + 1);
  if (a != null && b != null && c != null) {
    const d = a - 2 * b + c;
    if (d !== 0) lagF = bestLag + (0.5 * (a - c)) / d;
  }
  const period = lagF / frameRate;
  const bpm = period > 0 ? Math.round(((60 / period) * 10)) / 10 : 0;

  // 位相探索: onset の合計が最大になる開始位相を選ぶ
  let bestPhase = 0, bestPhaseScore = -Infinity;
  const lagInt = Math.max(1, Math.round(lagF));
  for (let ph = 0; ph < lagInt; ph++) {
    let s = 0;
    for (let f = ph; f < n; f += lagInt) s += onset[f] ?? 0;
    if (s > bestPhaseScore) { bestPhaseScore = s; bestPhase = ph; }
  }
  const beats: number[] = [];
  if (period > 0) {
    for (let t = bestPhase / frameRate; t < duration; t += period) beats.push(+t.toFixed(4));
  }
  return { bpm, beats };
}

export interface AnalyzeOptions {
  frameRate?: number;
  fftSize?: number;
}

/** 2 次の IIR フィルタ (RBJ の式)。kind = 'hp' (ハイパス) / 'lp' (ローパス)、Q = 1/√2 */
function biquad(x: Float32Array, sampleRate: number, hz: number, kind: 'hp' | 'lp'): Float32Array {
  const w0 = (2 * Math.PI * Math.min(hz, sampleRate * 0.45)) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = (kind === 'hp' ? (1 + cos) / 2 : (1 - cos) / 2) / a0;
  const b1 = (kind === 'hp' ? -(1 + cos) : 1 - cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Number.isFinite(x[i]!) ? x[i]! : 0;
    const o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = o;
    y[i] = o;
  }
  return y;
}

function blockRms(x: Float32Array, hop: number, count: number): Float32Array {
  const out = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    let sum = 0;
    const start = b * hop;
    const end = Math.min(x.length, start + hop);
    for (let i = start; i < end; i++) {
      const v = x[i]!;
      if (Number.isFinite(v)) sum += v * v;
    }
    out[b] = Math.sqrt(sum / Math.max(1, end - start));
  }
  return out;
}

/** 細かい時刻の音量 (FINE_RATE 回/秒の RMS)。音全体と、歌声の帯域 (300Hz〜3kHz を 2 次のフィルタで取り出す) */
export function fineEnvelope(mono: Float32Array, sampleRate: number, rate = FINE_RATE): FineEnvelope {
  const hop = Math.max(1, Math.round(sampleRate / rate));
  const count = Math.ceil(mono.length / hop);
  const band = biquad(biquad(mono, sampleRate, VOCAL_HZ[0], 'hp'), sampleRate, VOCAL_HZ[1], 'lp');
  return { rate: sampleRate / hop, energy: blockRms(mono, hop, count), vocal: blockRms(band, hop, count) };
}

/**
 * モノラル PCM (Float32Array, -1..1) から AudioAnalysis を計算する。ブラウザ非依存の純粋関数で、
 * AudioContext を必要としないため単体テストで合成信号を直接渡せる。
 */
export function analyzeSamples(mono: Float32Array, sampleRate: number, opts: AnalyzeOptions = {}): AudioAnalysis {
  const frameRate = opts.frameRate ?? FRAME_RATE;
  const fftSize = opts.fftSize ?? nextPow2(Math.round(sampleRate * 0.05)); // 約50msの窓
  const hop = Math.max(1, Math.round(sampleRate / frameRate));
  const duration = mono.length / sampleRate;
  const frameCount = Math.max(1, Math.floor(mono.length / hop));
  const window = hannWindow(fftSize);

  const times = new Float32Array(frameCount);
  const bassRaw = new Float32Array(frameCount);
  const midRaw = new Float32Array(frameCount);
  const highRaw = new Float32Array(frameCount);
  const vocalRaw = new Float32Array(frameCount);
  const rms = new Float32Array(frameCount);
  const peak = new Float32Array(frameCount);
  const spectralEnergyRaw = new Float32Array(frameCount);
  const fluxRaw = new Float32Array(frameCount);
  const bandsRaw: Float32Array[] = [];

  let prevMag: Float64Array | null = null;
  const windowed = new Float64Array(fftSize);

  for (let f = 0; f < frameCount; f++) {
    const center = f * hop;
    times[f] = center / sampleRate;

    // RMS/peak は窓なしの生サンプル (ホップ幅) から計算する
    let sumSq = 0, pk = 0;
    const rmsStart = Math.max(0, center - hop / 2);
    const rmsEnd = Math.min(mono.length, center + hop / 2);
    for (let i = rmsStart; i < rmsEnd; i++) {
      const v = mono[i] ?? 0;
      sumSq += v * v;
      const av = Math.abs(v);
      if (av > pk) pk = av;
    }
    rms[f] = Math.sqrt(sumSq / Math.max(1, rmsEnd - rmsStart));
    peak[f] = pk;

    // FFT 用の窓 (中心 center, 長さ fftSize, 範囲外は 0 埋め)
    const start = center - fftSize / 2;
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      const s = idx >= 0 && idx < mono.length ? mono[idx]! : 0;
      windowed[i] = s * window[i]!;
    }
    const mag = magnitudeSpectrum(windowed);

    bassRaw[f] = bandEnergy(mag, sampleRate, fftSize, BASS_HZ[0], BASS_HZ[1]);
    midRaw[f] = bandEnergy(mag, sampleRate, fftSize, MID_HZ[0], MID_HZ[1]);
    highRaw[f] = bandEnergy(mag, sampleRate, fftSize, HIGH_HZ[0], HIGH_HZ[1]);
    vocalRaw[f] = bandEnergy(mag, sampleRate, fftSize, VOCAL_HZ[0], VOCAL_HZ[1]);
    bandsRaw.push(logBands(mag, sampleRate, fftSize));

    let energy = 0;
    for (let k = 0; k < mag.length; k++) energy += mag[k]! * mag[k]!;
    spectralEnergyRaw[f] = Math.sqrt(energy / mag.length);

    let flux = 0;
    if (prevMag) {
      for (let k = 0; k < mag.length; k++) {
        const d = mag[k]! - prevMag[k]!;
        if (d > 0) flux += d;
      }
    }
    fluxRaw[f] = flux;
    prevMag = mag;
  }

  // bass/mid/high は互いの大小関係が意味を持つため、共通の基準で正規化する
  const [bass, mid, high] = normalizeTogether([bassRaw, midRaw, highRaw]) as [Float32Array, Float32Array, Float32Array];
  const spectralEnergy = normalize(spectralEnergyRaw);
  const flux = normalize(fluxRaw);

  // 歌声らしさ: 帯域エネルギー (正規化) と、その帯域自身の立ち上がり (onset) を合成する
  const vocalBand = normalize(vocalRaw);
  const vocalOnsetRaw = new Float32Array(frameCount);
  for (let f = 1; f < frameCount; f++) vocalOnsetRaw[f] = Math.max(0, vocalRaw[f]! - vocalRaw[f - 1]!);
  const vocalOnset = normalize(vocalOnsetRaw);
  const vocalLikeness = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) vocalLikeness[f] = Math.min(1, 0.6 * vocalBand[f]! + 0.4 * vocalOnset[f]!);

  // 64帯域も同じ 95 パーセンタイル基準で正規化する (帯域間で比較できるよう全体の 1 つの基準を使う)
  let allMax = 0;
  for (const b of bandsRaw) for (let i = 0; i < b.length; i++) if (b[i]! > allMax) allMax = b[i]!;
  const bands = bandsRaw.map((b) => {
    const out = new Float32Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = allMax > 0 ? Math.min(1, b[i]! / allMax) : 0;
    return out;
  });

  // 無音/ほぼ無音のクリップでは onset がほぼ 0 になり、自己相関が意味のない BPM を拾ってしまうため弾く
  const fluxSum = fluxRaw.reduce((s, v) => s + v, 0);
  const hasOnsetSignal = fluxSum > 1e-6 * frameCount;
  const { bpm, beats } = hasOnsetSignal ? estimateTempo(flux, frameRate, duration) : { bpm: 0, beats: [] };
  const fine = fineEnvelope(mono, sampleRate);

  return {
    frameRate, duration, sampleRate, times,
    bass, mid, high, rms, peak, spectralEnergy, flux, vocalLikeness, bands,
    bpm, beats, fine,
  };
}
