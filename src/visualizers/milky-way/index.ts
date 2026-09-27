import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { MilkyWayPreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'milky-way',
  name: 'Milky Way',
  thumbnail: '',
  version: 1,
  defaults: {},
  // 星空は暗く繊細なので、Bloom は明るい星と流れ星だけに軽くかける
  post: { bloomStrength: 0.7, bloomRadius: 0.3, bloomThreshold: 0.6 },
};

export const milkyWayModule: VisualizerModule = {
  manifest,
  create: () => new MilkyWayPreset(),
};
