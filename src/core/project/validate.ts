import { defaultCommonParams, defaultProject, type CommonParams, type ExportSettings, type ProjectFile } from '../types';

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
 *
 * overlays は Step 6 (Overlay Manager) 実装までは常に空配列にする。
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
    overlays: [],
    colors: sanitizeColors(raw.colors),
    fonts: sanitizeFonts(raw.fonts),
    export: sanitizeExport(raw.export, base.export),
  };
}
