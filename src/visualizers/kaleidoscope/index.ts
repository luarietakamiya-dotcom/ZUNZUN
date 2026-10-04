import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { KaleidoscopePreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'kaleidoscope',
  name: 'Kaleidoscope',
  thumbnail: '',
  version: 1,
  defaults: {},
  // 広い面積が光るので、ブルームは弱め (白く飛ばさない)
  post: { bloomStrength: 0.3, bloomRadius: 0.4, bloomThreshold: 0.7 },
  controls: [
    {
      type: 'range',
      key: 'segments',
      label: { ja: '鏡の枚数', en: 'Mirrors' },
      help: { ja: '鏡で折り返す数 (3〜12。多いほど細かく対称な模様)', en: 'Number of mirrored segments (3-12; more = finer, more symmetric)' },
      min: 3,
      max: 12,
      step: 1,
      default: 6,
    },
    {
      type: 'range',
      key: 'detail',
      label: { ja: '模様の細かさ', en: 'Pattern detail' },
      help: { ja: 'ガラス片の模様の細かさ (小さいと大きな模様)', en: 'How fine the glass-like pattern is (low = big shapes)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
    },
    {
      type: 'range',
      key: 'spin',
      label: { ja: '回転の速さ', en: 'Spin speed' },
      help: { ja: '万華鏡が回る速さ (拍では一瞬だけ速くなります)', en: 'How fast it turns (it briefly speeds up on each beat)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
    },
    {
      type: 'range',
      key: 'follow',
      label: { ja: '曲調の追従', en: 'Mood tracking' },
      help: { ja: '曲の激しさに合わせて色や模様が変わる速さ (小さいとゆっくり、大きいとせわしなく)', en: 'How fast the colors and patterns follow the mood of the song (low = slow, high = quick)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
    },
    {
      type: 'range',
      key: 'sparkle',
      label: { ja: 'キラキラ', en: 'Sparkle' },
      help: { ja: '小さな星のきらめきの量 (0 で出さない。高い音で増えます)', en: 'Amount of small twinkling stars (0 = off; more on high sounds)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
    },
  ],
};

export const kaleidoscopeModule: VisualizerModule = {
  manifest,
  create: () => new KaleidoscopePreset(),
};
