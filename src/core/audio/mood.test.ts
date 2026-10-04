import { describe, expect, it } from 'vitest';
import type { AudioAnalysis } from './analyze';
import { buildSongMood } from './mood';
import { AudioTimeline } from './timeline';

/** 手作りの解析結果: 秒ごとの音量 (rms) の関数から作る (60 フレーム/秒) */
function fakeAnalysis(seconds: number, rms: (t: number) => number, flux: (t: number) => number = () => 0.1): AudioAnalysis {
  const rate = 60;
  const n = seconds * rate;
  const f = (g: (t: number) => number): Float32Array => Float32Array.from({ length: n }, (_, i) => g(i / rate));
  return {
    frameRate: rate,
    duration: seconds,
    sampleRate: 44100,
    times: f((t) => t),
    bass: f(() => 0.3),
    mid: f(() => 0.3),
    high: f(() => 0.3),
    rms: f(rms),
    peak: f(rms),
    spectralEnergy: f(rms),
    flux: f(flux),
    vocalLikeness: f(() => 0),
    bands: Array.from({ length: n }, () => new Float32Array(64)),
    bpm: 120,
    beats: [],
  } as unknown as AudioAnalysis;
}

describe('buildSongMood', () => {
  it('曲の中で静かな所は 0 に近く、激しい所は 1 に近い (曲全体の分布で正規化)', () => {
    const a = fakeAnalysis(60, (t) => (t < 30 ? 0.1 : 0.6));
    const { mood } = buildSongMood(a);
    expect(mood[10 * 60]!).toBeLessThan(0.15);
    expect(mood[50 * 60]!).toBeGreaterThan(0.85);
  });

  it('録音の音量が違う曲でも、同じ形なら同じ曲調になる (曲ごとの基準)', () => {
    const quiet = buildSongMood(fakeAnalysis(60, (t) => 0.05 + (t < 30 ? 0 : 0.1)));
    const loud = buildSongMood(fakeAnalysis(60, (t) => 0.4 + (t < 30 ? 0 : 0.5)));
    for (const sec of [10, 20, 40, 50]) expect(Math.abs(quiet.mood[sec * 60]! - loud.mood[sec * 60]!)).toBeLessThan(0.12);
  });

  it('ずっと同じ音量の曲は 0.5 (どちらにも寄らない)', () => {
    const { mood } = buildSongMood(fakeAnalysis(40, () => 0.3));
    expect(mood[20 * 60]!).toBeCloseTo(0.5, 5);
  });

  it('数秒だけの変化はならされ、長く続く変化だけが曲調になる', () => {
    const a = fakeAnalysis(60, (t) => (t > 29 && t < 31 ? 0.9 : 0.2) + (t > 40 ? 0.3 : 0));
    const { mood } = buildSongMood(a);
    expect(mood[30 * 60]!).toBeLessThan(mood[50 * 60]!); // 2 秒のピークより、10 秒以上続く方が高い
  });

  it('区間の境目: 音量が大きく変わる所を見つける。頭・終わり付近や、似た所には作らない', () => {
    const a = fakeAnalysis(80, (t) => (t < 25 ? 0.1 : t < 55 ? 0.7 : 0.15));
    const { autoBoundaries } = buildSongMood(a);
    expect(autoBoundaries).toHaveLength(2);
    expect(autoBoundaries[0]!).toBeGreaterThan(21);
    expect(autoBoundaries[0]!).toBeLessThan(29);
    expect(autoBoundaries[1]!).toBeGreaterThan(51);
    expect(autoBoundaries[1]!).toBeLessThan(59);
  });

  it('変化の無い曲・短い曲・空の曲には境目を作らない。壊れた値でも壊れない', () => {
    expect(buildSongMood(fakeAnalysis(60, () => 0.3)).autoBoundaries).toEqual([]);
    expect(buildSongMood(fakeAnalysis(10, (t) => (t < 5 ? 0.1 : 0.8))).autoBoundaries).toEqual([]);
    expect(buildSongMood(fakeAnalysis(0, () => 0)).mood).toHaveLength(0);
    const nan = buildSongMood(fakeAnalysis(40, (t) => (t % 7 < 1 ? Number.NaN : 0.3)));
    expect(Array.from(nan.mood).every(Number.isFinite)).toBe(true);
  });
});

describe('AudioTimeline の song (曲調・区間)', () => {
  const a = fakeAnalysis(80, (t) => (t < 25 ? 0.1 : t < 55 ? 0.7 : 0.15));

  it('frame.song に曲調と区間の番号が入る (自動の境目)', () => {
    const tl = new AudioTimeline(a);
    const early = tl.at(10).song!;
    const mid = tl.at(40).song!;
    const late = tl.at(70).song!;
    expect(early.mood).toBeLessThan(0.2);
    expect(mid.mood).toBeGreaterThan(0.8);
    expect([early.section, mid.section, late.section]).toEqual([0, 1, 2]);
    expect(early.sectionCount).toBe(3);
    expect(mid.sectionStart).toBeGreaterThan(21);
    expect(early.sectionStart).toBe(0);
  });

  it('歌詞の見出しなどの境目 (setSectionCues) が自動より優先され、null で自動に戻る', () => {
    const tl = new AudioTimeline(a);
    tl.setSectionCues([15, 30, 60]);
    expect(tl.at(20).song!.section).toBe(1);
    expect(tl.at(20).song!.sectionStart).toBe(15);
    expect(tl.at(65).song!.section).toBe(3);
    expect(tl.at(65).song!.sectionCount).toBe(4);
    tl.setSectionCues(null);
    expect(tl.at(20).song!.section).toBe(0);
  });

  it('withCues は複製で、元の境目を変えない。同じ時刻なら何度でも同じ値 (再生位置の飛びに強い)', () => {
    const tl = new AudioTimeline(a);
    const copy = tl.withCues([10]);
    expect(copy.at(20).song!.section).toBe(1);
    expect(tl.at(20).song!.section).toBe(0);
    const x = tl.at(40);
    tl.at(5);
    tl.at(70);
    expect(tl.at(40).song).toEqual(x.song);
  });
});
