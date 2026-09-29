import { describe, expect, it } from 'vitest';
import { defaultCommonParams, defaultLyrics, defaultProject, type OverlayLayer } from '../types';
import { buildProjectFile, type ProjectSourceState } from './serialize';
import { sanitizeProject } from './validate';

function overlay(overrides: Partial<OverlayLayer> = {}): OverlayLayer {
  return { id: 'ov1', ref: 'logo.png', sha256: 'abc', x: 0.5, y: 0.5, scale: 0.3, rotation: 0, opacity: 1, z: 0, glow: 0, float: 0, beat: 0, ...overrides };
}

function state(overrides: Partial<ProjectSourceState> = {}): ProjectSourceState {
  return {
    seed: 12345,
    presetId: 'solar-gate',
    params: defaultCommonParams(),
    audio: { isLoaded: false, fileName: '', sha256: '', duration: 0, sampleRate: 0, bpm: 0 },
    overlays: [],
    lyrics: null,
    rhythm: null,
    exportSettings: defaultProject().export,
    ...overrides,
  };
}

describe('buildProjectFile', () => {
  it('音源未読み込みなら audio は null にする', () => {
    const project = buildProjectFile(state());
    expect(project.audio).toBeNull();
    expect(project.seed).toBe(12345);
    expect(project.visualizer.preset).toBe('solar-gate');
  });

  it('音源読み込み済みなら ref/sha256 を記録する (音源本体は含めない)', () => {
    const project = buildProjectFile(
      state({
        audio: { isLoaded: true, fileName: 'song.mp3', sha256: 'deadbeef', duration: 180.5, sampleRate: 48000, bpm: 128 },
      }),
    );
    expect(project.audio).toEqual({
      ref: 'song.mp3',
      sha256: 'deadbeef',
      name: 'song.mp3',
      duration: 180.5,
      sampleRate: 48000,
      bpm: 128,
    });
    expect(JSON.stringify(project)).not.toContain('base64');
  });

  it('presetId が未選択なら既定プリセットにフォールバックする', () => {
    const project = buildProjectFile(state({ presetId: null }));
    expect(project.visualizer.preset).toBeTruthy();
  });

  it('現在の共通パラメータをそのまま保存する', () => {
    const params = { ...defaultCommonParams(), glow: 0.9, colorTheme: 'gold' };
    const project = buildProjectFile(state({ params }));
    expect(project.visualizer.common).toEqual(params);
  });

  it('オーバーレイの設定をそのまま保存する (複製であり、参照は共有しない)', () => {
    const layers = [overlay({ id: 'a' }), overlay({ id: 'b', z: 1 })];
    const project = buildProjectFile(state({ overlays: layers }));
    expect(project.overlays).toEqual(layers);
    expect(project.overlays).not.toBe(layers);
    expect(project.overlays[0]).not.toBe(layers[0]);
  });

  it('オーバーレイが無ければ空配列を保存する', () => {
    const project = buildProjectFile(state());
    expect(project.overlays).toEqual([]);
  });

  it('書き出し設定をそのまま保存する (複製であり、参照は共有しない)', () => {
    const exportSettings = { ...defaultProject().export, width: 1080, height: 1920, fps: 30, quality: 'max' as const };
    const project = buildProjectFile(state({ exportSettings }));
    expect(project.export).toEqual(exportSettings);
    expect(project.export).not.toBe(exportSettings);
  });

  it('小節と拍子 (rhythm) を複製して保存し、保存 → 読み込みで同じ内容に戻る', () => {
    expect(buildProjectFile(state()).rhythm).toBeNull();
    const rhythm = { enabled: true, bars: [0.5, 2.25, 4], meters: [{ bar: 0, pattern: '2+2+3' }, { bar: 2, pattern: '4' }] };
    const project = buildProjectFile(state({ rhythm }));
    expect(project.rhythm).toEqual(rhythm);
    expect(project.rhythm!.bars).not.toBe(rhythm.bars);
    expect(sanitizeProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });

  it('歌詞が無ければ null、あれば複製して保存し、保存 → 読み込みで同じ内容に戻る', () => {
    expect(buildProjectFile(state()).lyrics).toBeNull();
    const lyrics = {
      ...defaultLyrics(),
      source: 'lrc' as const,
      text: '[00:01.00]a\n[00:05.00]b',
      timing: { lineTimes: { '0': 1.2 }, lineEnds: { '1': 7 }, snap: false, snapWindowMs: 80 },
    };
    const project = buildProjectFile(state({ lyrics }));
    expect(project.lyrics).toEqual(lyrics);
    expect(project.lyrics!.timing.lineTimes).not.toBe(lyrics.timing.lineTimes);
    expect(sanitizeProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });
});
