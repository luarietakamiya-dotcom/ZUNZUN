import * as THREE from 'three';
import type { AudioFrame, CommonParams, VisualizerManifest, VisualizerPreset } from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';

/**
 * 「なし」— 何も描かないビジュアライザー (2026-10-03 ユーザー「ビジュアライザーは最初は何もつけないのがデフォルトにしよう」)。
 * 新しいプロジェクトの既定。背景・素材・歌詞だけの映像にしたいときにも使う。
 * manifest.empty により、Host は「ビジュアライザー」の層を描かない (背景などがそのまま見える)。
 */
class NonePreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  init(): void {}
  update(_frame: AudioFrame, _params: CommonParams & Record<string, unknown>): void {}
  resize(): void {}
  dispose(): void {
    this.scene.clear();
  }
}

export const manifest: VisualizerManifest = {
  id: 'none',
  name: 'なし / None',
  thumbnail: '',
  version: 1,
  defaults: {},
  empty: true,
};

export const noneModule: VisualizerModule = {
  manifest,
  create: () => new NonePreset(),
};
