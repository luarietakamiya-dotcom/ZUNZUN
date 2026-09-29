import type { RhythmGrid } from './grid';

/**
 * 小節の確認用のクリック音 (Lyrics タブの「リズム (変拍子)」欄)。小節の頭は高い音、まとまりの頭は低い音。
 * 曲と同じ長さの「クリック音だけの音源」を作り、曲と同じ位置から同時に再生する (AudioPlayer.setOverlay)。
 * 同じ AudioContext で鳴らすので、シーク・一時停止・出力の遅れも曲とそろう。
 */

/** クリック音の長さ (秒) */
const CLICK_LEN = 0.03;

export function clickTrackSamples(grid: Pick<RhythmGrid, 'pulses'>, duration: number, sampleRate: number): Float32Array<ArrayBuffer> {
  const n = Math.max(1, Math.ceil(Math.max(0, duration) * sampleRate));
  const out = new Float32Array(n);
  const len = Math.round(CLICK_LEN * sampleRate);
  for (const p of grid.pulses) {
    if (!Number.isFinite(p.t) || p.t < 0) continue;
    const i0 = Math.round(p.t * sampleRate);
    if (i0 >= n) break;
    const hz = p.barHead ? 1760 : 880;
    const amp = p.barHead ? 0.55 : 0.3;
    for (let i = 0; i < len && i0 + i < n; i++) {
      const d = i / sampleRate;
      // 立ち上がり 1ms、そのあと速く減衰 (耳に残らない短い「チッ」)
      const env = Math.min(1, d / 0.001) * Math.exp(-d * 140);
      out[i0 + i] = out[i0 + i]! + amp * env * Math.sin(2 * Math.PI * hz * d);
    }
  }
  return out;
}
