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
      key: 'framing',
      label: { ja: '見せ方', en: 'Framing' },
      help: { ja: '全体を見せるか、真ん中の機材ラックに寄るか', en: 'Show everything, or move in on the gear rack in the middle' },
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
