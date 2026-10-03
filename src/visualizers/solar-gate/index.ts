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
  // リングの中に画像を入れられる (2026-10-03 ユーザー「専用作ろう！」)。入れなければ真っ暗
  imageSlot: {
    label: { ja: 'リングの中の画像', en: 'Image inside the ring' },
    help: {
      ja: 'リングの中に丸く切り抜いて表示します (画面いっぱいに合わせて、はみ出しは切ります)。入れなければ真っ暗です。',
      en: 'Shown cropped to a circle inside the ring (fills the circle; the overflow is cut). Without one, the inside stays black.',
    },
  },
  controls: [
    {
      type: 'range',
      key: 'imageBrightness',
      label: { ja: '画像の明るさ', en: 'Image brightness' },
      help: { ja: 'リングの中の画像の明るさ (0 で真っ暗)', en: 'Brightness of the image inside the ring (0 = black)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.85,
    },
    {
      type: 'range',
      key: 'imageBeat',
      label: { ja: '音で光る強さ', en: 'Pulse with the music' },
      help: { ja: '拍に合わせて画像が少し明るくなる量 (0 で動かない。強くしすぎない作りです)', en: 'How much the image brightens on the beat (0 = steady; kept gentle by design)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.4,
    },
  ],
};

export const solarGateModule: VisualizerModule = {
  manifest,
  create: () => new SolarGatePreset(),
};
