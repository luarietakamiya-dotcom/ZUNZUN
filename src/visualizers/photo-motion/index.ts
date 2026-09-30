import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { PHOTOS } from './photos';
import { PhotoMotionPreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'photo-motion',
  name: '写真に動き (Photo Motion)',
  thumbnail: '',
  version: 1,
  defaults: {},
  // 写真の明るい所を音で 1 より明るくした所だけがにじむように、しきい値を高めにする
  post: { bloomStrength: 0.6, bloomRadius: 0.35, bloomThreshold: 0.82 },
  controls: [
    {
      type: 'select',
      key: 'photo',
      label: { ja: '写真', en: 'Photo' },
      help: { ja: 'どの写真に動きを付けるか', en: 'Which photo to bring to life' },
      options: PHOTOS.map((p) => ({ value: p.id, label: p.name })),
      default: PHOTOS[0]!.id,
    },
    {
      type: 'range',
      key: 'pump',
      label: { ja: 'スピーカーの震え', en: 'Speaker pump' },
      help: { ja: '上げるほど、低音でスピーカーのコーンが大きくふくらみます', en: 'Higher makes the speaker cones swell more with the bass' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7,
    },
    {
      type: 'range',
      key: 'glowAmount',
      label: { ja: '光の強さ', en: 'Glow' },
      help: {
        ja: '上げるほど、メーター・LED・照明などの明るい所が音に合わせて強く光ります (暗い所はそのまま)',
        en: 'Higher makes the bright parts (meters, LEDs, lights) glow more with the music (dark parts stay as they are)',
      },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7,
    },
  ],
};

export const photoMotionModule: VisualizerModule = {
  manifest,
  create: () => new PhotoMotionPreset(),
};
