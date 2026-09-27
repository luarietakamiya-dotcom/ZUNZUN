import { describe, expect, it } from 'vitest';
import { defaultCommonParams } from '../types';
import { buildProjectFile, type ProjectSourceState } from './serialize';

function state(overrides: Partial<ProjectSourceState> = {}): ProjectSourceState {
  return {
    seed: 12345,
    presetId: 'solar-gate',
    params: defaultCommonParams(),
    audio: { isLoaded: false, fileName: '', sha256: '', duration: 0, sampleRate: 0, bpm: 0 },
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
});
