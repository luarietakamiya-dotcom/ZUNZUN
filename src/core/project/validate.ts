import {
  defaultCommonParams,
  defaultLyrics,
  defaultLyricsMotion,
  defaultProject,
  type CommonParams,
  type ExportSettings,
  type LyricsMotion,
  type LyricsSettings,
  type OverlayLayer,
  type ProjectFile,
} from '../types';

/**
 * 外部由来 (ファイル読み込み) の JSON は信頼しない前提で検証する。
 * JIZURA の mergeProject と同じ方針: 未知のキーは捨て、数値は clamp し、壊れた値は
 * defaultProject() の値で補う。将来 ProjectFile.version が増えたら、ここで migrate する
 * (現状は version 1 のみなので migrate は恒等写像)。
 */
export class ProjectParseError extends Error {}

const COMMON_NUMBER_RANGES: Partial<Record<keyof CommonParams, readonly [number, number]>> = {
  intensity: [0, 1],
  sensitivity: [0, 1],
  bass: [0, 2],
  mid: [0, 2],
  high: [0, 2],
  glow: [0, 1],
  motion: [0, 1],
  cameraMotion: [0, 1],
};

const ID_PATTERN = /^[\w-]+$/;
const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function sanitizeCommonParams(raw: unknown): CommonParams {
  // key ごとに number/string が混在する書き込み先なので、いったん Record<string, unknown> として
  // 扱う (mapped type への narrow な代入は TS が "never" と誤判定するため)。最後に CommonParams として返す。
  const out: Record<string, unknown> = { ...defaultCommonParams() };
  if (isPlainObject(raw)) {
    for (const key of Object.keys(out)) {
      const v = raw[key];
      const range = COMMON_NUMBER_RANGES[key as keyof CommonParams];
      if (range && isFiniteNumber(v)) {
        out[key] = clamp(v, range[0], range[1]);
      } else if (key === 'colorTheme' && typeof v === 'string' && ID_PATTERN.test(v)) {
        out[key] = v;
      }
    }
  }
  return out as unknown as CommonParams;
}

function sanitizeExport(raw: unknown, base: ExportSettings): ExportSettings {
  if (!isPlainObject(raw)) return base;
  const width = isFiniteNumber(raw.width) ? Math.round(clamp(raw.width, 64, 7680)) : base.width;
  const height = isFiniteNumber(raw.height) ? Math.round(clamp(raw.height, 64, 7680)) : base.height;
  const fps = isFiniteNumber(raw.fps) ? Math.round(clamp(raw.fps, 1, 240)) : base.fps;
  const format = raw.format === 'mp4' || raw.format === 'webm' || raw.format === 'png-sequence' ? raw.format : base.format;
  const quality = raw.quality === 'draft' || raw.quality === 'high' || raw.quality === 'max' ? raw.quality : base.quality;
  const transparent = typeof raw.transparent === 'boolean' ? raw.transparent : base.transparent;
  return { width, height, fps, format, quality, transparent };
}

function sanitizeAudio(raw: unknown): ProjectFile['audio'] {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.ref !== 'string' || typeof raw.sha256 !== 'string' || raw.ref === '' || raw.sha256 === '') return null;
  return {
    ref: raw.ref,
    sha256: raw.sha256,
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : raw.ref,
    duration: isFiniteNumber(raw.duration) ? raw.duration : 0,
    sampleRate: isFiniteNumber(raw.sampleRate) ? raw.sampleRate : 0,
    bpm: isFiniteNumber(raw.bpm) ? raw.bpm : 0,
  };
}

const OVERLAY_NUMBER_RANGES: Record<Exclude<keyof OverlayLayer, 'id' | 'ref' | 'sha256'>, readonly [number, number]> = {
  // 画面の外に半分はみ出す配置も許すため、0..1 より少し広めに取る
  x: [-2, 3],
  y: [-2, 3],
  scale: [0.01, 5],
  rotation: [-Math.PI * 4, Math.PI * 4],
  opacity: [0, 1],
  z: [-1000, 1000],
  glow: [0, 2],
  float: [0, 2],
  beat: [0, 2],
};

function sanitizeOverlayLayer(raw: unknown): OverlayLayer | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.ref !== 'string' || raw.ref === '') return null;
  if (typeof raw.sha256 !== 'string' || raw.sha256 === '') return null;

  const num = (key: keyof typeof OVERLAY_NUMBER_RANGES, fallback: number): number => {
    const v = raw[key];
    const [min, max] = OVERLAY_NUMBER_RANGES[key];
    return isFiniteNumber(v) ? clamp(v, min, max) : fallback;
  };

  return {
    id: raw.id,
    ref: raw.ref,
    sha256: raw.sha256,
    x: num('x', 0.5),
    y: num('y', 0.5),
    scale: num('scale', 0.3),
    rotation: num('rotation', 0),
    opacity: num('opacity', 1),
    z: num('z', 0),
    glow: num('glow', 0),
    float: num('float', 0),
    beat: num('beat', 0),
  };
}

/** 壊れたレイヤーは黙って除外し、id が重複するレイヤーは後勝ちを捨てて先勝ちを残す。 */
function sanitizeOverlays(raw: unknown): OverlayLayer[] {
  if (!Array.isArray(raw)) return [];
  const out: OverlayLayer[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    const layer = sanitizeOverlayLayer(item);
    if (layer && !seenIds.has(layer.id)) {
      out.push(layer);
      seenIds.add(layer.id);
    }
  }
  return out;
}

/** 歌詞テキストの上限 (文字数)。普通の歌詞は数千文字なので、壊れた/悪意あるファイルで固まらない程度に余裕を持たせる */
export const MAX_LYRICS_LENGTH = 200_000;
/** 行番号の上限。lineTimes のキーがこれを超えるものは捨てる */
const MAX_LYRIC_LINES = 10_000;
/** 時刻の上限 (秒)。24 時間 */
const MAX_LYRIC_TIME = 86_400;
const LINE_KEY_PATTERN = /^\d{1,5}$/;

function sanitizeLineTimeMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isPlainObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!LINE_KEY_PATTERN.test(k) || +k >= MAX_LYRIC_LINES || !isFiniteNumber(v)) continue;
    out[String(+k)] = clamp(v, 0, MAX_LYRIC_TIME);
  }
  return out;
}

function sanitizeLyrics(raw: unknown): LyricsSettings | null {
  if (!isPlainObject(raw)) return null;
  const base = defaultLyrics();
  const timingRaw = isPlainObject(raw.timing) ? raw.timing : {};
  return {
    engine: 'jizura',
    source: raw.source === 'text' || raw.source === 'lrc' || raw.source === 'srt' ? raw.source : base.source,
    text: typeof raw.text === 'string' ? raw.text.slice(0, MAX_LYRICS_LENGTH) : base.text,
    timing: {
      lineTimes: sanitizeLineTimeMap(timingRaw.lineTimes),
      lineEnds: sanitizeLineTimeMap(timingRaw.lineEnds),
      snap: typeof timingRaw.snap === 'boolean' ? timingRaw.snap : base.timing.snap,
      snapWindowMs: isFiniteNumber(timingRaw.snapWindowMs) ? Math.round(clamp(timingRaw.snapWindowMs, 0, 1000)) : base.timing.snapWindowMs,
    },
    motion: sanitizeLyricsMotion(raw.motion),
  };
}

/** 歌詞モーションの設定。スタイル名はキーの形だけ確かめる (存在しないスタイルは JIZURA 側で既定の noir になる) */
function sanitizeLyricsMotion(raw: unknown): LyricsMotion {
  const base = defaultLyricsMotion();
  if (!isPlainObject(raw)) return base;
  const unit = (v: unknown, fallback: number): number => (isFiniteNumber(v) ? clamp(v, 0, 1) : fallback);
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    style: typeof raw.style === 'string' && ID_PATTERN.test(raw.style) && raw.style.length <= 64 ? raw.style : base.style,
    motion: unit(raw.motion, base.motion),
    decor: unit(raw.decor, base.decor),
    density: unit(raw.density, base.density),
  };
}

function sanitizeColors(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isPlainObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (ID_PATTERN.test(k) && typeof v === 'string' && HEX_COLOR_PATTERN.test(v)) out[k] = v;
  }
  return out;
}

function sanitizeFonts(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isPlainObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (ID_PATTERN.test(k) && typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * 未検証の値 (JSON.parse の結果) を、安全な ProjectFile に変換する。
 * format/version が想定と違う場合のみ例外を投げる。それ以外の壊れたフィールドは
 * 既定値で補い、読み込み自体は失敗させない (JIZURA の mergeProject と同じ寛容さ)。
 */
export function sanitizeProject(raw: unknown): ProjectFile {
  if (!isPlainObject(raw)) {
    throw new ProjectParseError('プロジェクトファイルの形式が不正です (JSON オブジェクトではありません)');
  }
  if (raw.format !== 'zunzun-project') {
    throw new ProjectParseError('ZUNZUN のプロジェクトファイルではありません');
  }
  if (raw.version !== 1) {
    throw new ProjectParseError(`未対応のバージョンです (version: ${String(raw.version)})`);
  }

  const base = defaultProject();
  const visualizerRaw = isPlainObject(raw.visualizer) ? raw.visualizer : {};
  const presetCandidate = visualizerRaw.preset;
  const presetVersionCandidate = visualizerRaw.presetVersion;

  return {
    format: 'zunzun-project',
    version: 1,
    app: typeof raw.app === 'string' ? raw.app : base.app,
    seed: isFiniteNumber(raw.seed) ? raw.seed >>> 0 : base.seed,
    audio: sanitizeAudio(raw.audio),
    visualizer: {
      preset: typeof presetCandidate === 'string' && ID_PATTERN.test(presetCandidate) ? presetCandidate : base.visualizer.preset,
      presetVersion: isFiniteNumber(presetVersionCandidate) ? Math.round(presetVersionCandidate) : base.visualizer.presetVersion,
      common: sanitizeCommonParams(visualizerRaw.common),
      params: isPlainObject(visualizerRaw.params) ? { ...visualizerRaw.params } : {},
    },
    overlays: sanitizeOverlays(raw.overlays),
    lyrics: sanitizeLyrics(raw.lyrics),
    colors: sanitizeColors(raw.colors),
    fonts: sanitizeFonts(raw.fonts),
    export: sanitizeExport(raw.export, base.export),
  };
}
