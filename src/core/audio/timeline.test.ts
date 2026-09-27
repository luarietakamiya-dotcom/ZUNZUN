import { describe, expect, it } from 'vitest';
import { analyzeSamples } from './analyze';
import { AudioTimeline } from './timeline';

function clickTrain(bpm: number, sampleRate: number, seconds: number, offset = 0.2): Float32Array {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  const period = 60 / bpm;
  for (let t = offset; t < seconds; t += period) {
    const idx = Math.round(t * sampleRate);
    for (let k = 0; k < 30 && idx + k < n; k++) out[idx + k] = (1 - k / 30) * (k % 2 === 0 ? 1 : -1);
  }
  return out;
}

describe('AudioTimeline', () => {
  const sr = 44100;
  const bpm = 120;
  const analysis = analyzeSamples(clickTrain(bpm, sr, 4), sr);
  const tl = new AudioTimeline(analysis);

  it('exposes duration and bpm from the analysis', () => {
    expect(tl.duration).toBeCloseTo(4, 5);
    expect(tl.bpm).toBeCloseTo(bpm, 0);
  });

  it('pulses beat near 1 right after a beat and decays afterward', () => {
    const beatTime = analysis.beats[2]!;
    const atBeat = tl.at(beatTime + 0.001);
    const later = tl.at(beatTime + 0.3);
    expect(atBeat.beat).toBeGreaterThan(0.9);
    expect(atBeat.beatIndex).toBe(2);
    expect(later.beat).toBeLessThan(atBeat.beat);
  });

  it('computes dt from the given previous time', () => {
    const f = tl.at(1.0, 0.9);
    expect(f.dt).toBeCloseTo(0.1, 9);
  });

  it('clamps out-of-range times to [0, duration]', () => {
    expect(tl.at(-5).t).toBe(0);
    expect(tl.at(1000).t).toBe(tl.duration);
  });

  it('handles an analysis with zero frames without throwing', () => {
    const empty = analyzeSamples(new Float32Array(0), sr);
    const emptyTl = new AudioTimeline(empty);
    expect(() => emptyTl.at(0)).not.toThrow();
    expect(emptyTl.at(0).beatIndex).toBe(-1);
  });
});
