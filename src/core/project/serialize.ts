import { defaultProject, type CommonParams, type ExportSettings, type LyricsSettings, type OverlayLayer, type ProjectFile } from '../types';

/** buildProjectFile が必要とする AudioEngine の最小の形 (実体は core/audio/engine.ts の AudioEngine)。 */
export interface ProjectAudioSource {
  isLoaded: boolean;
  fileName: string;
  sha256: string;
  duration: number;
  sampleRate: number;
  bpm: number;
}

/** buildProjectFile が必要とする Store の最小の形。DOM に依存しないのでここは Vitest で検証できる。 */
export interface ProjectSourceState {
  seed: number;
  presetId: string | null;
  params: CommonParams;
  audio: ProjectAudioSource;
  overlays: OverlayLayer[];
  /** 歌詞を使わない場合は null */
  lyrics: LyricsSettings | null;
  exportSettings: ExportSettings;
}

/**
 * 現在のアプリ状態から ProjectFile を組み立てる。
 * 音源本体は埋め込まず、ファイル名と sha256 だけを参照として保存する
 * (docs/ARCHITECTURE.md の Project JSON 設計どおり)。
 */
export function buildProjectFile(state: ProjectSourceState): ProjectFile {
  const base = defaultProject();
  return {
    format: 'zunzun-project',
    version: 1,
    app: base.app,
    seed: state.seed >>> 0,
    audio: state.audio.isLoaded
      ? {
          ref: state.audio.fileName,
          sha256: state.audio.sha256,
          name: state.audio.fileName,
          duration: state.audio.duration,
          sampleRate: state.audio.sampleRate,
          bpm: state.audio.bpm,
        }
      : null,
    visualizer: {
      preset: state.presetId ?? base.visualizer.preset,
      presetVersion: base.visualizer.presetVersion,
      common: { ...state.params },
      params: {},
    },
    overlays: state.overlays.map((o) => ({ ...o })),
    lyrics: state.lyrics
      ? {
          ...state.lyrics,
          timing: {
            ...state.lyrics.timing,
            lineTimes: { ...state.lyrics.timing.lineTimes },
            lineEnds: { ...state.lyrics.timing.lineEnds },
          },
          motion: { ...state.lyrics.motion },
        }
      : null,
    colors: {},
    fonts: {},
    export: { ...state.exportSettings },
  };
}
