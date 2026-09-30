import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { SpeakerRackPreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'speaker-rack',
  name: 'Speaker Rack',
  thumbnail: '',
  version: 1,
  defaults: {},
  // LED・真空管・足もとの帯だけが 1 を超えて光るので、しきい値を高めにして金属の照り返しはにじませない
  post: { bloomStrength: 0.7, bloomRadius: 0.3, bloomThreshold: 0.72 },
  controls: [
    {
      type: 'select',
      key: 'layout',
      label: { ja: '並び', en: 'Layout' },
      help: {
        ja: '「ラックとスピーカー」は大きなスピーカー 2 台と真ん中の機材。「スピーカーの通路」は奥へ続く通路の両側にスピーカーを積み上げ、低音の波が奥へ伝わります',
        en: '"Rack and speakers": two big speakers with gear in the middle. "Speaker alley": speakers stacked along a corridor, with the bass rippling away into the distance',
      },
      options: [
        { value: 'rack', label: { ja: 'ラックとスピーカー', en: 'Rack and speakers' } },
        { value: 'alley', label: { ja: 'スピーカーの通路', en: 'Speaker alley' } },
      ],
      default: 'rack',
    },
    {
      type: 'select',
      key: 'framing',
      label: { ja: '見せ方', en: 'Framing' },
      help: { ja: '全体を見せるか、真ん中の機材ラックに寄るか (「ラックとスピーカー」のとき)', en: 'Show everything, or move in on the gear rack in the middle (for "Rack and speakers")' },
      options: [
        { value: 'full', label: { ja: '全体', en: 'Everything' } },
        { value: 'closeup', label: { ja: 'ラックのアップ', en: 'Rack close-up' } },
      ],
      default: 'full',
    },
  ],
};

export const speakerRackModule: VisualizerModule = {
  manifest,
  create: () => new SpeakerRackPreset(),
};
