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
  controls: [
    {
      type: 'range',
      key: 'towardCrowd',
      label: { ja: '光を客席へ向ける', en: 'Lights toward the crowd' },
      help: {
        ja: '上げるほど、ライトが客席 (カメラ) の方へ振れて光が手前へ飛んできます。カメラを向いた瞬間はライトが強く光り、画面が一瞬少し明るくなります (多くても 1 秒に 1 回ほど)',
        en: 'Higher swings the lights toward the crowd (camera) so the light comes at you. When a light faces the camera it flares and the screen briefly brightens a little (at most about once per second)',
      },
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
    },
    {
      type: 'select',
      key: 'stageSet',
      label: { ja: 'ステージの機材', en: 'Stage set' },
      help: {
        ja: '照明のほかに、ステージの機材 (トラス・幕・ドラムの台など) を置きます。「なし」は照明だけ',
        en: 'Adds stage gear besides the lights (truss, drapes, drum riser, …). "None" shows the lights only',
      },
      options: [
        { value: 'none', label: { ja: 'なし (照明だけ)', en: 'None (lights only)' } },
        { value: 'band', label: { ja: 'バンド', en: 'Band' } },
      ],
      default: 'none',
    },
    {
      type: 'select',
      key: 'cameraSpot',
      label: { ja: 'カメラの場所', en: 'Camera position' },
      help: { ja: 'どこからステージを見るか', en: 'Where the stage is seen from' },
      options: [
        { value: 'back', label: { ja: '客席の後ろ', en: 'Back of the crowd' } },
        { value: 'front', label: { ja: '最前列 (見上げる)', en: 'Front row (looking up)' } },
        { value: 'side', label: { ja: '真横', en: 'Side' } },
        { value: 'top', label: { ja: '上から見下ろす', en: 'From above' } },
        { value: 'stage', label: { ja: 'ステージの奥から客席側を見る', en: 'From the stage toward the crowd' } },
      ],
      default: 'back',
    },
    {
      type: 'range',
      key: 'cameraHeight',
      label: { ja: 'カメラの高さ', en: 'Camera height' },
      help: { ja: 'マイナス = 低く、プラス = 高く', en: 'Negative = lower, positive = higher' },
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
    },
    {
      type: 'range',
      key: 'cameraDistance',
      label: { ja: 'カメラの距離', en: 'Camera distance' },
      help: { ja: '1 より小さい = 近づく、大きい = 離れる', en: 'Below 1 = closer, above 1 = farther' },
      min: 0.5,
      max: 2,
      step: 0.01,
      default: 1,
    },
    {
      type: 'range',
      key: 'cameraYaw',
      label: { ja: 'カメラの向き (左右)', en: 'Camera angle (left / right)' },
      help: { ja: 'ステージのまわりを左右に回り込みます', en: 'Orbits around the stage to the left or right' },
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
    },
  ],
};

export const liveStageModule: VisualizerModule = {
  manifest,
  create: () => new LiveStagePreset(),
};
