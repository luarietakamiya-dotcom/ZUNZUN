import { describe, expect, it } from 'vitest';
import type { AudioAnalysis } from '../audio/analyze';
import { lyricSyncTargets, stemState } from './stem';
import { syncTargetsFor } from './view';

const SHA = 'a'.repeat(64);

/** 歌声らしさが frames の位置で段になって大きくなる解析結果 (ビートは beats) */
function analysis(steps: number[], beats: number[]): AudioAnalysis {
  const vocal = new Float32Array(600);
  for (const f of steps) vocal.fill(0.8, f, f + 30);
  return { vocalLikeness: vocal, frameRate: 60, beats } as unknown as AudioAnalysis;
}

describe('stemState', () => {
  it('オフ・未読み込み・別のファイル・使っている (長さの差つき)', () => {
    expect(stemState(null, null)).toEqual({ kind: 'off' });
    expect(stemState({ ref: 'v.wav', sha256: SHA, enabled: false }, { sha256: SHA, duration: 10 })).toEqual({ kind: 'off' });
    const on = { ref: 'v.wav', sha256: SHA, enabled: true };
    expect(stemState(on, null)).toEqual({ kind: 'missing' });
    expect(stemState(on, { sha256: 'b'.repeat(64), duration: 10 })).toEqual({ kind: 'mismatch' });
    expect(stemState(on, { sha256: SHA, duration: 10.8 }, 10)).toEqual({ kind: 'active', durationGap: expect.closeTo(0.8) });
    expect(stemState(on, { sha256: SHA, duration: 10 })).toEqual({ kind: 'active', durationGap: 0 });
  });
});

describe('lyricSyncTargets', () => {
  const main = analysis([60, 200, 400], [1, 2, 3]);
  const stem = analysis([120], [9]);

  it('stem を使わないときは元の曲の吸着先そのまま', () => {
    expect(lyricSyncTargets(main, null)).toBe(syncTargetsFor(main));
    expect(lyricSyncTargets(null, null)).toEqual({ onsets: [], candidates: [], beats: [] });
  });

  it('stem を使うときは、歌い出し候補を stem から、ビートを元の曲から取る (組み合わせごとに同じものを返す)', () => {
    const t = lyricSyncTargets(main, stem);
    expect(t.candidates).toEqual(syncTargetsFor(stem).candidates);
    expect(t.candidates).toHaveLength(1);
    expect(t.beats).toEqual([1, 2, 3]);
    expect(lyricSyncTargets(main, stem)).toBe(t);
    expect(lyricSyncTargets(null, stem).beats).toEqual([]);
  });
});
