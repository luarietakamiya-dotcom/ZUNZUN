import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { RipplesPreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'ripples',
  name: 'Ripples',
  thumbnail: '',
  version: 1,
  defaults: {},
  // 細い線の光なので、しきい値は中くらい (背景の絵に重ねたとき、輪のまわりがほんのりにじむ)
  post: { bloomStrength: 0.4, bloomRadius: 0.35, bloomThreshold: 0.6 },
  controls: [
    {
      type: 'range',
      key: 'speed',
      label: { ja: '広がる速さ', en: 'Spread speed' },
      help: { ja: '波紋が外へ広がる速さ', en: 'How fast the ripples spread outward' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
    },
    {
      type: 'range',
      key: 'amount',
      label: { ja: '波紋の量', en: 'Amount' },
      help: { ja: '上げるほど、小さな音にも波紋が出て、明るくなります', en: 'Higher makes ripples appear for quieter sounds and brighter' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
    },
    {
      type: 'range',
      key: 'size',
      label: { ja: '波紋の大きさ', en: 'Ripple size' },
      help: { ja: '波の輪の太さと、広がる大きさ', en: 'Thickness of the wave rings and how far they spread' },
      min: 0.5,
      max: 1.5,
      step: 0.01,
      default: 1,
    },
  ],
};

export const ripplesModule: VisualizerModule = {
  manifest,
  create: () => new RipplesPreset(),
};
