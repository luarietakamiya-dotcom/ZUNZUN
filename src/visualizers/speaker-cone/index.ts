import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { SpeakerConePreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'speaker-cone',
  name: 'Speaker Cone',
  thumbnail: '',
  version: 1,
  defaults: {},
  // 細い線の光なので、しきい値は中くらい (背景の絵に重ねたとき、線のまわりだけがほんのりにじむ)
  post: { bloomStrength: 0.45, bloomRadius: 0.35, bloomThreshold: 0.6 },
  controls: [
    {
      type: 'range',
      key: 'size',
      label: { ja: '大きさ', en: 'Size' },
      help: { ja: 'スピーカーの大きさ (1 で画面の高さのおよそ半分)', en: 'Size of the speaker (1 = about half the screen height)' },
      min: 0.4,
      max: 1.6,
      step: 0.01,
      default: 1,
    },
    {
      type: 'range',
      key: 'offsetX',
      label: { ja: '左右の位置', en: 'Horizontal position' },
      help: { ja: '-1 で左端、0 で真ん中、1 で右端 (画面からはみ出さない範囲で)', en: '-1 = left edge, 0 = center, 1 = right edge (kept inside the screen)' },
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
    },
    {
      type: 'range',
      key: 'offsetY',
      label: { ja: '上下の位置', en: 'Vertical position' },
      help: { ja: '-1 で下端、0 で真ん中、1 で上端 (画面からはみ出さない範囲で)', en: '-1 = bottom edge, 0 = center, 1 = top edge (kept inside the screen)' },
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
    },
    {
      type: 'range',
      key: 'equalizer',
      label: { ja: 'まわりの棒 (イコライザー)', en: 'Surrounding bars (equalizer)' },
      help: { ja: 'スピーカーのまわりに並ぶ、音の高さごとの棒の量 (0 で出さない)', en: 'Amount of the bars around the speaker, one per pitch range (0 = hidden)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.8,
    },
    {
      type: 'range',
      key: 'waves',
      label: { ja: '拍で広がる波', en: 'Beat waves' },
      help: { ja: '拍ごとに外へ広がる輪の量 (0 で出さない)', en: 'Amount of rings that spread outward on each beat (0 = hidden)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7,
    },
  ],
};

export const speakerConeModule: VisualizerModule = {
  manifest,
  create: () => new SpeakerConePreset(),
};
