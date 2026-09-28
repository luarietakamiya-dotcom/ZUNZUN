import { describe, expect, it } from 'vitest';
import { analyzeSamples } from '../audio/analyze';
import { makeRng } from '../random';
import { findOnsetCandidates } from './candidates';

const FPS = 60;

/** 小さな揺れのある低い値の上に、指定の時刻から 0.4 秒だけ強くなる区間を置いた歌声らしさ */
function synthVocal(seconds: number, onsets: number[], seed = 1): Float32Array {
  const rng = makeRng(seed);
  const out = new Float32Array(Math.round(seconds * FPS));
  for (let f = 0; f < out.length; f++) {
    const t = f / FPS;
    let v = 0.08 + rng() * 0.03;
    for (const o of onsets) if (t >= o && t < o + 0.4) v += 0.6 * Math.exp(-(t - o) * 2);
    out[f] = v;
  }
  return out;
}

describe('findOnsetCandidates', () => {
  it('歌声らしさが急に強くなる瞬間だけを候補にする', () => {
    const onsets = [1.0, 2.5, 4.0];
    const c = findOnsetCandidates(synthVocal(6, onsets), FPS);
    expect(c).toHaveLength(3);
    c.forEach((cand, i) => {
      expect(Math.abs(cand.t - onsets[i]!)).toBeLessThan(0.05);
      expect(cand.strength).toBeGreaterThan(0.2);
    });
  });

  it('打楽器のアタックや音の切れ目のような「一瞬だけの山」は候補にしない', () => {
    // 0.5 秒ごとに 2 フレームだけの山 (キックのアタック) と、歌の出だし 2 つ (続く音)
    const v = synthVocal(6, [1.3, 3.8]);
    for (let t = 0; t < 6; t += 0.5) {
      const f = Math.round(t * FPS);
      v[f] = (v[f] ?? 0) + 0.45;
      if (f + 1 < v.length) v[f + 1] = v[f + 1]! + 0.3;
    }
    const c = findOnsetCandidates(v, FPS);
    expect(c.map((x) => Math.round(x.t * 10) / 10)).toEqual([1.3, 3.8]);
  });

  it('ほぼ一定 (雑音だけ) なら候補は出ない、短すぎる入力は空', () => {
    expect(findOnsetCandidates(synthVocal(4, []), FPS)).toEqual([]);
    expect(findOnsetCandidates(new Float32Array(2), FPS)).toEqual([]);
    expect(findOnsetCandidates(new Float32Array(100), FPS)).toEqual([]);
    expect(findOnsetCandidates(synthVocal(4, [1]), 0)).toEqual([]);
  });

  it('NaN が混ざっても落ちず、時刻は有限', () => {
    const v = synthVocal(3, [1]);
    v[30] = Number.NaN;
    const c = findOnsetCandidates(v, FPS);
    expect(c.every((x) => Number.isFinite(x.t) && Number.isFinite(x.strength))).toBe(true);
  });

  it('実際の解析 (analyzeSamples) を通しても、声の帯域の音の出だしを拾う', () => {
    // 22.05kHz で、800Hz の音を 0.5 / 1.7 / 3.1 秒から 0.3 秒ずつ鳴らす (歌声の帯域 300Hz〜3kHz の中)
    const sr = 22050;
    const bursts = [0.5, 1.7, 3.1];
    const mono = new Float32Array(sr * 4);
    for (let i = 0; i < mono.length; i++) {
      const t = i / sr;
      for (const b of bursts) if (t >= b && t < b + 0.3) mono[i] = 0.5 * Math.sin(2 * Math.PI * 800 * t);
    }
    const a = analyzeSamples(mono, sr);
    const c = findOnsetCandidates(a.vocalLikeness, a.frameRate);
    for (const b of bursts) expect(c.some((x) => Math.abs(x.t - b) < 0.06)).toBe(true);
    // 音の途中や無音の区間には候補を出さない
    expect(c.every((x) => bursts.some((b) => Math.abs(x.t - b) < 0.06))).toBe(true);
  });
});
