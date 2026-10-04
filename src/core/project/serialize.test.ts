import { describe, expect, it } from 'vitest';
import { defaultBackground, defaultChromaKey, defaultCommonParams, defaultComposition, defaultLyrics, defaultMediaLayer, defaultProject, type OverlayLayer } from '../types';
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

  it('未復元の音源参照を保存し、読み直しても保持する', () => {
    const expectedAudio = { ref: 'original.wav', name: 'original.wav', sha256: 'a'.repeat(64), duration: 42, sampleRate: 48000, bpm: 120 };
    const project = buildProjectFile(state({ expectedAudio }));
    expect(project.audio).toEqual(expectedAudio);
    expect(project.audio).not.toBe(expectedAudio);
    expect(sanitizeProject(JSON.parse(JSON.stringify(project))).audio).toEqual(expectedAudio);
  });

  it('選び直した音源は以前の参照より優先する', () => {
    const expectedAudio = { ref: 'old.wav', name: 'old.wav', sha256: 'a'.repeat(64), duration: 42, sampleRate: 48000, bpm: 120 };
    const project = buildProjectFile(state({ expectedAudio, audio: { isLoaded: true, fileName: 'new.wav', sha256: 'b'.repeat(64), duration: 10, sampleRate: 44100, bpm: 100 } }));
    expect(project.audio?.ref).toBe('new.wav');
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

  it('見え方 (visualizer.view) を保存し、保存 → 読み込みで同じ内容に戻る。省略すると既定', () => {
    expect(buildProjectFile(state()).visualizer.view).toEqual({ zoom: 1, x: 0, y: 0, roll: 0 });
    const view = { zoom: 2.5, x: -0.3, y: 0.4, roll: -15 };
    const project = buildProjectFile(state({ view }));
    expect(project.visualizer.view).toEqual(view);
    expect(project.visualizer.view).not.toBe(view);
    expect(sanitizeProject(JSON.parse(JSON.stringify(project))).visualizer.view).toEqual(view);
  });

  it('レイヤーの順番と重ね方 (composition) を保存し、保存 → 読み込みで同じ内容に戻る', () => {
    expect(buildProjectFile(state()).composition!.order).toEqual(['background', 'visualizer', 'lyrics', 'overlays']);
    const composition = { order: ['lyrics', 'background', 'visualizer', 'overlays'], hidden: ['overlays'], visualizerBlend: 'add' as const, visualizerOpacity: 0.7, lyricsOpacity: 0.5 };
    const project = buildProjectFile(state({ composition }));
    expect(project.composition).toEqual(composition);
    expect(project.composition!.order).not.toBe(composition.order);
    expect(sanitizeProject(JSON.parse(JSON.stringify(project))).composition).toEqual(composition);
  });

  it('素材 (media) を複製して保存し、保存 → 読み込みで同じ内容に戻る', () => {
    const m = { ...defaultMediaLayer('m1', 'gs.png', 'f'.repeat(64), 'image'), x: 0.2, chroma: { ...defaultChromaKey(), enabled: true, color: '#11ee22' } };
    const composition = { ...defaultComposition(), order: ['background', 'visualizer', 'lyrics', 'overlays', 'media:m1'] };
    const project = buildProjectFile(state({ media: [m], composition }));
    expect(project.media).toEqual([m]);
    expect(project.media![0]!.chroma).not.toBe(m.chroma);
    const back = sanitizeProject(JSON.parse(JSON.stringify(project)));
    expect(back.media).toEqual([m]);
    expect(back.composition).toEqual(composition);
  });

  it('プリセットだけの設定 (visualizer.params) をプリセットごとに保存し、保存 → 読み込みで同じ内容に戻る', () => {
    expect(buildProjectFile(state()).visualizer.params).toEqual({});
    const allPresetParams = { 'live-stage': { camera: 'front', height: 3.5 }, 'solar-gate': { rings: 2 } };
    const project = buildProjectFile(state({ allPresetParams }));
    expect(project.visualizer.params).toEqual(allPresetParams);
    expect(sanitizeProject(JSON.parse(JSON.stringify(project))).visualizer.params).toEqual(allPresetParams);
  });

  it('背景 (background) を複製して保存し、保存 → 読み込みで同じ内容に戻る', () => {
    expect(buildProjectFile(state()).background).toBeNull();
    const background = { ...defaultBackground('sky.jpg', 'e'.repeat(64), 'image'), dim: 0.5 };
    const project = buildProjectFile(state({ background }));
    expect(project.background).toEqual(background);
    expect(project.background).not.toBe(background);
    expect(sanitizeProject(JSON.parse(JSON.stringify(project))).background).toEqual(background);
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

describe('プリセットに渡す画像 (visualizer.image)', () => {
  const sha = 'a'.repeat(64);

  it('ref と sha256 だけを保存し (複製)、無ければ null。保存 → 読み込みで同じになる', () => {
    const image = { ref: 'moon.png', sha256: sha };
    const file = buildProjectFile(state({ presetImage: image }));
    expect(file.visualizer.image).toEqual(image);
    expect(file.visualizer.image).not.toBe(image);
    expect(buildProjectFile(state()).visualizer.image).toBeNull();
    expect(sanitizeProject(JSON.parse(JSON.stringify(file))).visualizer.image).toEqual(image);
  });

  it('壊れた値・前のプロジェクト (image なし) は null になる', () => {
    const raw = JSON.parse(JSON.stringify(buildProjectFile(state()))) as { visualizer: Record<string, unknown> };
    delete raw.visualizer.image;
    expect(sanitizeProject(raw).visualizer.image).toBeNull();
    raw.visualizer.image = { ref: '', sha256: sha };
    expect(sanitizeProject(raw).visualizer.image).toBeNull();
    raw.visualizer.image = { ref: 'a.png', sha256: 'xyz' };
    expect(sanitizeProject(raw).visualizer.image).toBeNull();
    raw.visualizer.image = 'a.png';
    expect(sanitizeProject(raw).visualizer.image).toBeNull();
  });
});

