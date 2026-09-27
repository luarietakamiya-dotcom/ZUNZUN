/**
 * 依存なしの radix-2 Cooley-Tukey FFT。実数入力専用 (虚部 0 から開始)。
 * size は 2 のべき乗である必要がある (呼び出し側で zero-pad する)。
 */
export function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length) throw new Error('re/im length mismatch');
  if (n & (n - 1)) throw new Error('fftRadix2: size must be a power of two');
  if (n <= 1) return;

  // ビット反転並べ替え
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curWr = 1, curWi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!, ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * curWr - im[i + k + len / 2]! * curWi;
        const vi = re[i + k + len / 2]! * curWi + im[i + k + len / 2]! * curWr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nWr = curWr * wr - curWi * wi;
        curWi = curWr * wi + curWi * wr;
        curWr = nWr;
      }
    }
  }
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Hann 窓を dst に書き込む。 */
export function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  return w;
}

/**
 * 実数波形の 1 フレーム分から振幅スペクトル (長さ size/2 + 1) を計算する。
 * frame の長さは size と一致していること (呼び出し側で切り出し/ゼロ埋め済み)。
 */
export function magnitudeSpectrum(frame: Float64Array): Float64Array {
  const n = frame.length;
  const re = Float64Array.from(frame);
  const im = new Float64Array(n);
  fftRadix2(re, im);
  const bins = n / 2 + 1;
  const mag = new Float64Array(bins);
  for (let k = 0; k < bins; k++) mag[k] = Math.hypot(re[k]!, im[k]!) / n;
  return mag;
}
