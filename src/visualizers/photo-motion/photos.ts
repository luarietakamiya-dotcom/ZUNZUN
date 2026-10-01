import speakerAlleyUrl from '../../assets/library/speaker-alley.webp';
import speakerRackUrl from '../../assets/library/speaker-rack.webp';
import stageLightsUrl from '../../assets/library/stage-lights.webp';
import alleyDarkUrl from '../../assets/photo-motion/alley-dark.webp';
import cabinetLeftUrl from '../../assets/photo-motion/cabinet-left.webp';
import cabinetRightUrl from '../../assets/photo-motion/cabinet-right.webp';
import lightsSmokeUrl from '../../assets/photo-motion/lights-smoke.webp';
import rackUrl from '../../assets/photo-motion/rack.webp';
import speakerLeftUrl from '../../assets/photo-motion/speaker-left.webp';
import speakerRightUrl from '../../assets/photo-motion/speaker-right.webp';
import type { Text2 } from '../../core/i18n';

/**
 * 「写真に動き」で使う絵と、どこにどの効果を付けるか。
 * - 写真 1 枚の場面: 用意された背景の 3 枚 (src/assets/library/)
 * - 部品から組み立てる場面: ユーザーが用意した切り抜きの絵 (src/assets/photo-motion/。背景が透明) を重ねる
 * 場面 (Scene) は層 (Layer) の重なり。層ごとに、絵・置き場所・スピーカー・光る所・スモークを持つ。
 * 位置は絵の上での割合 (左上が 0,0、右下が 1,1)。絵に目印を描いて目で合わせた (docs/HANDOFF.md)。
 */

/** 音でふくらむ所 (スピーカーのコーン)。r は写真の高さに対する半径。delay = 遅れ (秒。奥のスピーカーほど遅く) */
export interface Speaker {
  x: number;
  y: number;
  r: number;
  /** 'bass' = 低音でふくらむ (ウーファー)、'high' = 高音で細かく震える (ツイーター) */
  band: 'bass' | 'high';
  delay: number;
}

/**
 * 音で光る所 (四角)。明るい所だけが光る (暗い所はそのまま)。
 * - glow: 音量で光る (メーター・LED)
 * - tubes: 音量で光り、ゆっくりゆらぐ (真空管)
 * - spectrum: 写真の LED のバーを、音の高さごとの強さに合わせて伸び縮みさせる
 * - lightsL / lightsR: 拍ごとに左右交互に強まる (照明)
 */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'glow' | 'tubes' | 'spectrum' | 'lightsL' | 'lightsR';
}

/**
 * 層 1 枚。place が 'cover' なら画面 (の下書き = 16:9 の画用紙) いっぱいに敷く。
 * それ以外は画用紙の上の置き場所 (中心 x, y と高さ h。どれも画用紙に対する割合、左上が 0,0)
 */
export interface Layer {
  url: string;
  /** 絵の横 ÷ 縦 */
  aspect: number;
  place: 'cover' | { x: number; y: number; h: number };
  speakers: Speaker[];
  regions: Region[];
  /** スモークを流す所と色 (null なら流さない) */
  haze: { x: number; y: number; w: number; h: number; color: [number, number, number] } | null;
  /**
   * 明かりの消え具合 (0..1)。0 なら光る所は「いつもの明るさ + 音で明るく」(写真 1 枚の場面)。
   * 大きいほど、静かなときは光る所が消えて暗くなり、音で点く (光っている絵から明かりを消して見せる)
   */
  offDim: number;
  /** true なら、この層全体の濃さが音量と拍で変わる (照明とスモークの層: 静かなときは消え、盛り上がると点く) */
  lights?: boolean;
}

/** 場面 (層の重なり。下から順に描く) */
export interface Scene {
  id: string;
  name: Text2;
  /** いちばん下の色 (層が透明な所に見える) */
  background: [number, number, number];
  layers: Layer[];
}

/** 画用紙の形 (横 ÷ 縦)。写真 1 枚の場面の写真と同じ 16:9 */
export const CANVAS_ASPECT = 1672 / 941;

/** 写真 1 枚の場面を作る */
function photoScene(id: string, name: Text2, url: string, speakers: Speaker[], regions: Region[], haze: Layer['haze']): Scene {
  return { id, name, background: [0, 0, 0], layers: [{ url, aspect: 1672 / 941, place: 'cover', speakers, regions, haze, offDim: 0 }] };
}

export const PHOTOS: readonly Scene[] = [
  photoScene(
    'speaker-rack',
    { ja: 'スピーカーと機材ラック', en: 'Speakers and gear rack' },
    speakerRackUrl,
    [
      { x: 0.105, y: 0.462, r: 0.3, band: 'bass', delay: 0 },
      { x: 0.894, y: 0.462, r: 0.3, band: 'bass', delay: 0 },
      { x: 0.084, y: 0.05, r: 0.08, band: 'high', delay: 0 },
      { x: 0.918, y: 0.05, r: 0.08, band: 'high', delay: 0 },
    ],
    [
      { x: 0.335, y: 0.07, w: 0.332, h: 0.14, kind: 'spectrum' },
      { x: 0.35, y: 0.25, w: 0.105, h: 0.07, kind: 'glow' },
      { x: 0.547, y: 0.25, w: 0.105, h: 0.07, kind: 'glow' },
      { x: 0.335, y: 0.455, w: 0.332, h: 0.12, kind: 'glow' },
      { x: 0.47, y: 0.69, w: 0.065, h: 0.13, kind: 'tubes' },
      { x: 0.3, y: 0.84, w: 0.4, h: 0.04, kind: 'glow' },
    ],
    null,
  ),
  photoScene(
    'stage-lights',
    { ja: 'ライブステージ (照明とスモーク)', en: 'Live stage (lights and haze)' },
    stageLightsUrl,
    [
      { x: 0.082, y: 0.735, r: 0.13, band: 'bass', delay: 0 },
      { x: 0.918, y: 0.735, r: 0.13, band: 'bass', delay: 0 },
      { x: 0.488, y: 0.585, r: 0.05, band: 'bass', delay: 0.02 },
      { x: 0.25, y: 0.6, r: 0.07, band: 'bass', delay: 0.02 },
      { x: 0.655, y: 0.585, r: 0.06, band: 'bass', delay: 0.02 },
    ],
    [
      { x: 0, y: 0, w: 0.5, h: 0.25, kind: 'lightsL' },
      { x: 0.5, y: 0, w: 0.5, h: 0.25, kind: 'lightsR' },
      { x: 0, y: 0.25, w: 1, h: 0.4, kind: 'glow' },
    ],
    { x: 0.15, y: 0.0, w: 0.7, h: 0.62, color: [0.5, 0.45, 0.4] },
  ),
  photoScene(
    'speaker-alley',
    { ja: 'スピーカーの通路', en: 'Speaker alley' },
    speakerAlleyUrl,
    [
      { x: 0.14, y: 0.65, r: 0.117, band: 'bass', delay: 0 },
      { x: 0.858, y: 0.69, r: 0.11, band: 'bass', delay: 0 },
      { x: 0.09, y: 0.31, r: 0.07, band: 'bass', delay: 0.05 },
      { x: 0.173, y: 0.377, r: 0.065, band: 'bass', delay: 0.06 },
      { x: 0.906, y: 0.45, r: 0.075, band: 'bass', delay: 0.05 },
      { x: 0.825, y: 0.4, r: 0.06, band: 'bass', delay: 0.07 },
      { x: 0.075, y: 0.14, r: 0.055, band: 'bass', delay: 0.09 },
      { x: 0.912, y: 0.19, r: 0.05, band: 'bass', delay: 0.09 },
    ],
    [
      { x: 0, y: 0.35, w: 0.3, h: 0.45, kind: 'glow' },
      { x: 0.7, y: 0.35, w: 0.3, h: 0.45, kind: 'glow' },
      { x: 0.15, y: 0, w: 0.2, h: 0.3, kind: 'lightsL' },
      { x: 0.65, y: 0, w: 0.2, h: 0.3, kind: 'lightsR' },
    ],
    { x: 0.3, y: 0.05, w: 0.4, h: 0.65, color: [0.32, 0.38, 0.48] },
  ),
  // ---- 部品から組み立てる場面 (2026-10-01。ユーザーが用意した切り抜きの絵)
  {
    id: 'rack-parts',
    name: { ja: 'ラックとスピーカー (部品から組み立て・音で明かりが点く)', en: 'Rack and speakers (built from parts, lights turn on with the music)' },
    background: [0.006, 0.006, 0.008],
    layers: [
      {
        url: speakerLeftUrl,
        aspect: 1,
        place: { x: 0.175, y: 0.55, h: 0.74 },
        speakers: [{ x: 0.5, y: 0.51, r: 0.36, band: 'bass', delay: 0 }],
        regions: [],
        haze: null,
        offDim: 0,
      },
      {
        url: speakerRightUrl,
        aspect: 1,
        place: { x: 0.825, y: 0.55, h: 0.74 },
        speakers: [
          { x: 0.53, y: 0.6, r: 0.35, band: 'bass', delay: 0 },
          { x: 0.72, y: 0.095, r: 0.075, band: 'high', delay: 0 },
        ],
        regions: [],
        haze: null,
        offDim: 0,
      },
      {
        url: rackUrl,
        aspect: 1122 / 1402,
        place: { x: 0.5, y: 0.5, h: 0.9 },
        speakers: [],
        regions: [
          { x: 0.196, y: 0.128, w: 0.604, h: 0.118, kind: 'spectrum' },
          { x: 0.198, y: 0.289, w: 0.22, h: 0.1, kind: 'glow' },
          { x: 0.58, y: 0.289, w: 0.22, h: 0.1, kind: 'glow' },
          { x: 0.14, y: 0.42, w: 0.72, h: 0.08, kind: 'glow' },
          { x: 0.14, y: 0.5, w: 0.72, h: 0.14, kind: 'glow' },
          { x: 0.14, y: 0.645, w: 0.72, h: 0.1, kind: 'glow' },
          { x: 0.15, y: 0.07, w: 0.7, h: 0.04, kind: 'glow' },
          { x: 0.405, y: 0.75, w: 0.19, h: 0.18, kind: 'tubes' },
        ],
        haze: null,
        offDim: 0.92,
      },
    ],
  },
  {
    id: 'alley-lights',
    name: { ja: 'スピーカーの通路 (音で照明が点く)', en: 'Speaker alley (lights turn on with the music)' },
    background: [0, 0, 0],
    layers: [
      { url: alleyDarkUrl, aspect: 1672 / 941, place: 'cover', speakers: [], regions: [], haze: { x: 0.25, y: 0.05, w: 0.5, h: 0.7, color: [0.3, 0.36, 0.46] }, offDim: 0 },
      { url: lightsSmokeUrl, aspect: 1672 / 941, place: 'cover', speakers: [], regions: [], haze: null, offDim: 0, lights: true },
      {
        url: cabinetLeftUrl,
        aspect: 1,
        place: { x: 0.12, y: 0.78, h: 0.44 },
        speakers: [{ x: 0.6, y: 0.49, r: 0.27, band: 'bass', delay: 0 }],
        regions: [],
        haze: null,
        offDim: 0,
      },
      {
        url: cabinetRightUrl,
        aspect: 1,
        place: { x: 0.88, y: 0.78, h: 0.44 },
        speakers: [{ x: 0.435, y: 0.52, r: 0.27, band: 'bass', delay: 0 }],
        regions: [],
        haze: null,
        offDim: 0,
      },
    ],
  },
];

export const MAX_SPEAKERS = 8;
export const MAX_REGIONS = 8;

export function photoById(id: unknown): Scene {
  return PHOTOS.find((p) => p.id === id) ?? PHOTOS[0]!;
}
