import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { SpeakerConePreset } from './preset';

export const manifest: VisualizerManifest = {
  id: 'speaker-cone',
  name: 'Speaker Cone',
  thumbnail: '',
  version: 1,
  defaults: {},
  // 細い線の光なので、しきい値は中くらい (背景の絵に重ねたとき、線のまわりだけがほんのりにじむ)
  post: { bloomStrength: 0.45, bloomRadius: 0.35, bloomThreshold: 0.6 },
  controls: [
    {
      type: 'range',
      key: 'size',
      label: { ja: '大きさ', en: 'Size' },
      help: { ja: 'スピーカーの大きさ (1 で画面の高さのおよそ半分)', en: 'Size of the speaker (1 = about half the screen height)' },
      min: 0.4,
      max: 1.6,
      step: 0.01,
      default: 1,
    },
    {
      type: 'range',
      key: 'offsetX',
      label: { ja: '左右の位置', en: 'Horizontal position' },
      help: { ja: '-1 で左端、0 で真ん中、1 で右端 (画面からはみ出さない範囲で)', en: '-1 = left edge, 0 = center, 1 = right edge (kept inside the screen)' },
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
    },
    {
      type: 'range',
      key: 'offsetY',
      label: { ja: '上下の位置', en: 'Vertical position' },
      help: { ja: '-1 で下端、0 で真ん中、1 で上端 (画面からはみ出さない範囲で)', en: '-1 = bottom edge, 0 = center, 1 = top edge (kept inside the screen)' },
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
    },
    {
      type: 'range',
      key: 'overflow',
      label: { ja: 'はみ出し', en: 'Overflow' },
      help: {
        ja: 'スピーカーを画面の外まで動かせる範囲 (0 で画面の中だけ、1 でほとんど外に出して一部だけ使えます。位置のスライダーを端まで動かして使います)',
        en: 'How far the speaker can move off-screen (0 = stays inside, 1 = mostly outside so only part of it shows; use with the position sliders)',
      },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
    },
    {
      type: 'range',
      key: 'equalizer',
      label: { ja: 'まわりの棒 (イコライザー)', en: 'Surrounding bars (equalizer)' },
      help: { ja: 'スピーカーのまわりに並ぶ、音の高さごとの棒の量 (0 で出さない)', en: 'Amount of the bars around the speaker, one per pitch range (0 = hidden)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.8,
    },
    {
      type: 'range',
      key: 'waves',
      // キーは 'waves' のまま (以前の「拍で広がる波」を保存したプロジェクトの値を、そのまま使うため)
      label: { ja: '拍で飛ぶ粒', en: 'Beat particles' },
      help: { ja: '拍ごとに、縁から放射状に飛び出す粒の量 (0 で出さない。画面いっぱいには広がらず、絵が隠れません)', en: 'Amount of particles shooting outward from the rim on each beat (0 = hidden). They stay near the speaker, so the picture is not covered' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7,
    },
  ],
};

export const speakerConeModule: VisualizerModule = {
  manifest,
  create: () => new SpeakerConePreset(),
};
