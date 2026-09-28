/**
 * 波形の表示用に、音声を一定間隔の「最大振幅」の列に縮める (タイムラインの波形の段)。
 * 複数チャンネルは各区間の最大をとる。AudioBuffer に依存しないので Vitest で確かめられる。
 */

export interface Peaks {
  /** 1 秒あたりの区間の数 */
  binsPerSec: number;
  /** 各区間の最大振幅 (0..1) */
  max: Float32Array;
}

export function computePeaks(channels: readonly Float32Array[], sampleRate: number, binsPerSec = 200): Peaks {
  const length = channels.reduce((m, c) => Math.max(m, c.length), 0);
  if (length === 0 || !(sampleRate > 0)) return { binsPerSec, max: new Float32Array(0) };
  const per = sampleRate / binsPerSec;
  const bins = Math.ceil(length / per);
  const max = new Float32Array(bins);
  for (const ch of channels) {
    for (let b = 0; b < bins; b++) {
      const from = Math.floor(b * per);
      const to = Math.min(ch.length, Math.floor((b + 1) * per));
      let m = max[b]!;
      for (let i = from; i < to; i++) {
        const v = Math.abs(ch[i]!);
        if (v > m) m = v;
      }
      max[b] = Math.min(1, m);
    }
  }
  return { binsPerSec, max };
}

/** [t0, t1) の区間の最大振幅 */
export function peakBetween(p: Peaks, t0: number, t1: number): number {
  const a = Math.max(0, Math.floor(t0 * p.binsPerSec));
  const b = Math.min(p.max.length, Math.max(a + 1, Math.ceil(t1 * p.binsPerSec)));
  let m = 0;
  for (let i = a; i < b; i++) if (p.max[i]! > m) m = p.max[i]!;
  return m;
}
