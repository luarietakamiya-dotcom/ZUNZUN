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

export interface RefineOptions {
  /** 候補の時刻より何秒前まで探すか。解析の窓のせいで候補は早めに出るので、前は狭く */
  before?: number;
  /** 候補の時刻より何秒後まで探すか */
  after?: number;
  /** 最大の増え方のこの割合以上に増えた最初の区間を出だしとする (合成音で 0.5 / 0.3 / 0.2 を比べ、雑音の中のゆっくりした声でも遅れない 0.2 にした) */
  threshold?: number;
  /** 音量をならす幅 (前後の区間の数) */
  smooth?: number;
}

/**
 * 候補の時刻を、細かい時刻の音量 (AudioAnalysis.fine、5ms ごとの RMS) で合わせ直す。
 * 解析の特徴量は約 46ms の窓の真ん中を時刻にしているため、鋭い出だしほど早い時刻に出る
 * (合成音で測ると、キック・クリックで約 30ms、立ち上がりの速い声で約 13ms 早い。ゆっくり立ち上がる声ではほぼ 0)。
 * 立ち上がりの速さでずれ方が違うので、一律に足すのではなく、候補の前後の音量の増え方から出だしを決める:
 * 範囲の中で (少しならした音量が) 最大の増え方の 2 割以上増えた「最初の」区間の頭を出だしとする。鋭い出だしはその 1 区間、
 * ゆっくり立ち上がる声は立ち上がりの始まりになる (最初は「いちばん増えた区間」にしていたが、60ms かけて大きくなる声では
 * どの区間もほぼ同じだけ増えるため、立ち上がりの途中が選ばれて 40〜50ms 遅れた)。
 * 探す範囲 (既定で 20ms 前〜50ms 後) の中で音量が増えていなければ、元の時刻のまま。強さは変えない。
 * 伴奏のある曲では、同じ帯域のほかの楽器の出だしに引っ張られることがあるので、範囲は狭くしている。
 */
export function refineOnsetTimes<T extends { t: number }>(items: readonly T[], env: Float32Array | undefined, rate: number, opts: RefineOptions = {}): T[] {
  if (!env || env.length < 2 || !(rate > 0)) return items.slice();
  const before = opts.before ?? 0.02;
  const after = opts.after ?? 0.05;
  const frac = opts.threshold ?? 0.2;
  const smooth = Math.max(0, Math.round(opts.smooth ?? 1));
  // 前後 smooth 区間でならした音量 (雑音の揺れで、ゆっくりした立ち上がりの始まりを見逃さないように)
  const lv = (i: number): number => {
    let sum = 0;
    let n = 0;
    for (let k = i - smooth; k <= i + smooth; k++) {
      if (k >= 0 && k < env.length) {
        sum += env[k]!;
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  };
  const out = items.map((it) => {
    if (!Number.isFinite(it.t)) return it;
    const i0 = Math.max(1, Math.floor((it.t - before) * rate));
    const i1 = Math.min(env.length - 1, Math.ceil((it.t + after) * rate));
    const rises: number[] = [];
    let maxRise = 0;
    for (let i = i0; i <= i1; i++) {
      const r = lv(i) - lv(i - 1);
      rises.push(r);
      if (r > maxRise) maxRise = r;
    }
    if (!(maxRise > 0)) return it;
    const k = rises.findIndex((r) => r >= maxRise * frac);
    // ならした分 (smooth 区間) だけ増え始めが前に出るので、その分を戻す
    return k < 0 ? it : { ...it, t: Math.round(((i0 + k + smooth) / rate) * 10000) / 10000 };
  });
  return out.sort((a, b) => a.t - b.t);
}
