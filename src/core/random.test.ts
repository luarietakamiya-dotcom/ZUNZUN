import { describe, expect, it } from 'vitest';
import { deriveSeed, hashString, makeRng } from './random';

describe('makeRng', () => {
  it('is deterministic for the same seed', () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces values in [0, 1)', () => {
    const rng = makeRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs for different seeds', () => {
    const a = makeRng(1)();
    const b = makeRng(2)();
    expect(a).not.toBe(b);
  });

  it('range/int/pick/chance stay within bounds', () => {
    const rng = makeRng(42);
    for (let i = 0; i < 200; i++) {
      const r = rng.range(2, 5);
      expect(r).toBeGreaterThanOrEqual(2);
      expect(r).toBeLessThan(5);
      const n = rng.int(2, 5);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
      const p = rng.pick(['a', 'b', 'c']);
      expect(['a', 'b', 'c']).toContain(p);
      expect(typeof rng.chance(0.5)).toBe('boolean');
    }
  });
});

describe('hashString / deriveSeed', () => {
  it('is stable for the same input', () => {
    expect(hashString('solar-gate')).toBe(hashString('solar-gate'));
  });

  it('differs for different presets given the same base seed', () => {
    const a = deriveSeed(20260927, 'solar-gate');
    const b = deriveSeed(20260927, 'milky-way');
    expect(a).not.toBe(b);
  });

  it('derived seed is deterministic', () => {
    expect(deriveSeed(1, 'x')).toBe(deriveSeed(1, 'x'));
  });
});
