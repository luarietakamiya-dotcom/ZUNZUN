import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { LedMatrixPreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'led-matrix',
  name: 'LED Matrix',
  thumbnail: '',
  version: 1,
  defaults: {},
  // LED の色 (緑・黄・赤) が白く飛ばないよう、ブルームは弱めにしてある (光過敏の見張りで調整)
  post: { bloomStrength: 0.25, bloomRadius: 0.25, bloomThreshold: 0.8 },
  controls: [
    {
      type: 'select',
      key: 'columns',
      label: { ja: '列の数', en: 'Columns' },
      help: { ja: 'LED の列の数。少ないほど大きな LED になります', en: 'Number of LED columns. Fewer columns mean bigger LEDs' },
      options: [
        { value: '24', label: { ja: '24 列 (大きい)', en: '24 (big)' } },
        { value: '32', label: { ja: '32 列', en: '32' } },
        { value: '48', label: { ja: '48 列 (細かい)', en: '48 (fine)' } },
      ],
      default: '32',
    },
    {
      type: 'select',
      key: 'layout',
      label: { ja: '並べ方', en: 'Layout' },
      help: { ja: '下から積み上がるか、真ん中から上下に広がるか', en: 'Stack up from the bottom, or spread up and down from the center' },
      options: [
        { value: 'bottom', label: { ja: '下から', en: 'From the bottom' } },
        { value: 'center', label: { ja: '真ん中から上下', en: 'From the center' } },
      ],
      default: 'bottom',
    },
    {
      type: 'select',
      key: 'colors',
      label: { ja: '色', en: 'Colors' },
      help: { ja: 'クラシックな緑・黄・赤か、色のテーマの色か', en: 'Classic green / yellow / red, or the color theme' },
      options: [
        { value: 'classic', label: { ja: 'クラシック (緑・黄・赤)', en: 'Classic (green / yellow / red)' } },
        { value: 'theme', label: { ja: 'テーマの色', en: 'Theme colors' } },
      ],
      default: 'classic',
    },
    {
      type: 'range',
      key: 'height',
      label: { ja: '高さ', en: 'Height' },
      help: { ja: 'いちばん伸びたときの高さ', en: 'How tall the meter can grow' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
    },
    {
      type: 'range',
      key: 'dot',
      label: { ja: 'LED の大きさ', en: 'LED size' },
      help: { ja: '1 つの LED の丸の大きさ (小さいと、すき間が広がる)', en: 'Size of each LED dot (smaller leaves more gap)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7,
    },
    {
      type: 'range',
      key: 'grid',
      label: { ja: 'うすい格子', en: 'Faint grid' },
      help: { ja: '点灯していない LED をうっすら見せる量 (0 で消す)', en: 'How faintly the unlit LEDs show (0 = hidden)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.4,
    },
  ],
};

export const ledMatrixModule: VisualizerModule = {
  manifest,
  create: () => new LedMatrixPreset(),
};
