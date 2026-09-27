import { describe, expect, it } from 'vitest';
import { analyzeSamples } from './analyze';

function avg(arr: Float32Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i]!;
  return s / arr.length;
}

function sineWave(freq: number, sampleRate: number, seconds: number, amp = 0.8): Float32Array {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

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

describe('analyzeSamples', () => {
  const sr = 44100;

  it('makes a 60Hz tone read as bass-dominant', () => {
    const mono = sineWave(60, sr, 3);
    const a = analyzeSamples(mono, sr);
    expect(avg(a.bass)).toBeGreaterThan(avg(a.mid));
    expect(avg(a.bass)).toBeGreaterThan(avg(a.high));
  });

  it('makes a 6kHz tone read as high-dominant', () => {
    const mono = sineWave(6000, sr, 2);
    const a = analyzeSamples(mono, sr);
    expect(avg(a.high)).toBeGreaterThan(avg(a.bass));
    expect(avg(a.high)).toBeGreaterThan(avg(a.mid));
  });

  it('detects BPM from a click train within 1%', () => {
    const bpm = 120;
    const mono = clickTrain(bpm, sr, 4);
    const a = analyzeSamples(mono, sr);
    expect(Math.abs(a.bpm - bpm) / bpm).toBeLessThan(0.01);
  });

  it('places detected beats within 20ms of the true click times', () => {
    const bpm = 120;
    const period = 60 / bpm;
    const mono = clickTrain(bpm, sr, 4, 0.2);
    const a = analyzeSamples(mono, sr);
    let maxErr = 0;
    for (let t = 0.2; t < 3.5; t += period) {
      let best = Infinity;
      for (const b of a.beats) best = Math.min(best, Math.abs(b - t));
      maxErr = Math.max(maxErr, best);
    }
    expect(maxErr).toBeLessThan(0.02);
  });

  it('reports bpm 0 and no beats for silence (no false positives)', () => {
    const mono = new Float32Array(sr * 2);
    const a = analyzeSamples(mono, sr);
    expect(a.bpm).toBe(0);
    expect(a.beats.length).toBe(0);
  });

  it('never produces NaN/Infinity, even for very short clips', () => {
    const mono = new Float32Array(500);
    const a = analyzeSamples(mono, sr);
    const allFinite = (arr: Float32Array) => Array.from(arr).every((v) => Number.isFinite(v));
    expect(allFinite(a.bass)).toBe(true);
    expect(allFinite(a.mid)).toBe(true);
    expect(allFinite(a.high)).toBe(true);
    expect(allFinite(a.rms)).toBe(true);
    expect(allFinite(a.flux)).toBe(true);
    expect(a.bands.every((b) => Array.from(b).every((v) => Number.isFinite(v)))).toBe(true);
  });

  it('gives a vocal-band tone higher vocalLikeness than a bass tone', () => {
    const vocal = analyzeSamples(sineWave(1000, sr, 2), sr);
    const bass = analyzeSamples(sineWave(60, sr, 2), sr);
    expect(avg(vocal.vocalLikeness)).toBeGreaterThan(avg(bass.vocalLikeness));
  });

  it('produces exactly BAND_COUNT (64) band values per frame', () => {
    const a = analyzeSamples(sineWave(440, sr, 1), sr);
    expect(a.bands[0]!.length).toBe(64);
  });
});
