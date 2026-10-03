import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { EdgeEqualizerPreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'edge-equalizer',
  name: 'Edge Equalizer',
  thumbnail: '',
  version: 1,
  defaults: {},
  // 棒の色 (低音 → 高音のグラデーション) が白く飛ばないよう、ブルームは弱めにしてある
  post: { bloomStrength: 0.3, bloomRadius: 0.3, bloomThreshold: 0.75 },
  controls: [
    {
      type: 'select',
      key: 'edges',
      label: { ja: '使う辺', en: 'Edges' },
      help: { ja: '棒を並べる画面の辺。下の真ん中が低音、上の真ん中が高音です', en: 'Which screen edges get bars. Bass is at the bottom center, treble at the top center' },
      options: [
        { value: 'all', label: { ja: '四辺ぜんぶ', en: 'All four' } },
        { value: 'topbottom', label: { ja: '上と下', en: 'Top and bottom' } },
        { value: 'sides', label: { ja: '左と右', en: 'Left and right' } },
        { value: 'bottom', label: { ja: '下だけ', en: 'Bottom only' } },
      ],
      default: 'all',
    },
    {
      type: 'select',
      key: 'style',
      label: { ja: '棒のスタイル', en: 'Bar style' },
      help: { ja: 'なめらかな棒か、細かく区切った LED 風か', en: 'Smooth bars or LED-style segments' },
      options: [
        { value: 'smooth', label: { ja: 'なめらか', en: 'Smooth' } },
        { value: 'led', label: { ja: 'LED 風 (区切り)', en: 'LED segments' } },
      ],
      default: 'smooth',
    },
    {
      type: 'range',
      key: 'length',
      label: { ja: '棒の長さ', en: 'Bar length' },
      help: { ja: '棒がいちばん伸びたときの長さ (1 で画面の高さの 4 分の 1 ほど)', en: 'Longest a bar can grow (1 = about a quarter of the screen height)' },
      min: 0.4,
      max: 1.5,
      step: 0.01,
      default: 1,
    },
    {
      type: 'range',
      key: 'peaks',
      label: { ja: 'ピーク線', en: 'Peak lines' },
      help: { ja: '棒の先に残る、ゆっくり落ちる細い線の量 (0 で出さない)', en: 'Amount of the slowly falling thin line left at each bar tip (0 = hidden)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.8,
    },
    {
      type: 'range',
      key: 'pulse',
      label: { ja: '拍で走る光', en: 'Beat runner' },
      help: { ja: '拍ごとに縁を走る光の量 (0 で出さない)', en: 'Amount of the light that runs along the edge on each beat (0 = hidden)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7,
    },
  ],
};

export const edgeEqualizerModule: VisualizerModule = {
  manifest,
  create: () => new EdgeEqualizerPreset(),
};
