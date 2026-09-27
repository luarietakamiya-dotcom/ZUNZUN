import type { AudioFrame, CommonParams } from '../types';

/**
 * 共通パラメータ (Sensitivity / Bass / Mid / High) を AudioFrame に掛けて、
 * プリセットがそのまま使える 0..1 の値に整える小さなヘルパー。
 *
 * docs/ARCHITECTURE.md の「感度の補正は Host が AudioFrame を渡す前に適用し、プリセットは常に 0..1 を受け取る」
 * に対応する処理。既存のデバッグ用プリセットは自前で sensitivity を掛けているため、Host には組み込まず
 * (= 既存プリセットの見た目を変えず)、Solar Gate 以降のプリセットがこれを呼ぶ形にしている。
 * 純粋関数なので Vitest で検証できる。
 */

export interface ShapedAudio {
  bass: number;
  mid: number;
  high: number;
  rms: number;
  peak: number;
  /** ビートパルスは感度で増幅しない (0..1 の減衰カーブの形を保つため) */
  beat: number;
  flux: number;
  spectralEnergy: number;
}

/**
 * 64 帯域 (20Hz..Nyquist の対数間隔) のうち、おおよそ 250Hz 未満を低域、4kHz 未満を中域、それ以上を高域とみなす境界。
 * core/audio/analyze.ts の帯域分割 (44.1/48kHz) から計算した近似値。
 */
export const BASS_BAND_END = 23;
export const MID_BAND_END = 48;

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/** Sensitivity (0..1) を入力の倍率に変換する。既定値 0.6 でおよそ 1.1 倍、0 で 0.35 倍、1 で 1.65 倍。 */
export function sensitivityGain(sensitivity: number): number {
  return 0.35 + clamp01(Number.isFinite(sensitivity) ? sensitivity : 0) * 1.3;
}

export function shapeAudio(frame: AudioFrame, params: CommonParams): ShapedAudio {
  const g = sensitivityGain(params.sensitivity);
  return {
    bass: clamp01(frame.bass * g * params.bass),
    mid: clamp01(frame.mid * g * params.mid),
    high: clamp01(frame.high * g * params.high),
    rms: clamp01(frame.rms * g),
    peak: clamp01(frame.peak * g),
    beat: clamp01(frame.beat),
    flux: clamp01(frame.flux * g),
    spectralEnergy: clamp01(frame.spectralEnergy),
  };
}

/**
 * 帯域ごとの値に Sensitivity と Bass/Mid/High 倍率を掛けて out に書き込む (毎フレーム割り当てを避けるため out を再利用する)。
 * out の長さが bands より短ければ、その分だけ処理する。
 */
export function shapeBands(bands: Float32Array, params: CommonParams, out: Float32Array): Float32Array {
  const g = sensitivityGain(params.sensitivity);
  const n = Math.min(bands.length, out.length);
  for (let i = 0; i < n; i++) {
    const weight = i < BASS_BAND_END ? params.bass : i < MID_BAND_END ? params.mid : params.high;
    out[i] = clamp01((bands[i] ?? 0) * g * weight);
  }
  return out;
}
