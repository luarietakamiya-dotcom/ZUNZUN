import { describe, expect, it } from 'vitest';
import { defaultCommonParams, defaultLyrics, defaultProject } from '../types';
import { MAX_LYRICS_LENGTH, ProjectParseError, sanitizeProject } from './validate';

function validRaw(): unknown {
  const p = defaultProject();
  return JSON.parse(JSON.stringify(p)) as unknown;
}

describe('sanitizeProject', () => {
  it('受け入れられる JSON はそのまま (往復) 復元する', () => {
    const raw = validRaw();
    const project = sanitizeProject(raw);
    expect(project.format).toBe('zunzun-project');
    expect(project.version).toBe(1);
    expect(project.visualizer.preset).toBe(defaultProject().visualizer.preset);
    expect(project.visualizer.common).toEqual(defaultCommonParams());
  });

  it('オブジェクトでない入力は拒否する', () => {
    expect(() => sanitizeProject(null)).toThrow(ProjectParseError);
    expect(() => sanitizeProject('not json')).toThrow(ProjectParseError);
    expect(() => sanitizeProject(42)).toThrow(ProjectParseError);
  });

  it('format が違う場合は拒否する', () => {
    const raw = validRaw() as Record<string, unknown>;
    raw.format = 'something-else';
    expect(() => sanitizeProject(raw)).toThrow(ProjectParseError);
  });

  it('version が未対応の場合は拒否する', () => {
    const raw = validRaw() as Record<string, unknown>;
    raw.version = 999;
    expect(() => sanitizeProject(raw)).toThrow(ProjectParseError);
  });

  it('範囲外の数値パラメータは clamp する', () => {
    const raw = validRaw() as Record<string, unknown>;
    (raw.visualizer as Record<string, unknown>).common = {
      ...defaultCommonParams(),
      intensity: 99,
      bass: -5,
      glow: 0.4,
    };
    const project = sanitizeProject(raw);
    expect(project.visualizer.common.intensity).toBe(1);
    expect(project.visualizer.common.bass).toBe(0);
    expect(project.visualizer.common.glow).toBe(0.4);
  });

  it('壊れた/未知のフィールドは既定値で補う', () => {
    const raw = validRaw() as Record<string, unknown>;
    (raw.visualizer as Record<string, unknown>).preset = 12345; // 文字列でない
    raw.colors = { bg: 'not-a-hex-color', accent: '#ff00ff' };
    raw.unknownTopLevelField = 'should be dropped silently';
    const project = sanitizeProject(raw);
    expect(project.visualizer.preset).toBe(defaultProject().visualizer.preset);
    expect(project.colors).toEqual({ accent: '#ff00ff' });
    expect((project as unknown as Record<string, unknown>).unknownTopLevelField).toBeUndefined();
  });

  it('audio は ref/sha256 の両方があるときだけ受け入れる', () => {
    const raw = validRaw() as Record<string, unknown>;
    raw.audio = { ref: 'song.mp3' }; // sha256 が無い
    expect(sanitizeProject(raw).audio).toBeNull();

    raw.audio = { ref: 'song.mp3', sha256: 'abc123', duration: 120, sampleRate: 48000, bpm: 128 };
    const project = sanitizeProject(raw);
    expect(project.audio).toEqual({ ref: 'song.mp3', sha256: 'abc123', name: 'song.mp3', duration: 120, sampleRate: 48000, bpm: 128 });
  });

  it('overlays: id/ref/sha256 が欠けているレイヤーは除外する', () => {
    const raw = validRaw() as Record<string, unknown>;
    raw.overlays = [{ id: 'x' }, { id: 'y', ref: 'logo.png' }, 'not-an-object', 42];
    expect(sanitizeProject(raw).overlays).toEqual([]);
  });

  it('overlays: 正常なレイヤーはそのまま復元し、数値は clamp する', () => {
    const raw = validRaw() as Record<string, unknown>;
    raw.overlays = [
      { id: 'ov1', ref: 'logo.png', sha256: 'abc', x: 0.5, y: 0.8, scale: 0.3, rotation: 0, opacity: 1, z: 0, glow: 0.2, float: 0, beat: 0.5 },
      { id: 'ov2', ref: 'star.png', sha256: 'def', x: 99, scale: -1, opacity: 5, z: 1 },
    ];
    const project = sanitizeProject(raw);
    expect(project.overlays).toHaveLength(2);
    expect(project.overlays[0]).toEqual({
      id: 'ov1', ref: 'logo.png', sha256: 'abc', x: 0.5, y: 0.8, scale: 0.3, rotation: 0, opacity: 1, z: 0, glow: 0.2, float: 0, beat: 0.5,
    });
    // 範囲外の値は clamp、欠けている数値フィールドは既定値で補う
    expect(project.overlays[1]?.x).toBe(3);
    expect(project.overlays[1]?.scale).toBe(0.01);
    expect(project.overlays[1]?.opacity).toBe(1);
    expect(project.overlays[1]?.y).toBe(0.5); // 既定値
  });

  it('overlays: id が重複する場合は先勝ちにする', () => {
    const raw = validRaw() as Record<string, unknown>;
    raw.overlays = [
      { id: 'dup', ref: 'a.png', sha256: 'a', scale: 0.1 },
      { id: 'dup', ref: 'b.png', sha256: 'b', scale: 0.9 },
    ];
    const project = sanitizeProject(raw);
    expect(project.overlays).toHaveLength(1);
    expect(project.overlays[0]?.ref).toBe('a.png');
  });

  it('seed は符号なし整数として保存/復元する', () => {
    const raw = validRaw() as Record<string, unknown>;
    raw.seed = 20260927;
    expect(sanitizeProject(raw).seed).toBe(20260927);
  });

  it('lyrics: 無い・壊れている場合は null (歌詞を使わないプロジェクト)', () => {
    const raw = validRaw() as Record<string, unknown>;
    expect(sanitizeProject(raw).lyrics).toBeNull();
    raw.lyrics = 'text';
    expect(sanitizeProject(raw).lyrics).toBeNull();
  });

  it('lyrics: 行番号でないキー・数値でない時刻・未知のキーは捨て、範囲外は clamp する', () => {
    const raw = validRaw() as Record<string, unknown>;
    raw.lyrics = {
      engine: 'other',
      source: 'exe',
      text: 'a\nb',
      timing: {
        lineTimes: { '0': 1.5, '01': 2, x: 3, '-1': 4, '1': 'NaN', '2': -5, '99999': 1 },
        lineEnds: { '0': 1e9 },
        snap: 'yes',
        snapWindowMs: 5000,
        evil: '<script>',
      },
      motion: { style: 'noir' },
      extra: 1,
    };
    const lyrics = sanitizeProject(raw).lyrics!;
    expect(lyrics.engine).toBe('jizura');
    expect(lyrics.source).toBe('text');
    expect(lyrics.text).toBe('a\nb');
    expect(lyrics.timing.lineTimes).toEqual({ '0': 1.5, '1': 2, '2': 0 });
    expect(lyrics.timing.lineEnds).toEqual({ '0': 86400 });
    expect(lyrics.timing.snap).toBe(true);
    expect(lyrics.timing.snapWindowMs).toBe(1000);
    expect(lyrics.motion).toEqual({});
    expect(Object.keys(lyrics)).toEqual(['engine', 'source', 'text', 'timing', 'motion']);
  });

  it('lyrics: 長すぎる歌詞は上限で切る', () => {
    const raw = validRaw() as Record<string, unknown>;
    raw.lyrics = { source: 'lrc', text: 'x'.repeat(MAX_LYRICS_LENGTH + 10) };
    const lyrics = sanitizeProject(raw).lyrics!;
    expect(lyrics.source).toBe('lrc');
    expect(lyrics.text).toHaveLength(MAX_LYRICS_LENGTH);
    expect(lyrics.timing).toEqual(defaultLyrics().timing);
  });
});
