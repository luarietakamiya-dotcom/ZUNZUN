import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { LiveStagePreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'live-stage',
  name: 'Live Stage',
  thumbnail: '',
  version: 1,
  defaults: {},
  // 光の筋は加算で重なるので、Bloom はレンズとレーザー (HDR) だけが拾うようにしきい値を高めにする
  post: { bloomStrength: 0.8, bloomRadius: 0.28, bloomThreshold: 0.6 },
};

export const liveStageModule: VisualizerModule = {
  manifest,
  create: () => new LiveStagePreset(),
};
