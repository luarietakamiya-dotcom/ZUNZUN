import { describe, expect, it } from 'vitest';
import { makeRng } from '../random';
import type { OnsetCandidate } from './candidates';
import { snapAllLines } from './snap-all';

/** 本当の歌い出し (強い候補) と、その前後 0.12 秒の弱い候補 (伴奏) */
function scene(truth: number[], weak = 0.3): OnsetCandidate[] {
  const c: OnsetCandidate[] = [];
  for (const t of truth) c.push({ t, strength: 0.9 }, { t: t - 0.12, strength: weak }, { t: t + 0.12, strength: weak });
  return c;
}

describe('snapAllLines', () => {
  it('毎回 0.1 秒遅れて叩くくせを見積もって補正し、本当の歌い出しに寄せる', () => {
    const truth = [2, 5.3, 8.1, 11.6, 14.2, 17];
    const rng = makeRng(5);
    const taps: Record<string, number> = {};
    truth.forEach((t, i) => (taps[String(i)] = t + 0.1 + (rng() - 0.5) * 0.06));
    const r = snapAllLines(taps, scene(truth), []);
    expect(r.bias).toBeLessThan(-0.05);
    expect(r.lines.map((l) => l.to)).toEqual(truth);
    expect(r.lines.every((l) => l.kind === 'candidate')).toBe(true);
  });

  it('近さだけでなく強さも見る: 少し遠くても強い候補を選ぶ', () => {
    const r = snapAllLines({ '0': 1.0 }, [{ t: 1.02, strength: 0.2 }, { t: 1.08, strength: 0.9 }], [], { minLinesForBias: 99 });
    expect(r.lines[0]).toMatchObject({ to: 1.08, kind: 'candidate' });
  });

  it('候補が無ければビート、どちらも無ければそのまま (くせは 3 行未満なら使わない)', () => {
    const r = snapAllLines({ '0': 1.0, '1': 3.0 }, [], [0.5, 1.1, 2.0]);
    expect(r.bias).toBe(0);
    expect(r.lines.map((l) => [l.to, l.kind])).toEqual([
      [1.1, 'beat'],
      [3.0, 'none'],
    ]);
  });

  it('行の順番は崩さない: 2 行が同じ候補の近くにあっても、後の行は前の行より後ろになる', () => {
    const r = snapAllLines({ '0': 1.0, '1': 1.04 }, [{ t: 1.02, strength: 1 }], [], { minLinesForBias: 99 });
    expect(r.lines[0]!.to).toBe(1.02);
    expect(r.lines[1]!.to).toBeGreaterThanOrEqual(1.07);
  });

  it('lineTimes に無い行や、行番号でないキー・NaN は動かさない', () => {
    const r = snapAllLines({ '0': 1.0, '2': Number.NaN, x: 5 } as Record<string, number>, [{ t: 1.05, strength: 1 }], []);
    expect(r.lineTimes['0']).toBe(1.05);
    expect(Number.isNaN(r.lineTimes['2'])).toBe(true);
    expect(r.lineTimes.x).toBe(5);
    expect(r.lines).toHaveLength(1);
  });

  it('くせの補正は ±0.25 秒まで', () => {
    const truth = [2, 4, 6, 8];
    const taps = Object.fromEntries(truth.map((t, i) => [String(i), t + 0.28]));
    const r = snapAllLines(taps, scene(truth), [], { biasRange: 0.4, windowSec: 0.15 });
    expect(r.bias).toBe(-0.25);
  });
});
