import { describe, expect, it } from 'vitest';
import { defaultLyrics } from '../types';
import { buildJizuraAudio, buildJizuraProject, lyricMotionSeed, nearestAspect, normalizeEnergy } from './jizura-adapter';

describe('nearestAspect', () => {
  it('書き出しサイズに最も近い JIZURA の比率を選ぶ', () => {
    expect(nearestAspect(1920, 1080)).toBe('16:9');
    expect(nearestAspect(1080, 1920)).toBe('9:16');
    expect(nearestAspect(1080, 1080)).toBe('1:1');
    expect(nearestAspect(1080, 1350)).toBe('4:5');
    expect(nearestAspect(2560, 1080)).toBe('21:9');
    expect(nearestAspect(1440, 1080)).toBe('4:3');
    expect(nearestAspect(1920, 1200)).toBe('16:9');
    expect(nearestAspect(0, 0)).toBe('1:1');
  });
});

describe('normalizeEnergy', () => {
  it('95 パーセンタイルで 0..1 にし、NaN は 0', () => {
    const rms = new Float32Array(100);
    for (let i = 0; i < 100; i++) rms[i] = i / 100;
    rms[3] = Number.NaN;
    const e = normalizeEnergy(rms);
    expect(e[95]).toBeCloseTo(1);
    expect(e[99]).toBe(1);
    expect(e[50]).toBeCloseTo(0.5 / 0.95, 3);
    expect(e[3]).toBe(0);
    expect(normalizeEnergy(new Float32Array(0)).length).toBe(0);
    expect(Array.from(normalizeEnergy(new Float32Array(3)))).toEqual([0, 0, 0]);
  });
});

describe('buildJizuraAudio', () => {
  it('長さ・ビート (昇順)・正規化した音量・フレームレートを渡す', () => {
    const a = buildJizuraAudio({ duration: 10, beats: [2, 1], rms: new Float32Array([0, 1]), frameRate: 60 });
    expect(a.duration).toBe(10);
    expect(a.beats).toEqual([1, 2]);
    expect(a.energyRate).toBe(60);
    expect(a.energy.length).toBe(2);
  });
});

describe('buildJizuraProject', () => {
  const defaults = { style: 'noir', seed: 1, fx: { motion: 0.7 }, timing: { bpm: 0, offset: 0.4, snap: true, lineTimes: {} } };

  it('歌詞・seed・比率・fps と、手で決めた開始・終了を渡す (SRT は LRC にして渡す)', () => {
    const lyrics = {
      ...defaultLyrics(),
      source: 'srt' as const,
      text: '1\n00:00:01,000 --> 00:00:02,000\nあ',
      timing: { lineTimes: { '0': 1.2 }, lineEnds: { '0': 1.9 }, snap: true, snapWindowMs: 150 },
    };
    const p = buildJizuraProject(lyrics, defaults, { seed: 99, aspect: '9:16', fps: 30 });
    expect(p.lyrics).toBe('[00:01.000]あ');
    expect(p.seed).toBe(99);
    expect(p.aspect).toBe('9:16');
    expect(p.fps).toBe(30);
    expect(p.style).toBe('noir');
    expect(p.timing).toEqual({ bpm: 0, offset: 0.4, snap: true, lineTimes: { '0': 1.2 }, lineEnds: { '0': 1.9 } });
    // 渡した設定と共有しない (JIZURA 側で書き換えられても ZUNZUN の状態は変わらない)
    expect((p.timing as { lineTimes: object }).lineTimes).not.toBe(lyrics.timing.lineTimes);
  });

  it('歌詞モーションの seed は project.seed から決まる (同じなら同じ、違えば違う)', () => {
    expect(lyricMotionSeed(20260927)).toBe(lyricMotionSeed(20260927));
    expect(lyricMotionSeed(20260927)).not.toBe(lyricMotionSeed(20260928));
  });
});
