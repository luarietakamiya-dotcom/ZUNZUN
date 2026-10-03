import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { SpeakerTwinPreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'speaker-twin',
  name: 'Twin Speakers',
  thumbnail: '',
  version: 1,
  defaults: {},
  post: { bloomStrength: 0.45, bloomRadius: 0.35, bloomThreshold: 0.6 },
  controls: [
    {
      type: 'range',
      key: 'size',
      label: { ja: '大きさ', en: 'Size' },
      help: { ja: 'スピーカーの大きさ (1 で、画面の高さのおよそ 3 分の 2 にキャビネットが収まる)', en: 'Size of the speakers (at 1 each cabinet is about two thirds of the screen height)' },
      min: 0.4,
      max: 1.6,
      step: 0.01,
      default: 1,
    },
    {
      type: 'range',
      key: 'spacing',
      label: { ja: '間隔', en: 'Spacing' },
      help: { ja: '2 台の間の広さ (0 でぴったり並ぶ、1 で左右の端いっぱい)', en: 'Gap between the two (0 = side by side, 1 = to the screen edges)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
    },
    {
      type: 'range',
      key: 'offsetY',
      label: { ja: '上下の位置', en: 'Vertical position' },
      help: { ja: '-1 で下、0 で真ん中、1 で上 (画面からはみ出さない範囲で)', en: '-1 = bottom, 0 = center, 1 = top (kept inside the screen)' },
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
    },
    {
      type: 'range',
      key: 'overflow',
      label: { ja: 'はみ出し', en: 'Overflow' },
      help: {
        ja: 'スピーカーを画面の外まで動かせる範囲 (0 で画面の中だけ、1 でほとんど外に出して一部だけ使えます。位置のスライダーを端まで動かして使います)',
        en: 'How far the speaker can move off-screen (0 = stays inside, 1 = mostly outside so only part of it shows; use with the position sliders)',
      },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
    },
    {
      type: 'range',
      key: 'alternate',
      label: { ja: '交互に鳴らす', en: 'Alternate' },
      help: { ja: '拍ごとに左右で強く鳴る側が入れ替わる量 (0 で左右とも同じ強さ)', en: 'How much the louder side switches left and right on each beat (0 = both equal)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7,
    },
    {
      type: 'range',
      key: 'strip',
      label: { ja: '足元の棒 (イコライザー)', en: 'Bars under each speaker' },
      help: { ja: '各スピーカーの足元に並ぶ、音の高さごとの棒の量 (0 で出さない)', en: 'Amount of the per-pitch bars under each speaker (0 = hidden)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.8,
    },
  ],
};

export const speakerTwinModule: VisualizerModule = {
  manifest,
  create: () => new SpeakerTwinPreset(),
};
