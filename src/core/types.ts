/**
 * ZUNZUN の中核となる共有型。
 * docs/ARCHITECTURE.md の「Visualizer 共通インターフェース」「Project JSON」に対応する。
 * Step 2 以降 (AudioEngine, Visualizer Registry, Project) はこれらの型を実装していく。
 */
import type * as THREE from 'three';

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
  renderer: THREE.WebGLRenderer;
  width: number;
  height: number;
  /** project.seed から Host がプリセット id ごとに派生させた整数 seed */
  seed: number;
  params: CommonParams & Record<string, unknown>;
  /** 上記 seed から作った決定論的な乱数生成器 (0..1 を返す) */
  rng: () => number;
}

/**
 * すべての Visualizer プリセットが実装する共通インターフェース。
 * 各プリセットは 1 フォルダ (src/visualizers/<id>/) に閉じて実装し、
 * Host が渡す AudioFrame 以外の外部状態を共有しない。
 * scene/camera は init() の後に必ず存在している前提 (Host は init 完了後にのみ読む)。
 */
export interface VisualizerPreset {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
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
  /** このプリセットの Bloom/Light Rays 基準値。省略時は PostFxStack の既定値を使う (core/render/postfx.ts) */
  post?: Partial<PostFxConfig>;
}

/** Bloom/Light Rays の基準値。core/render/postfx.ts の PostFxStack が実装を持つ。 */
export interface PostFxConfig {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  lightRays: boolean;
  lightRayPosition: readonly [number, number];
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
  /** 歌詞と、その同期タイミング・歌詞モーションの設定。歌詞を使わないプロジェクトは null */
  lyrics: LyricsSettings | null;
  colors: Record<string, string>;
  fonts: Record<string, string>;
  export: ExportSettings;
}

/** 歌詞の入力形式。'text' = 貼り付けたテキスト (JIZURA の記法: `/` で区切り、`*強調*`、`[間奏]` など) */
export type LyricsSource = 'text' | 'lrc' | 'srt';

/**
 * 歌詞の行ごとのタイミング。キーは行番号 (0 始まり、core/lyrics/parse.ts の parseLyrics が返す lines の添字) の文字列。
 * 形式は JIZURA の `timing.lineTimes` と互換で、LRC/SRT のタグより優先する (docs/ARCHITECTURE.md「歌詞同期の方針」)。
 */
export interface LyricsTiming {
  /** 行の開始 (秒)。手で決めた (タップ・ドラッグ・入力した) ものだけを持つ */
  lineTimes: Record<string, number>;
  /** 行の終了 (秒、任意)。無い行は次の行の開始で終わる */
  lineEnds: Record<string, number>;
  /** タップ・ドラッグしたときに、歌い出し候補 → ビートへ吸着させるか */
  snap: boolean;
  /** 吸着する範囲 (±ミリ秒) */
  snapWindowMs: number;
}

export interface LyricsSettings {
  engine: 'jizura';
  source: LyricsSource;
  /** 入力された歌詞そのもの (LRC/SRT のときはタグ付きの原文) */
  text: string;
  timing: LyricsTiming;
  /** 歌詞モーション (JIZURA) の設定 */
  motion: LyricsMotion;
}

/**
 * 歌詞モーション (JIZURA) の設定。JIZURA の project のうち、ZUNZUN で扱う分だけ。
 * 数値の既定値は JIZURA の defaultProject().fx と同じ。
 */
export interface LyricsMotion {
  /** ビジュアライザーの上に歌詞モーションを重ねるか */
  enabled: boolean;
  /** JIZURA のスタイル (J.STYLE_ORDER のキー。知らないキーは JIZURA 側で既定の noir になる) */
  style: string;
  /** 動きの大きさ (0..1) */
  motion: number;
  /** 装飾の量 (0..1) */
  decor: number;
  /** 文字の区切りの細かさ (0..1、大きいほど 1 行を細かいカットに分ける) */
  density: number;
  /** オリジナルのスタイル (L7)。style が CUSTOM_STYLE_KEY のときに使う。作っていなければ null */
  custom: LyricsCustomStyle | null;
}

/** オリジナルのスタイルを選んでいるときの LyricsMotion.style の値 */
export const CUSTOM_STYLE_KEY = 'zz-custom';

/**
 * オリジナルのスタイル (L7)。JIZURA のスタイルを 1 つ元にして、色・書体・質感を差し替える。
 * 演出の好み (どのレイアウトや登場の仕方が出やすいか) は元のスタイルのものを引き継ぐ。
 * 色はすべて #rrggbb。書体は JIZURA の書体のキー ('' なら元のスタイルのまま)。
 */
export interface LyricsCustomStyle {
  name: string;
  /** 元にする JIZURA のスタイルのキー */
  base: string;
  colors: {
    /** 文字の色 */
    fg: string;
    /** 補助の色 (小さな文字や線) */
    sub: string;
    accent: string;
    accent2: string;
    /** 色ズレの 2 色 */
    ghostA: string;
    ghostB: string;
  };
  fonts: { display: string; serif: string; body: string };
  texture: {
    /** フィルムの粒 (0..1) */
    grain: number;
    /** 走査線 (0..1) */
    scan: number;
    /** 色ズレの強さ (0..1.5) */
    ghost: number;
    /** 光のにじみ (0..1) */
    glow: number;
  };
}

export const defaultLyricsMotion = (): LyricsMotion => ({ enabled: true, style: 'noir', motion: 0.7, decor: 0.5, density: 0.55, custom: null });

export const defaultLyrics = (): LyricsSettings => ({
  engine: 'jizura',
  source: 'text',
  text: '',
  timing: { lineTimes: {}, lineEnds: {}, snap: true, snapWindowMs: 150 },
  motion: defaultLyricsMotion(),
});

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
  lyrics: null,
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
