import type { AudioAnalysis } from './analyze';

/**
 * 曲全体の「曲調」と区間の境目 (2026-10-04 ユーザー「曲調に合わせて色やパターンを変換」。ビジュアライザーが
 * 「この曲の中で、いまどのくらい激しいか」「区間が変わったか」を知るための、解析結果からの前計算)。
 * 曲の読み込み時の解析結果だけから決まる (再生位置や過去のフレームに依存しない) ので、プレビューで再生位置を飛ばしても、
 * 書き出しでも、同じ時刻なら同じ値になる。
 */

export interface SongMood {
  /** 解析のフレームごとの曲調 0..1 (0 = この曲の中で静かな所、1 = いちばん激しい所) */
  mood: Float32Array;
  /** 音の変化から見つけた区間の境目 (秒。昇順。曲の頭と終わりは含まない) */
  autoBoundaries: number[];
}

/** 曲調をならす窓の半分 (秒): 前後 3 秒を 2 回 = 数秒の変化は均され、サビの入りのような持続する変化だけが残る */
const MOOD_SMOOTH_SEC = 3;
/** 区間の境目を探す窓 (秒): 前後この長さの曲調の平均の差を見る */
const NOVELTY_WINDOW_SEC = 8;
/** 境目になる差のしきい値 (曲調 0..1 の差 + 音の明るさの差の半分) と、境目どうしの最小の間隔 (秒) */
const NOVELTY_THRESHOLD = 0.2;
const MIN_SECTION_SEC = 14;
/** 曲の頭と終わりのこの秒数以内には境目を作らない */
const EDGE_SEC = 8;

/** 昇順にした配列のパーセンタイル (0..1) */
function percentile(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]!;
}

/** 前後 half 個ずつの移動平均 (端は寄せる)。prefix sum で O(n) */
function boxSmooth(src: Float32Array, half: number): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  if (n === 0) return out;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + src[i]!;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = (prefix[b]! - prefix[a]!) / (b - a);
  }
  return out;
}

const fin = (v: number): number => (Number.isFinite(v) ? v : 0);

export function buildSongMood(a: AudioAnalysis): SongMood {
  const n = a.rms.length;
  if (n === 0) return { mood: new Float32Array(0), autoBoundaries: [] };
  const rate = a.frameRate > 0 ? a.frameRate : 60;

  // この曲の中での大きさ: 95 パーセンタイルを 1 として、音量と音の動き (flux) を混ぜる
  const sortedRms = Float32Array.from(a.rms, fin).sort();
  const sortedFlux = Float32Array.from(a.flux, fin).sort();
  const rmsRef = Math.max(percentile(sortedRms, 0.95), 1e-4);
  const fluxRef = Math.max(percentile(sortedFlux, 0.95), 1e-4);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = 0.7 * Math.min(1, fin(a.rms[i]!) / rmsRef) + 0.3 * Math.min(1, fin(a.flux[i]!) / fluxRef);

  // ならす (窓の半分 × 2 回) → 曲の中で 10〜90 パーセンタイルが 0〜1 になるように広げる (どの曲でも全体を使う)
  const half = Math.max(1, Math.round(MOOD_SMOOTH_SEC * rate));
  const smooth = boxSmooth(boxSmooth(raw, half), half);
  const sorted = Float32Array.from(smooth).sort();
  const p10 = percentile(sorted, 0.1);
  const p90 = percentile(sorted, 0.9);
  const span = p90 - p10;
  const mood = new Float32Array(n);
  for (let i = 0; i < n; i++) mood[i] = span < 0.04 ? 0.5 : Math.min(1, Math.max(0, (smooth[i]! - p10) / span));

  return { mood, autoBoundaries: findBoundaries(a, raw, rate) };
}

/** 曲調 (短くならしたもの) と音の明るさの、前後の差が大きい所を、区間の境目にする */
function findBoundaries(a: AudioAnalysis, raw: Float32Array, rate: number): number[] {
  const n = raw.length;
  const duration = a.duration > 0 ? a.duration : n / rate;
  const blocks = Math.floor(duration);
  const w = NOVELTY_WINDOW_SEC;
  if (blocks < 2 * w + 2) return [];
  // 1 秒ごとの平均 (曲調と音の明るさ)
  const fast = boxSmooth(raw, Math.round(rate * 0.5));
  const bm = new Float64Array(blocks);
  const be = new Float64Array(blocks);
  for (let k = 0; k < blocks; k++) {
    const i0 = Math.min(n - 1, Math.floor(k * rate));
    const i1 = Math.min(n, Math.max(i0 + 1, Math.floor((k + 1) * rate)));
    let sm = 0;
    let se = 0;
    for (let i = i0; i < i1; i++) {
      sm += fast[i]!;
      se += fin(a.spectralEnergy[i] ?? 0);
    }
    bm[k] = sm / (i1 - i0);
    be[k] = se / (i1 - i0);
  }
  const mean = (arr: Float64Array, from: number, to: number): number => {
    let s = 0;
    for (let k = from; k < to; k++) s += arr[k]!;
    return s / Math.max(1, to - from);
  };
  const novelty = new Float64Array(blocks);
  for (let k = w; k <= blocks - w; k++) {
    novelty[k] = Math.abs(mean(bm, k, k + w) - mean(bm, k - w, k)) + 0.5 * Math.abs(mean(be, k, k + w) - mean(be, k - w, k));
  }
  // 局所の山 (前後 ±3 秒で最大) のうち、しきい値を超えるものを、大きい順に、間隔を空けて採る
  const peaks: { k: number; v: number }[] = [];
  for (let k = Math.max(w, EDGE_SEC); k <= Math.min(blocks - w, Math.floor(duration - EDGE_SEC)); k++) {
    const v = novelty[k]!;
    if (v < NOVELTY_THRESHOLD) continue;
    let isMax = true;
    for (let j = Math.max(0, k - 3); j <= Math.min(blocks - 1, k + 3); j++) if (novelty[j]! > v) isMax = false;
    if (isMax) peaks.push({ k, v });
  }
  peaks.sort((x, y) => y.v - x.v);
  const picked: number[] = [];
  for (const p of peaks) if (picked.every((q) => Math.abs(q - p.k) >= MIN_SECTION_SEC)) picked.push(p.k);
  return picked.sort((x, y) => x - y);
}
