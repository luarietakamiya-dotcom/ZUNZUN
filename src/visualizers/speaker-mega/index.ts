import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { SpeakerMegaPreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'speaker-mega',
  name: 'Mega Speaker',
  thumbnail: '',
  version: 1,
  defaults: {},
  // 派手なので、光のにじみは強め。ただし白飛びしないよう、しきい値は高めにしてある (光過敏の見張りで調整)
  post: { bloomStrength: 0.5, bloomRadius: 0.4, bloomThreshold: 0.6 },
  controls: [
    {
      type: 'range',
      key: 'size',
      label: { ja: '大きさ', en: 'Size' },
      help: { ja: 'スピーカーの大きさ (光の筋は画面の外まで伸びます)', en: 'Size of the speaker (the rays reach beyond the screen)' },
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
      key: 'rays',
      label: { ja: '回る光の筋', en: 'Spinning rays' },
      help: { ja: '縁から外へ伸びて回る光の筋の量 (0 で出さない)', en: 'Amount of the spinning rays shooting outward (0 = hidden)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.8,
    },
    {
      type: 'range',
      key: 'rainbow',
      label: { ja: '虹色の流れる速さ', en: 'Rainbow speed' },
      help: { ja: '色が虹のように変わっていく速さ (拍でも少しずつ進みます)', en: 'How fast the colors cycle like a rainbow (they also step on each beat)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
    },
    {
      type: 'range',
      key: 'equalizer',
      label: { ja: 'まわりの棒 (イコライザー)', en: 'Surrounding bars (equalizer)' },
      help: { ja: 'まわりに並ぶ、音の高さごとの棒の量 (0 で出さない)', en: 'Amount of the bars around, one per pitch range (0 = hidden)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.9,
    },
    {
      type: 'range',
      key: 'waves',
      label: { ja: '拍の衝撃波', en: 'Beat shockwaves' },
      help: { ja: '拍ごとに外へ広がる、色のずれた輪の量 (0 で出さない)', en: 'Amount of the color-split rings that spread on each beat (0 = hidden)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.8,
    },
  ],
};

export const speakerMegaModule: VisualizerModule = {
  manifest,
  create: () => new SpeakerMegaPreset(),
};
