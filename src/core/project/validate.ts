import { formatGrouping, parseGrouping } from '../rhythm/grouping';
import { normalizeBars } from '../rhythm/grid';
import {
  defaultCommonParams,
  defaultLyrics,
  defaultLyricsMotion,
  defaultProject,
  defaultBackground,
  defaultRhythm,
  type CommonParams,
  type ExportSettings,
  type LyricsCustomStyle,
  type LyricsMotion,
  type LyricsSettings,
  type LyricsStem,
  type OverlayLayer,
  type ProjectFile,
  type BackgroundSettings,
  type RhythmSettings,
  type ViewSettings,
  type MediaLayer,
  defaultMediaLayer,
  defaultSlides,
  MAX_SLIDES,
  type BackgroundSlide,
  type BackgroundSlides,
  type LyricBlank,
  type LyricsSectionMotion,
  type MotionLevel,
} from '../types';
import { SECTION_KINDS } from '../lyrics/section-motion';
import { MAX_BLANKS, normalizeBlanks } from '../lyrics/blanks';
import { normalizeView } from '../render/view';
import { normalizeComposition } from '../render/composition';
import { sanitizePresetParamsMap } from '../visualizer/preset-params';
import { tr } from '../i18n';

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
      ...(Array.isArray(timingRaw.blanks) ? { blanks: sanitizeBlanks(timingRaw.blanks) } : {}),
    },
    motion: sanitizeLyricsMotion(raw.motion),
    stem: sanitizeLyricsStem(raw.stem),
  };
}

/** ボーカル stem の参照。ファイル名と sha256 が無ければ使わない (null) */
function sanitizeLyricsStem(raw: unknown): LyricsStem | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.ref !== 'string' || typeof raw.sha256 !== 'string' || raw.ref === '' || !/^[0-9a-f]{64}$/.test(raw.sha256)) return null;
  return { ref: raw.ref.slice(0, 512), sha256: raw.sha256, enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true };
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
    custom: sanitizeCustomStyle(raw.custom),
    ...(isPlainObject(raw.sections) ? { sections: sanitizeSectionMotion(raw.sections) } : {}),
  };
}

/** 区切りごとの動きの強さ。知らない区切りの種類・強さは捨てる */
function sanitizeSectionMotion(raw: Record<string, unknown>): LyricsSectionMotion {
  const levels: Partial<Record<string, MotionLevel>> = {};
  if (isPlainObject(raw.levels)) {
    for (const k of SECTION_KINDS) {
      const v = raw.levels[k];
      if (v === 'calm' || v === 'normal' || v === 'intense') levels[k] = v;
    }
  }
  return { enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true, levels };
}

/** 歌詞の空白。始まり・終わりが数で、0.5 秒以上のものだけ (重なりはまとめる) */
function sanitizeBlanks(raw: unknown[]): LyricBlank[] {
  const items: LyricBlank[] = [];
  for (const b of raw.slice(0, MAX_BLANKS * 2)) {
    if (!isPlainObject(b) || !isFiniteNumber(b.start) || !isFiniteNumber(b.end)) continue;
    items.push({ start: clamp(b.start, 0, 1e6), end: clamp(b.end, 0, 1e6), mode: b.mode === 'interlude' ? 'interlude' : 'none' });
  }
  return normalizeBlanks(items);
}

/** 背景の一枚絵・動画。ファイル名と sha256 (64 桁の 16 進) が無ければ使わない。値は範囲に収め、知らない選択肢は既定に戻す */
function sanitizeBackground(raw: unknown): BackgroundSettings | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.ref !== 'string' || raw.ref === '' || typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256)) return null;
  const kind = raw.kind === 'video' ? 'video' : 'image';
  const base = defaultBackground(raw.ref.slice(0, 512), raw.sha256, kind);
  const unit = (v: unknown, fallback: number): number => (isFiniteNumber(v) ? clamp(v, 0, 1) : fallback);
  return {
    ...base,
    fit: raw.fit === 'contain' ? 'contain' : 'cover',
    dim: unit(raw.dim, base.dim),
    blur: unit(raw.blur, base.blur),
    loop: typeof raw.loop === 'boolean' ? raw.loop : base.loop,
    ...(kind === 'image' ? sanitizeSlides(raw.slides) : {}),
  };
}

/** スライドショー。画像が 2 枚未満なら無し (1 枚の背景として扱う) */
function sanitizeSlides(raw: unknown): { slides?: BackgroundSlides } {
  if (!isPlainObject(raw) || !Array.isArray(raw.items)) return {};
  const items: BackgroundSlide[] = [];
  for (const it of raw.items.slice(0, MAX_SLIDES)) {
    if (!isPlainObject(it) || typeof it.ref !== 'string' || it.ref === '' || typeof it.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(it.sha256)) continue;
    items.push({ ref: it.ref.slice(0, 512), sha256: it.sha256 });
  }
  if (items.length < 2) return {};
  const base = defaultSlides(items);
  return {
    slides: {
      items,
      transition: raw.transition === 'cut' ? 'cut' : 'fade',
      fadeSec: isFiniteNumber(raw.fadeSec) ? clamp(raw.fadeSec, 0.1, 3) : base.fadeSec,
      pace: isFiniteNumber(raw.pace) ? clamp(raw.pace, 0, 1) : base.pace,
    },
  };
}

const MAX_MEDIA = 64;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** 素材レイヤー。ファイル名と sha256 と id が無いもの、id が重複するもの (後の方) は捨てる */
function sanitizeMedia(raw: unknown): MediaLayer[] {
  if (!Array.isArray(raw)) return [];
  const out: MediaLayer[] = [];
  const unit = (v: unknown, d: number): number => (isFiniteNumber(v) ? clamp(v, 0, 1) : d);
  for (const item of raw.slice(0, MAX_MEDIA)) {
    if (!isPlainObject(item)) continue;
    const { id, ref, sha256 } = item;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || out.some((m) => m.id === id)) continue;
    if (typeof ref !== 'string' || ref === '' || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) continue;
    const kind = item.kind === 'video' ? 'video' : 'image';
    const d = defaultMediaLayer(id, ref.slice(0, 512), sha256, kind);
    const ch = isPlainObject(item.chroma) ? item.chroma : {};
    out.push({
      ...d,
      x: isFiniteNumber(item.x) ? clamp(item.x, -1, 2) : d.x,
      y: isFiniteNumber(item.y) ? clamp(item.y, -1, 2) : d.y,
      scale: isFiniteNumber(item.scale) ? clamp(item.scale, 0.01, 4) : d.scale,
      rotation: isFiniteNumber(item.rotation) ? clamp(item.rotation, -180, 180) : d.rotation,
      opacity: unit(item.opacity, d.opacity),
      blend: item.blend === 'screen' || item.blend === 'add' ? item.blend : 'normal',
      chroma: {
        enabled: typeof ch.enabled === 'boolean' ? ch.enabled : d.chroma.enabled,
        color: typeof ch.color === 'string' && HEX_COLOR.test(ch.color) ? ch.color.toLowerCase() : d.chroma.color,
        tolerance: unit(ch.tolerance, d.chroma.tolerance),
        softness: unit(ch.softness, d.chroma.softness),
        spill: unit(ch.spill, d.chroma.spill),
        // 縁を削る量は 2026-09-30 に足した。前のプロジェクトには無いので 0 (今までと同じ見た目)
        choke: unit(ch.choke, 0),
      },
      loop: typeof item.loop === 'boolean' ? item.loop : d.loop,
    });
  }
  return out;
}

const MAX_BARS = 10_000;
const MAX_METERS = 500;

/** 小節と拍子 (変拍子モード)。壊れた小節の時刻・拍子は捨て、拍子が 1 つも無ければ既定 (4) にする */
function sanitizeRhythm(raw: unknown): RhythmSettings | null {
  if (!isPlainObject(raw)) return null;
  const base = defaultRhythm();
  const bars = Array.isArray(raw.bars) ? raw.bars.filter(isFiniteNumber).slice(0, MAX_BARS).map((t) => clamp(t, 0, MAX_LYRIC_TIME)) : [];
  const byBar = new Map<number, string>();
  if (Array.isArray(raw.meters)) {
    for (const m of raw.meters.slice(0, MAX_METERS)) {
      if (!isPlainObject(m) || !isFiniteNumber(m.bar) || typeof m.pattern !== 'string') continue;
      const groups = parseGrouping(m.pattern);
      if (!groups) continue;
      byBar.set(Math.round(clamp(m.bar, 0, MAX_BARS)), formatGrouping(groups));
    }
  }
  const meters = [...byBar.entries()].sort((a, b) => a[0] - b[0]).map(([bar, pattern]) => ({ bar, pattern }));
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    bars: normalizeBars(bars),
    meters: meters.length > 0 ? meters : base.meters,
  };
}

const HEX6_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** オリジナルのスタイル。形が崩れていれば null (元のスタイルが無いと作れないため、部分的には直さない) */
function sanitizeCustomStyle(raw: unknown): LyricsCustomStyle | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.base !== 'string' || !ID_PATTERN.test(raw.base) || raw.base.length > 64) return null;
  const colorsRaw = isPlainObject(raw.colors) ? raw.colors : {};
  const fontsRaw = isPlainObject(raw.fonts) ? raw.fonts : {};
  const textureRaw = isPlainObject(raw.texture) ? raw.texture : {};
  const color = (v: unknown, fallback: string): string => (typeof v === 'string' && HEX6_PATTERN.test(v) ? v.toLowerCase() : fallback);
  const font = (v: unknown): string => (typeof v === 'string' && ID_PATTERN.test(v) && v.length <= 64 ? v : '');
  const num = (v: unknown, max: number, fallback: number): number => (isFiniteNumber(v) ? clamp(v, 0, max) : fallback);
  // 名前: 制御文字を取り除いて 40 文字まで
  // eslint-disable-next-line no-control-regex
  const name = typeof raw.name === 'string' ? raw.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) : '';
  return {
    name: name || 'マイスタイル',
    base: raw.base,
    colors: {
      fg: color(colorsRaw.fg, '#ffffff'),
      sub: color(colorsRaw.sub, '#bbbbbb'),
      accent: color(colorsRaw.accent, '#f5a50c'),
      accent2: color(colorsRaw.accent2, '#16f4d4'),
      ghostA: color(colorsRaw.ghostA, '#f5a50c'),
      ghostB: color(colorsRaw.ghostB, '#16f4d4'),
    },
    fonts: { display: font(fontsRaw.display), serif: font(fontsRaw.serif), body: font(fontsRaw.body) },
    texture: {
      grain: num(textureRaw.grain, 1, 0.5),
      scan: num(textureRaw.scan, 1, 0),
      ghost: num(textureRaw.ghost, 1.5, 1),
      glow: num(textureRaw.glow, 1, 0),
    },
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
    throw new ProjectParseError(tr('プロジェクトファイルの形が正しくありません (JSON のオブジェクトではありません)', 'Invalid project file (not a JSON object)'));
  }
  if (raw.format !== 'zunzun-project') {
    throw new ProjectParseError(tr('ZUNZUN のプロジェクトファイルではありません', 'Not a ZUNZUN project file'));
  }
  if (raw.version !== 1) {
    throw new ProjectParseError(tr(`対応していないバージョンです (version: ${String(raw.version)})`, `Unsupported version (version: ${String(raw.version)})`));
  }

  const base = defaultProject();
  const media = sanitizeMedia(raw.media);
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
      params: sanitizePresetParamsMap(visualizerRaw.params),
      view: normalizeView(isPlainObject(visualizerRaw.view) ? (visualizerRaw.view as Partial<ViewSettings>) : null),
    },
    overlays: sanitizeOverlays(raw.overlays),
    lyrics: sanitizeLyrics(raw.lyrics),
    rhythm: sanitizeRhythm(raw.rhythm),
    background: sanitizeBackground(raw.background),
    // 古いプロジェクトは、ビジュアライザーの重ね方を背景の設定 (blend / visualizerOpacity) に持っていたので、そこから移す
    media,
    composition: normalizeComposition(raw.composition, { legacy: isPlainObject(raw.background) ? raw.background : null, mediaIds: media.map((m) => m.id) }),
    colors: sanitizeColors(raw.colors),
    fonts: sanitizeFonts(raw.fonts),
    export: sanitizeExport(raw.export, base.export),
  };
}
