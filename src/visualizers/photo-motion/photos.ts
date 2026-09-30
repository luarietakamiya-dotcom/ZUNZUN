import speakerAlleyUrl from '../../assets/library/speaker-alley.webp';
import speakerRackUrl from '../../assets/library/speaker-rack.webp';
import stageLightsUrl from '../../assets/library/stage-lights.webp';
import type { Text2 } from '../../core/i18n';

/**
 * 「写真に動き」で使う写真と、どこにどの効果を付けるか (用意された背景の 3 枚。src/assets/library/)。
 * 位置は写真の上での割合 (左上が 0,0、右下が 1,1)。写真に目印を描いて目で合わせた (docs/HANDOFF.md)。
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

export interface Photo {
  id: string;
  name: Text2;
  url: string;
  /** 写真の横 ÷ 縦 */
  aspect: number;
  speakers: Speaker[];
  regions: Region[];
  /** スモークを流す所と色 (null なら流さない) */
  haze: { x: number; y: number; w: number; h: number; color: [number, number, number] } | null;
}

export const PHOTOS: readonly Photo[] = [
  {
    id: 'speaker-rack',
    name: { ja: 'スピーカーと機材ラック', en: 'Speakers and gear rack' },
    url: speakerRackUrl,
    aspect: 1672 / 941,
    speakers: [
      { x: 0.105, y: 0.462, r: 0.3, band: 'bass', delay: 0 },
      { x: 0.894, y: 0.462, r: 0.3, band: 'bass', delay: 0 },
      { x: 0.084, y: 0.05, r: 0.08, band: 'high', delay: 0 },
      { x: 0.918, y: 0.05, r: 0.08, band: 'high', delay: 0 },
    ],
    regions: [
      { x: 0.335, y: 0.07, w: 0.332, h: 0.14, kind: 'spectrum' },
      { x: 0.35, y: 0.25, w: 0.105, h: 0.07, kind: 'glow' },
      { x: 0.547, y: 0.25, w: 0.105, h: 0.07, kind: 'glow' },
      { x: 0.335, y: 0.455, w: 0.332, h: 0.12, kind: 'glow' },
      { x: 0.47, y: 0.69, w: 0.065, h: 0.13, kind: 'tubes' },
      { x: 0.3, y: 0.84, w: 0.4, h: 0.04, kind: 'glow' },
    ],
    haze: null,
  },
  {
    id: 'stage-lights',
    name: { ja: 'ライブステージ (照明とスモーク)', en: 'Live stage (lights and haze)' },
    url: stageLightsUrl,
    aspect: 1672 / 941,
    speakers: [
      { x: 0.082, y: 0.735, r: 0.13, band: 'bass', delay: 0 },
      { x: 0.918, y: 0.735, r: 0.13, band: 'bass', delay: 0 },
      { x: 0.488, y: 0.585, r: 0.05, band: 'bass', delay: 0.02 },
      { x: 0.25, y: 0.6, r: 0.07, band: 'bass', delay: 0.02 },
      { x: 0.655, y: 0.585, r: 0.06, band: 'bass', delay: 0.02 },
    ],
    regions: [
      { x: 0, y: 0, w: 0.5, h: 0.25, kind: 'lightsL' },
      { x: 0.5, y: 0, w: 0.5, h: 0.25, kind: 'lightsR' },
      { x: 0, y: 0.25, w: 1, h: 0.4, kind: 'glow' },
    ],
    haze: { x: 0.15, y: 0.0, w: 0.7, h: 0.62, color: [0.5, 0.45, 0.4] },
  },
  {
    id: 'speaker-alley',
    name: { ja: 'スピーカーの通路', en: 'Speaker alley' },
    url: speakerAlleyUrl,
    aspect: 1672 / 941,
    speakers: [
      { x: 0.14, y: 0.65, r: 0.117, band: 'bass', delay: 0 },
      { x: 0.858, y: 0.69, r: 0.11, band: 'bass', delay: 0 },
      { x: 0.09, y: 0.31, r: 0.07, band: 'bass', delay: 0.05 },
      { x: 0.173, y: 0.377, r: 0.065, band: 'bass', delay: 0.06 },
      { x: 0.906, y: 0.45, r: 0.075, band: 'bass', delay: 0.05 },
      { x: 0.825, y: 0.4, r: 0.06, band: 'bass', delay: 0.07 },
      { x: 0.075, y: 0.14, r: 0.055, band: 'bass', delay: 0.09 },
      { x: 0.912, y: 0.19, r: 0.05, band: 'bass', delay: 0.09 },
    ],
    regions: [
      { x: 0, y: 0.35, w: 0.3, h: 0.45, kind: 'glow' },
      { x: 0.7, y: 0.35, w: 0.3, h: 0.45, kind: 'glow' },
      { x: 0.15, y: 0, w: 0.2, h: 0.3, kind: 'lightsL' },
      { x: 0.65, y: 0, w: 0.2, h: 0.3, kind: 'lightsR' },
    ],
    haze: { x: 0.3, y: 0.05, w: 0.4, h: 0.65, color: [0.32, 0.38, 0.48] },
  },
];

export const MAX_SPEAKERS = 8;
export const MAX_REGIONS = 6;

export function photoById(id: unknown): Photo {
  return PHOTOS.find((p) => p.id === id) ?? PHOTOS[0]!;
}
