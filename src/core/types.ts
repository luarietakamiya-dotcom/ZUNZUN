/**
 * ZUNZUN の中核となる共有型。
 * docs/ARCHITECTURE.md の「Visualizer 共通インターフェース」「Project JSON」に対応する。
 * Step 2 以降 (AudioEngine, Visualizer Registry, Project) はこれらの型を実装していく。
 */

/** オフライン解析された音声から、時刻 t について取り出される 1 フレーム分のデータ。 */
export interface AudioFrame {
  /** 秒 */
  t: number;
  /** 前フレームからの経過秒 */
  dt: number;
  /** 0..1 に正規化された低域エネルギー */
  bass: number;
  /** 0..1 に正規化された中域エネルギー */
  mid: number;
  /** 0..1 に正規化された高域エネルギー */
  high: number;
  /** 0..1 の RMS (全体音量) */
  rms: number;
  /** 0..1 の直近ピーク */
  peak: number;
  /** 0..1 に減衰するビートパルス (ビート直後が 1) */
  beat: number;
  /** 直近のビートの通し番号。ビートが一度もない場合は -1 */
  beatIndex: number;
  /** 0..1 のスペクトル重心ベースのエネルギー指標 */
  spectralEnergy: number;
  /** 0..1 のオンセット強度 (フラックス) */
  flux: number;
  /** 64 帯域の周波数エネルギー (各 0..1) */
  bands: Float32Array;
}

/** 全プリセット共通の UI パラメータ (docs/ARCHITECTURE.md 9 UI 参照)。 */
export interface CommonParams {
  intensity: number;
  sensitivity: number;
  bass: number;
  mid: number;
  high: number;
  glow: number;
  motion: number;
  colorTheme: string;
  cameraMotion: number;
}

export const defaultCommonParams = (): CommonParams => ({
  intensity: 0.8,
  sensitivity: 0.6,
  bass: 1,
  mid: 1,
  high: 1,
  glow: 0.7,
  motion: 0.6,
  colorTheme: 'default',
  cameraMotion: 0.4,
});

/** Visualizer プリセットが初期化時に受け取るコンテキスト。 */
export interface VisualizerInitContext {
  renderer: unknown; // Step 3/4 で THREE.WebGLRenderer に置き換える
  width: number;
  height: number;
  seed: number;
  params: CommonParams & Record<string, unknown>;
  /** project.seed から派生した決定論的な乱数生成器 (0..1 を返す) */
  rng: () => number;
}

/**
 * すべての Visualizer プリセットが実装する共通インターフェース。
 * 各プリセットは 1 フォルダ (src/visualizers/<id>/) に閉じて実装し、
 * Host が渡す AudioFrame 以外の外部状態を共有しない。
 */
export interface VisualizerPreset {
  init(ctx: VisualizerInitContext): Promise<void> | void;
  update(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/** プリセットのカタログ情報 (サムネイル選択 UI 用)。 */
export interface VisualizerManifest {
  id: string;
  name: string;
  thumbnail: string;
  version: number;
  defaults: Record<string, unknown>;
}

/** ZUNZUN プロジェクトファイル (*.zunzun.json) の最上位スキーマ。version は将来の migrate 用。 */
export interface ProjectFile {
  format: 'zunzun-project';
  version: 1;
  app: string;
  seed: number;
  audio: {
    ref: string;
    sha256: string;
    name: string;
    duration: number;
    sampleRate: number;
    bpm: number;
  } | null;
  visualizer: {
    preset: string;
    presetVersion: number;
    common: CommonParams;
    params: Record<string, unknown>;
  };
  overlays: OverlayLayer[];
  colors: Record<string, string>;
  fonts: Record<string, string>;
  export: ExportSettings;
}

export interface OverlayLayer {
  id: string;
  ref: string;
  sha256: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  z: number;
  glow: number;
  float: number;
  beat: number;
}

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  format: 'mp4' | 'webm' | 'png-sequence';
  quality: 'draft' | 'high' | 'max';
  transparent: boolean;
}

export const defaultProject = (): ProjectFile => ({
  format: 'zunzun-project',
  version: 1,
  app: '0.1.0',
  seed: Date.now() >>> 0,
  audio: null,
  visualizer: {
    preset: 'solar-gate',
    presetVersion: 1,
    common: defaultCommonParams(),
    params: {},
  },
  overlays: [],
  colors: {},
  fonts: {},
  export: {
    width: 1920,
    height: 1080,
    fps: 60,
    format: 'mp4',
    quality: 'high',
    transparent: false,
  },
});
