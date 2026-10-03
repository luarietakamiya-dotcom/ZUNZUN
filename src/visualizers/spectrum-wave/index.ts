import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { SpectrumWavePreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'spectrum-wave',
  name: 'Spectrum Wave',
  thumbnail: '',
  version: 1,
  defaults: {},
  post: { bloomStrength: 0.4, bloomRadius: 0.35, bloomThreshold: 0.65 },
  controls: [
    {
      type: 'range',
      key: 'position',
      label: { ja: '位置', en: 'Position' },
      help: { ja: '波の根元の高さ (-1 で画面の下、0 で下寄りの真ん中、1 で上寄り。曲線は根元から上へ伸びます)', en: 'Height of the wave base (-1 = bottom of the screen, 1 = upper; the wave grows upward from it)' },
      min: -1,
      max: 1,
      step: 0.01,
      default: -0.3,
    },
    {
      type: 'range',
      key: 'height',
      label: { ja: '高さ', en: 'Height' },
      help: { ja: '波がいちばん伸びたときの高さ', en: 'How tall the wave can grow' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
    },
    {
      type: 'range',
      key: 'mirror',
      label: { ja: '反射', en: 'Reflection' },
      help: { ja: '根元の下に映る、うすい反射の量 (0 で出さない)', en: 'Amount of the faint reflection below the base (0 = hidden)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
    },
    {
      type: 'range',
      key: 'ribbons',
      label: { ja: '残像 (リボン)', en: 'Trails (ribbons)' },
      help: { ja: '少し遅れてついてくる 2 本の線の量 (0 で出さない)', en: 'Amount of the two lines that follow a bit behind (0 = hidden)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.8,
    },
    {
      type: 'range',
      key: 'fill',
      label: { ja: '塗り', en: 'Fill' },
      help: { ja: '波の下をうすく塗る量 (0 で線だけ)', en: 'Amount of the faint fill under the wave (0 = line only)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7,
    },
  ],
};

export const spectrumWaveModule: VisualizerModule = {
  manifest,
  create: () => new SpectrumWavePreset(),
};
