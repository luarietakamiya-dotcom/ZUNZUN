import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { CyberSpacePreset } from './preset';
import { SCENES } from './scenes';

const range = (key: string, ja: string, en: string, helpJa: string, helpEn: string, d: number) =>
  ({ type: 'range', key, label: { ja, en }, help: { ja: helpJa, en: helpEn }, min: 0, max: 1, step: 0.01, default: d }) as const;

export const manifest: VisualizerManifest = {
  id: 'cyber-space',
  name: 'サイバー空間 (Cyber Space)',
  thumbnail: '',
  version: 1,
  defaults: {},
  // ネオンを音で 1 より明るくした所がにじむように。絵そのものの明るい所はあまりにじませない
  post: { bloomStrength: 0.9, bloomRadius: 0.45, bloomThreshold: 0.8 },
  controls: [
    {
      type: 'select',
      key: 'scene',
      label: { ja: '空間', en: 'Scene' },
      help: { ja: 'どの絵を光らせるか', en: 'Which picture to light up' },
      options: SCENES.map((s) => ({ value: s.id, label: s.name })),
      default: SCENES[0]!.id,
    },
    range('neon', 'ネオンの光り方', 'Neon glow', '上げるほど、ネオンの所 (明るくて色の濃い所) が音量で強く光ります', 'Higher makes the neon parts (bright, vivid colors) glow harder with the volume', 0.8),
    range('rings', '拍の光の波', 'Beat waves', '拍ごとに、奥から光の輪が広がります', 'A ring of light spreads from the far end on every beat', 0.7),
    range('zoom', '低音で寄る', 'Bass zoom', '低音で奥へぐっと寄って、放射状にぶれます', 'The bass pushes the view toward the far end with a radial blur', 0.6),
    range('warp', '光の線 (ワープ)', 'Warp lines', '奥から手前へ飛んでくる光の線の数 (音量で速く明るく)', 'How many light lines fly out from the far end (faster and brighter with the volume)', 0.6),
    range('rgbSplit', '色ずれ', 'Color split', '赤と青が外と内へずれます (低音で大きく)', 'Red and blue shift apart toward the edges (more with the bass)', 0.4),
    range('colorShift', '色の移り変わり', 'Color cycle', '上げるほど、ネオンの色がゆっくり移り変わります (0 で絵のまま)', 'Higher slowly cycles the neon colors (0 keeps the original colors)', 0),
  ],
};

export const cyberSpaceModule: VisualizerModule = {
  manifest,
  create: () => new CyberSpacePreset(),
};
