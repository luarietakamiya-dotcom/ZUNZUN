import type { Text2 } from './i18n';
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

/**
 * ビジュアライザーの見え方 (どのプリセットにも共通。Host がカメラの「見る窓」と傾きで反映する。プリセットは知らない)。
 * 拡大はカメラの見る範囲を狭めて描くので、拡大しても粗くならない。1 より小さくすると、見える範囲が広がる。
 */
export interface ViewSettings {
  /** 拡大 (0.5..4、1 = そのまま) */
  zoom: number;
  /** 見る位置を横にずらす (-1..1、1 = 画面の半分だけ右を見る) */
  x: number;
  /** 見る位置を縦にずらす (-1..1、1 = 画面の半分だけ上を見る) */
  y: number;
  /** 傾き (度、-180..180。正 = 映る絵が反時計回り) */
  roll: number;
}

export const defaultView = (): ViewSettings => ({ zoom: 1, x: 0, y: 0, roll: 0 });
export const VIEW_ZOOM_MIN = 0.5;
export const VIEW_ZOOM_MAX = 4;

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
  /**
   * このプリセットだけの設定 (Visualizer タブの「このビジュアライザーの設定」に出る)。値は update() の params に
   * key の名前で入る (core/visualizer/preset-params.ts)。Project JSON の visualizer.params にプリセットごとに保存される
   */
  controls?: PresetControl[];
}

/** プリセットだけの設定 1 つ。名前と説明は日本語 / English (誰が見ても分かるように) */
export type PresetControl =
  | { type: 'range'; key: string; label: Text2; help: Text2; min: number; max: number; step: number; default: number }
  | { type: 'select'; key: string; label: Text2; help: Text2; options: { value: string; label: Text2 }[]; default: string };

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
    /** 見え方 (拡大・位置・傾き)。古いプロジェクトには無い (読み込むと既定になる) */
    view?: ViewSettings;
  };
  overlays: OverlayLayer[];
  /** 歌詞と、その同期タイミング・歌詞モーションの設定。歌詞を使わないプロジェクトは null */
  lyrics: LyricsSettings | null;
  /** 小節と拍子 (変拍子モード)。使わないプロジェクトは null (docs/ARCHITECTURE.md「変拍子（リズム）の方針」) */
  rhythm: RhythmSettings | null;
  /** 背景の一枚絵・動画。使わないプロジェクトは null (docs/ARCHITECTURE.md「背景」) */
  background: BackgroundSettings | null;
  /** レイヤーの順番と重ね方。古いプロジェクトには無い (読み込むと、背景の設定から移して作る) */
  composition?: CompositionSettings;
  /** 素材レイヤー (画像・動画、グリーンバックの素材など)。古いプロジェクトには無い */
  media?: MediaLayer[];
  colors: Record<string, string>;
  fonts: Record<string, string>;
  export: ExportSettings;
}

/**
 * 小節と拍子 (変拍子モード)。小節の頭はユーザーがタップで決め、拍子は区間ごとに「拍のまとまり」で書く。
 * 例: "2+2+3" = 1 小節を 7 等分して 2・2・3 にまとめる (7/8)。"4" = 4 等分 (4/4)。"3+2" = 5 等分を 3・2 に。
 */
export interface RhythmSettings {
  /** 変拍子モードを使うか (オフなら自動検出のビートを使う) */
  enabled: boolean;
  /** 小節の頭の時刻 (秒、昇順) */
  bars: number[];
  /** 拍子の区間。bar 番目の小節 (0 始まり) から pattern の拍子になる。bar の昇順 */
  meters: RhythmMeter[];
}

export interface RhythmMeter {
  bar: number;
  pattern: string;
}

/**
 * 背景の一枚絵 (のちに動画も)。描画の順番は 背景 → ビジュアライザー (PostFX 込み、blend で重ねる) → 歌詞 → オーバーレイ。
 * 中身は保存せず、ファイル名と sha256 だけを持つ (オーバーレイと同じ)。
 */
export interface BackgroundSettings {
  ref: string;
  sha256: string;
  kind: 'image' | 'video';
  /** 'cover' = 画面いっぱい (はみ出しは切る)、'contain' = 全体を収める (余りは黒) */
  fit: 'cover' | 'contain';
  /** 背景を暗くする量 (0 = そのまま、1 = 真っ黒) */
  dim: number;
  /** ぼかし (0..1、画像だけ) */
  blur: number;
  /** 動画が曲より短いとき、くり返すか (false なら最後の絵で止める) */
  loop: boolean;
  /**
   * スライドショー (フォルダ・複数の画像を、曲に合わせて自動で切り替える)。無ければ 1 枚の背景。
   * あるときは kind = 'image'、ref / sha256 は 1 枚目 (色の読み取りなどは 1 枚目を使う)
   */
  slides?: BackgroundSlides | null;
}

/** スライドショーの画像 1 枚 (中身は保存しない。ファイル名と sha256 だけ) */
export interface BackgroundSlide {
  ref: string;
  sha256: string;
}

export interface BackgroundSlides {
  /** ファイル名の順 */
  items: BackgroundSlide[];
  /** 'cut' = パッと切り替え、'fade' = じわっと重なる */
  transition: 'cut' | 'fade';
  /** じわっと重なる長さ (秒) */
  fadeSec: number;
  /** 切り替えの細かさ (0..1、0.5 が既定。上げるほど速い) */
  pace: number;
}

/** スライドショーの画像の上限 */
export const MAX_SLIDES = 100;

export const defaultSlides = (items: BackgroundSlide[]): BackgroundSlides => ({ items, transition: 'fade', fadeSec: 0.6, pace: 0.5 });

export const defaultBackground = (ref: string, sha256: string, kind: BackgroundSettings['kind']): BackgroundSettings => ({
  ref,
  sha256,
  kind,
  fit: 'cover',
  dim: 0.35,
  blur: 0,
  loop: true,
});

/**
 * ビジュアライザーを、その下のレイヤーにどう重ねるか。'screen' = スクリーン合成 (黒は透けて光だけ乗る)、'add' = 加算、
 * 'over' = そのまま上に (濃さで透かす。1 なら下は見えない)
 */
export type VisualizerBlend = 'screen' | 'add' | 'over';

/** 決まったレイヤー (素材のレイヤーは 'media:<id>') */
export const BASE_LAYERS = ['background', 'visualizer', 'lyrics', 'overlays'] as const;
export type BaseLayerId = (typeof BASE_LAYERS)[number];

/**
 * 画面の組み立て (レイヤーの順番と重ね方。docs/ARCHITECTURE.md「レイヤー」)。
 * 以前は背景の設定 (background.blend / visualizerOpacity) に入っていたビジュアライザーの重ね方も、ここに持つ
 * (背景が無くても、下に素材を置けば重ね方が要るため)。古いプロジェクトは読み込むときに移す。
 */
export interface CompositionSettings {
  /** 奥 → 手前の順。決まったレイヤーは必ず 1 回ずつ入る */
  order: string[];
  /** 隠しているレイヤー */
  hidden: string[];
  visualizerBlend: VisualizerBlend;
  /** ビジュアライザーの濃さ (0..1) */
  visualizerOpacity: number;
  /** 歌詞の濃さ (0..1) */
  lyricsOpacity: number;
}

/** クロマキー (決めた色を透かす。グリーンバックの素材用) */
export interface ChromaKey {
  enabled: boolean;
  /** 透かす色 (#rrggbb) */
  color: string;
  /** どこまで近い色を透かすか (0..1) */
  tolerance: number;
  /** 境目のぼかし (0..1) */
  softness: number;
  /** 被写体の縁に残る色 (緑のにじみ) を取る量 (0..1) */
  spill: number;
  /** 縁を削る量 (0..1)。残る所の縁を少し内側へ削って、被写体のまわりの細い緑の線を消す (1 = 素材の画素で 3 つぶん) */
  choke: number;
}

/** 素材レイヤー (画像・動画。レイヤーの順番の中では 'media:<id>')。中身は保存せず、ファイル名と sha256 だけ */
export interface MediaLayer {
  id: string;
  ref: string;
  sha256: string;
  kind: 'image' | 'video';
  /** 中心の位置 (0 = 左 / 下の端、1 = 右 / 上の端) */
  x: number;
  y: number;
  /** 画面の高さに対する大きさ (1 = 画面の高さと同じ) */
  scale: number;
  /** 回転 (度、正 = 反時計回り) */
  rotation: number;
  opacity: number;
  /** 下のレイヤーへの重ね方 ('normal' = そのまま上に) */
  blend: 'normal' | 'screen' | 'add';
  chroma: ChromaKey;
  /** 動画が曲より短いとき、くり返すか */
  loop: boolean;
}

/** 新しい素材の既定値 (2026-09-30 見直し: 緑が残りやすかったので、範囲とにじみ取りを強めにし、縁を少し削る) */
export const defaultChromaKey = (): ChromaKey => ({ enabled: false, color: '#00ff00', tolerance: 0.4, softness: 0.12, spill: 0.8, choke: 0.35 });

export const defaultMediaLayer = (id: string, ref: string, sha256: string, kind: MediaLayer['kind']): MediaLayer => ({
  id,
  ref,
  sha256,
  kind,
  x: 0.5,
  y: 0.5,
  scale: 0.6,
  rotation: 0,
  opacity: 1,
  blend: 'normal',
  chroma: defaultChromaKey(),
  loop: true,
});

export const defaultComposition = (): CompositionSettings => ({
  order: [...BASE_LAYERS],
  hidden: [],
  visualizerBlend: 'screen',
  visualizerOpacity: 1,
  lyricsOpacity: 1,
});

export const defaultRhythm = (): RhythmSettings => ({ enabled: false, bars: [], meters: [{ bar: 0, pattern: '4' }] });

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
  /** 吸着に使うボーカルだけの音源 (stem)。使わなければ null */
  stem: LyricsStem | null;
}

/**
 * ボーカルだけの音源 (stem)。Lyrics タブの吸着 (歌い出し候補) にだけ使い、再生・ビジュアライザー・書き出し・小節の吸着は
 * 元の曲のまま。音源の中身は保存せず、ファイル名と sha256 だけを持つ (読み込み直したときに同じファイルか確かめる)。
 */
export interface LyricsStem {
  ref: string;
  sha256: string;
  /** 吸着に stem を使うか (オフなら元の曲の歌い出し候補) */
  enabled: boolean;
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
  stem: null,
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
  rhythm: null,
  background: null,
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
