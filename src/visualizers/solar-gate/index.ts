import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { SolarGatePreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'solar-gate',
  name: 'Solar Gate',
  thumbnail: '',
  version: 1,
  defaults: {},
  // 円環・光線・光柱は HDR (成分 > 1) で描くので、しきい値を高めにして本当に明るい部分だけをにじませる
  // (低いしきい値 + 広い半径だと、空や床まで茶色くかすむことを実際の描画で確認した)
  post: { bloomStrength: 0.45, bloomRadius: 0.3, bloomThreshold: 0.8 },
};

export const solarGateModule: VisualizerModule = {
  manifest,
  create: () => new SolarGatePreset(),
};
