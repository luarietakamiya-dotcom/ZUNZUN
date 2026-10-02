import type { VisualizerManifest } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';
import { CityScrollPreset } from './preset';
import { ALL_SCENES, SCENES } from './scenes';

export const manifest: VisualizerManifest = {
  id: 'city-scroll',
  name: '流れる街並み (City Scroll)',
  thumbnail: '',
  version: 1,
  defaults: {},
  // 絵の明るい所 (雲・空) はにじませず、きらめきと光の粒 (1 より明るい) だけがにじむように、しきい値を高めにする
  post: { bloomStrength: 0.55, bloomRadius: 0.4, bloomThreshold: 0.85 },
  controls: [
    {
      type: 'select',
      key: 'scene',
      label: { ja: '街並み', en: 'Scene' },
      help: { ja: 'どの街の絵を流すか。「全部つなげる」は 5 枚を順に流します', en: 'Which town to scroll. "All in a row" scrolls the five pictures one after another' },
      options: [...SCENES.map((s) => ({ value: s.id, label: s.name })), { value: ALL_SCENES, label: { ja: '全部つなげる', en: 'All in a row' } }],
      default: SCENES[0]!.id,
    },
    {
      type: 'select',
      key: 'direction',
      label: { ja: '流れる向き', en: 'Direction' },
      help: { ja: '景色が流れていく向き', en: 'Which way the scenery moves' },
      options: [
        { value: 'left', label: { ja: '左へ', en: 'To the left' } },
        { value: 'right', label: { ja: '右へ', en: 'To the right' } },
      ],
      default: 'left',
    },
    {
      type: 'range',
      key: 'speed',
      label: { ja: '流れる速さ', en: 'Speed' },
      help: { ja: '上げるほど速く流れます (低音で少しだけ速くなります。どれだけかは共通の「動きの量」)', en: 'Higher scrolls faster (the bass speeds it up a little; how much follows the common Motion)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
    },
    {
      type: 'range',
      key: 'blur',
      label: { ja: 'ぼかし', en: 'Blur' },
      help: { ja: '上げるほど街の絵がぼけます (歌詞を読みやすくしたいときに)。きらめきと舞うものはぼけません', en: 'Higher blurs the town picture (handy to make lyrics easier to read). Sparkles and falling things stay sharp' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
    },
    {
      type: 'range',
      key: 'sparkle',
      label: { ja: 'きらめき', en: 'Sparkle' },
      help: { ja: '窓の灯り・街灯・ネオン・水面などの明るい所が、きらきらまたたきます (高音と拍で強く)', en: 'Bright spots (windows, street lamps, neon, water) twinkle (stronger with highs and beats)' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
    },
    {
      type: 'select',
      key: 'particles',
      label: { ja: '舞うもの', en: 'Falling things' },
      help: { ja: '画面を舞うもの。「場面に合わせる」は、街並みごとに合うものを選びます', en: 'What drifts across the screen. "Match the scene" picks one that suits each town' },
      options: [
        { value: 'auto', label: { ja: '場面に合わせる', en: 'Match the scene' } },
        { value: 'petals', label: { ja: '花びら', en: 'Petals' } },
        { value: 'snow', label: { ja: '雪', en: 'Snow' } },
        { value: 'leaves', label: { ja: '木の葉', en: 'Leaves' } },
        { value: 'lights', label: { ja: '光の粒 (昇っていく)', en: 'Light motes (rising)' } },
        { value: 'confetti', label: { ja: '紙ふぶき', en: 'Confetti' } },
        { value: 'none', label: { ja: 'なし', en: 'None' } },
      ],
      default: 'auto',
    },
    {
      type: 'range',
      key: 'particleAmount',
      label: { ja: '舞うものの量', en: 'Amount' },
      help: { ja: '舞うものの数', en: 'How many things drift across the screen' },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
    },
  ],
};

export const cityScrollModule: VisualizerModule = {
  manifest,
  create: () => new CityScrollPreset(),
};
