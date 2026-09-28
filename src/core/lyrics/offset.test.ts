import { describe, expect, it } from 'vitest';
import { makeRng } from '../random';
import type { OnsetCandidate } from './candidates';
import { estimateOffset } from './offset';

/** 行の開始 + shift の位置に強い候補、ほかに弱い候補 (伴奏などの雑音) をばらまく */
function scenario(shift: number, seed = 3): { starts: number[]; cands: OnsetCandidate[] } {
  const rng = makeRng(seed);
  const starts: number[] = [];
  for (let t = 5; t < 120; t += 2 + rng() * 4) starts.push(Math.round(t * 100) / 100);
  const cands: OnsetCandidate[] = starts.map((s) => ({ t: s + shift + (rng() - 0.5) * 0.04, strength: 0.6 + rng() * 0.4 }));
  for (let i = 0; i < 150; i++) cands.push({ t: rng() * 125, strength: rng() * 0.35 });
  return { starts, cands };
}

describe('estimateOffset', () => {
  it('LRC が全体的に 0.8 秒早い → +0.8 秒を提案する', () => {
    const { starts, cands } = scenario(0.8);
    const e = estimateOffset(starts, cands)!;
    expect(e.offset).toBeCloseTo(0.8, 1);
    expect(Math.abs(e.offset - 0.8)).toBeLessThanOrEqual(0.03);
    expect(e.score).toBeGreaterThan(e.zeroScore * 2);
    expect(e.matched).toBeGreaterThan(0.9);
    expect(e.zeroMatched).toBeLessThan(e.matched);
  });

  it('遅れている場合は負の値、ずれていなければ 0 付近', () => {
    const late = scenario(-1.7, 9);
    expect(Math.abs(estimateOffset(late.starts, late.cands)!.offset + 1.7)).toBeLessThanOrEqual(0.03);
    const aligned = scenario(0, 4);
    expect(Math.abs(estimateOffset(aligned.starts, aligned.cands)!.offset)).toBeLessThanOrEqual(0.03);
  });

  it('探す範囲の外のずれは見つけない (範囲内の最善を返す)', () => {
    const { starts, cands } = scenario(4);
    const e = estimateOffset(starts, cands, { range: 2 })!;
    expect(Math.abs(e.offset)).toBeLessThanOrEqual(2);
    expect(e.matched).toBeLessThan(0.5);
  });

  it('行か候補が無ければ null。NaN は無視する', () => {
    expect(estimateOffset([], [{ t: 1, strength: 1 }])).toBeNull();
    expect(estimateOffset([1], [])).toBeNull();
    expect(estimateOffset([Number.NaN], [{ t: 1, strength: 1 }])).toBeNull();
    const e = estimateOffset([1, Number.NaN], [{ t: 1.5, strength: 1 }, { t: Number.NaN, strength: 1 }], { range: 1 })!;
    expect(e.offset).toBeCloseTo(0.5, 5);
  });
});
