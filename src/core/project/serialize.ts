import {
  defaultProject,
  type CommonParams,
  type ExportSettings,
  type LyricsSettings,
  type OverlayLayer,
  type ProjectFile,
  type BackgroundSettings,
  type RhythmSettings,
  defaultView,
  type ViewSettings,
  defaultComposition,
  type CompositionSettings,
  type MediaLayer,
} from '../types';

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
  /** 小節と拍子 (変拍子モード)。使わない場合は null */
  rhythm: RhythmSettings | null;
  /** 背景の一枚絵・動画。使わない場合は null (省略可: 古い呼び出し側・テストのため) */
  background?: BackgroundSettings | null;
  /** ビジュアライザーの見え方 (省略可: 古い呼び出し側・テストのため。省略すると既定) */
  view?: ViewSettings;
  /** レイヤーの順番と重ね方 (省略可。省略すると既定) */
  composition?: CompositionSettings;
  /** 素材レイヤー (省略可) */
  media?: MediaLayer[];
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
      view: { ...(state.view ?? defaultView()) },
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
          // オリジナルのスタイルは入れ子のオブジェクトなので、まるごと複製する (保存したあとに画面で変えても共有しない)
          motion: JSON.parse(JSON.stringify(state.lyrics.motion)) as typeof state.lyrics.motion,
          stem: state.lyrics.stem ? { ...state.lyrics.stem } : null,
        }
      : null,
    rhythm: state.rhythm
      ? { enabled: state.rhythm.enabled, bars: [...state.rhythm.bars], meters: state.rhythm.meters.map((m) => ({ ...m })) }
      : null,
    background: state.background ? { ...state.background } : null,
    composition: JSON.parse(JSON.stringify(state.composition ?? defaultComposition())) as CompositionSettings,
    media: (state.media ?? []).map((m) => ({ ...m, chroma: { ...m.chroma } })),
    colors: {},
    fonts: {},
    export: { ...state.exportSettings },
  };
}
