import { describe, expect, it } from 'vitest';
import { energyWord, pickOmakase, rankPresets, songFeatures, type SongFeatures } from './omakase';

const calm: SongFeatures = { bpm: 72, energy: 0.1, bass: 0.3, tone: 0.4 };
const wild: SongFeatures = { bpm: 170, energy: 0.95, bass: 0.8, tone: 0.6 };

function analysis(bpm: number, level: number, fluxLevel: number, bassShare = 0.5) {
  const n = 600;
  const rest = (1 - bassShare) / 2;
  return {
    bpm,
    rms: new Float32Array(n).fill(level),
    flux: new Float32Array(n).fill(fluxLevel),
    bass: new Float32Array(n).fill(bassShare),
    mid: new Float32Array(n).fill(rest),
    high: new Float32Array(n).fill(rest),
    bands: Array.from({ length: 60 }, () => new Float32Array(64).map((_, k) => (k < 10 ? 0.9 : 0.1))),
  };
}

describe('songFeatures', () => {
  it('テンポが速く、音量・音の動きが大きいほど、激しさが高い', () => {
    const quiet = songFeatures(analysis(70, 0.05, 0.03));
    const loud = songFeatures(analysis(170, 0.4, 0.4));
    expect(quiet.energy).toBeLessThan(0.15);
    expect(loud.energy).toBeGreaterThan(0.85);
  });
  it('低音の割合が大きいほど bass が高い。低い帯が中心なら tone は低い', () => {
    const heavy = songFeatures(analysis(120, 0.2, 0.2, 0.8));
    const light = songFeatures(analysis(120, 0.2, 0.2, 0.2));
    expect(heavy.bass).toBeGreaterThan(light.bass);
    expect(heavy.tone).toBeLessThan(0.5); // 低い帯が中心
  });
  it('壊れた値・空の分析でも、0..1 の値を返す', () => {
    const f = songFeatures({ bpm: Number.NaN, rms: new Float32Array(0), flux: Float32Array.from([Number.NaN]), bass: new Float32Array(0), mid: new Float32Array(0), high: new Float32Array(0), bands: [] });
    for (const v of [f.energy, f.bass, f.tone]) expect(v >= 0 && v <= 1).toBe(true);
    expect(f.bpm).toBe(100);
  });
});

describe('pickOmakase', () => {
  it('同じ入力なら同じ結果 (乱数を使わない)', () => {
    expect(pickOmakase(calm, 0)).toEqual(pickOmakase(calm, 0));
    expect(pickOmakase(wild, 3, { hasBackground: true })).toEqual(pickOmakase(wild, 3, { hasBackground: true }));
  });
  it('おだやかな曲には、静かな映像と静かな歌詞。激しい曲には、派手な映像と強い歌詞', () => {
    const c = pickOmakase(calm, 0)!;
    expect(['milky-way', 'ripples', 'spectrum-wave', 'city-scroll']).toContain(c.presetId);
    expect(['zz-calm', 'zz-cinema']).toContain(c.lyricStyle);
    const w = pickOmakase(wild, 0)!;
    expect(['speaker-mega', 'cyber-space', 'led-matrix']).toContain(w.presetId);
    expect(['zz-intense', 'zz-rock']).toContain(w.lyricStyle);
  });
  it('「別のおまかせ」は、順に別の候補になり、一周すると元に戻る。負の数でも壊れない', () => {
    const ids = [0, 1, 2, 3, 4, 5].map((i) => pickOmakase(calm, i)!.presetId);
    expect(new Set(ids).size).toBe(6);
    expect(pickOmakase(calm, 6)!.presetId).toBe(ids[0]);
    expect(pickOmakase(calm, -1)!.presetId).toBe(ids[5]);
    expect(pickOmakase(calm, 1)!.rank).toBe(1);
  });
  it('背景があるときは、黒に光を描くもの (背景に重ねる向き) と、歌詞の「余白」を選びやすい', () => {
    const noBg = rankPresets({ bpm: 120, energy: 0.5, bass: 0.6, tone: 0.5 }, { hasBackground: false });
    const withBg = rankPresets({ bpm: 120, energy: 0.5, bass: 0.6, tone: 0.5 }, { hasBackground: true });
    const overlay = new Set(['speaker-cone', 'speaker-twin', 'speaker-mega', 'edge-equalizer', 'spectrum-wave', 'led-matrix', 'ripples']);
    expect(overlay.has(withBg[0]!)).toBe(true);
    expect(overlay.has(noBg[0]!)).toBe(false);
    expect(pickOmakase({ bpm: 90, energy: 0.3, bass: 0.4, tone: 0.5 }, 0, { hasBackground: true })!.lyricStyle).toBe('zz-cinema');
  });
  it('使える種類を限ると、その中から選ぶ。空なら null', () => {
    expect(pickOmakase(calm, 0, { availablePresets: ['kaleidoscope'] })!.presetId).toBe('kaleidoscope');
    expect(pickOmakase(calm, 0, { availablePresets: ['none'] })).toBeNull();
  });
  it('激しさの言葉', () => {
    expect(energyWord(0.1).ja).toBe('おだやか');
    expect(energyWord(0.45).ja).toBe('ふつう');
    expect(energyWord(0.9).ja).toBe('激しめ');
  });
});
