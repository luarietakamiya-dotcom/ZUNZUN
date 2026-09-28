/**
 * 歌い出し候補: 歌声らしさ (AudioAnalysis.vocalLikeness、300Hz〜3kHz 帯のエネルギー + 立ち上がり) が
 * 「強くなって、その強さがしばらく続く」瞬間を拾う。タップした時刻の吸着先 (snap.ts) と、
 * LRC/SRT の全体オフセット推定 (offset.ts) に使う。docs/ARCHITECTURE.md「歌詞同期の方針」に対応する。
 *
 * 瞬間的な増加量 (1 フレームの差) で拾うと、キックなど打楽器のアタックや、音が切れたときのクリックも
 * 歌声帯域に一瞬だけ現れるため候補になってしまう (Lyrics タブで合成音源を鳴らして確認した)。
 * 歌声は出だしのあとも鳴り続けるので、「直後の中央値 − 直前の中央値」(段差の大きさ) で測る。
 * 平均ではなく中央値にするのは、窓の半分より短い山 (打楽器のアタックなど) を完全に無視するため。
 */

export interface OnsetCandidate {
  /** 秒 */
  t: number;
  /** 段差の大きさ (0..1 程度) */
  strength: number;
}

export interface CandidateOptions {
  /** 直前・直後の中央値を取る幅 (秒) */
  window?: number;
  /** 候補どうしの最短間隔 (秒)。近すぎる候補は強い方だけ残す */
  minGap?: number;
  /**
   * 段差がこのパーセンタイルより上のものだけ候補にする (0..1)。既定は 0 (使わない)。
   * 中央値の段差は本当の出だし以外ではほとんど 0 になるので、割合で切ると弱い出だしまで落としてしまう
   */
  percentile?: number;
  /** 最も大きい段差に対する下限の割合 (0..1)。打楽器などの小さな段差を落とす */
  relativeFloor?: number;
  /** しきい値の下限 (ほぼ無音の曲で雑音を拾わないように) */
  minStrength?: number;
}

export function findOnsetCandidates(vocal: Float32Array, frameRate: number, opts: CandidateOptions = {}): OnsetCandidate[] {
  const n = vocal.length;
  if (n < 3 || !(frameRate > 0)) return [];
  const w = Math.max(1, Math.round((opts.window ?? 0.12) * frameRate));
  const gap = Math.max(1, Math.round((opts.minGap ?? 0.12) * frameRate));

  const clean = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const v = vocal[f]!;
    clean[f] = Number.isFinite(v) ? v : 0; // NaN は 0 として扱う
  }
  const buf = new Float32Array(w);
  const median = (a: number, b: number): number => {
    const len = b - a;
    if (len <= 0) return 0;
    const view = buf.subarray(0, len);
    view.set(clean.subarray(a, b));
    view.sort();
    return len % 2 ? view[len >> 1]! : (view[len / 2 - 1]! + view[len / 2]!) / 2;
  };

  // 段差 = フレーム f から w フレームの中央値 − f の直前 w フレームの中央値
  const d = new Float32Array(n);
  for (let f = 1; f < n; f++) {
    const after = median(f, Math.min(n, f + w));
    const before = median(Math.max(0, f - w), f);
    d[f] = Math.max(0, after - before);
  }

  const positives = Array.from(d).filter((v) => v > 0).sort((x, y) => x - y);
  if (positives.length === 0) return [];
  const p = Math.min(1, Math.max(0, opts.percentile ?? 0));
  const maxStep = positives[positives.length - 1]!;
  const threshold = Math.max(
    opts.minStrength ?? 0.02,
    (opts.relativeFloor ?? 0.2) * maxStep,
    positives[Math.min(positives.length - 1, Math.floor(p * positives.length))]!,
  );

  const out: OnsetCandidate[] = [];
  for (let f = 1; f < n; f++) {
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
    // 中央値の段差は、本当の出だしの前後 ±w/2 フレームで同じ値の「台」になるため、そのままでは時刻が粗い。
    // 台の近くで 1 フレームあたりの増加がいちばん大きいフレーム (= 実際の立ち上がり) に時刻を合わせる
    let edge = f;
    let edgeRise = -Infinity;
    for (let k = Math.max(1, f - w); k <= Math.min(n - 1, f + w); k++) {
      const rise = clean[k]! - clean[k - 1]!;
      if (rise > edgeRise) {
        edgeRise = rise;
        edge = k;
      }
    }
    const t = edge / frameRate;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.t - t) < gap / frameRate) {
      if (v > prev.strength) out[out.length - 1] = { t, strength: v };
    } else out.push({ t, strength: v });
  }
  return out;
}
