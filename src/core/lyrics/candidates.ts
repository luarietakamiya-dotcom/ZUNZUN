/**
 * 歌い出し候補: 歌声らしさ (AudioAnalysis.vocalLikeness、300Hz〜3kHz 帯のエネルギー + 立ち上がり) が
 * 急に強くなる瞬間を拾う。タップした時刻の吸着先 (snap.ts) と、LRC/SRT の全体オフセット推定 (offset.ts) に使う。
 * docs/ARCHITECTURE.md「歌詞同期の方針」の「歌い出し候補は…歌声らしさから求めます」に対応する。
 */

export interface OnsetCandidate {
  /** 秒 */
  t: number;
  /** 立ち上がりの強さ (0..1 程度) */
  strength: number;
}

export interface CandidateOptions {
  /** 立ち上がりを測る幅 (秒)。この間にどれだけ強くなったかを見る */
  riseWindow?: number;
  /** 候補どうしの最短間隔 (秒)。近すぎる候補は強い方だけ残す */
  minGap?: number;
  /** 立ち上がりの強さがこのパーセンタイルより上のものだけ候補にする (0..1) */
  percentile?: number;
  /** しきい値の下限 (ほぼ無音の曲で雑音を拾わないように) */
  minStrength?: number;
}

export function findOnsetCandidates(vocal: Float32Array, frameRate: number, opts: CandidateOptions = {}): OnsetCandidate[] {
  const n = vocal.length;
  if (n < 3 || !(frameRate > 0)) return [];
  const rise = Math.max(1, Math.round((opts.riseWindow ?? 0.05) * frameRate));
  const gap = Math.max(1, Math.round((opts.minGap ?? 0.12) * frameRate));

  // 3 フレームの移動平均で細かい揺れをならす
  const s = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const a = vocal[Math.max(0, f - 1)]!;
    const b = vocal[f]!;
    const c = vocal[Math.min(n - 1, f + 1)]!;
    s[f] = Number.isFinite(a + b + c) ? (a + b + c) / 3 : 0;
  }
  // 立ち上がり = rise フレーム前からの増加分
  const d = new Float32Array(n);
  for (let f = rise; f < n; f++) d[f] = Math.max(0, s[f]! - s[f - rise]!);

  const positives = Array.from(d).filter((v) => v > 0).sort((x, y) => x - y);
  if (positives.length === 0) return [];
  const p = Math.min(1, Math.max(0, opts.percentile ?? 0.85));
  const threshold = Math.max(opts.minStrength ?? 0.02, positives[Math.min(positives.length - 1, Math.floor(p * positives.length))]!);

  const out: OnsetCandidate[] = [];
  for (let f = rise; f < n; f++) {
    const v = d[f]!;
    if (v < threshold) continue;
    // 前後 gap フレームの中で最大のところだけを候補にする (同じ値が続くときは最初の 1 つ)
    let isPeak = true;
    for (let k = Math.max(0, f - gap); k <= Math.min(n - 1, f + gap); k++) {
      if (d[k]! > v || (d[k] === v && k < f)) {
        isPeak = false;
        break;
      }
    }
    if (!isPeak) continue;
    // 立ち上がりの途中 (最大の傾きの位置) ではなく、立ち上がり始めに近い時刻にする
    const t = Math.max(0, (f - rise / 2) / frameRate);
    out.push({ t, strength: v });
  }
  return out;
}
