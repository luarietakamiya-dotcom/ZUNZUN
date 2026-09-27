import * as THREE from 'three';
import type {
  AudioFrame,
  CommonParams,
  VisualizerInitContext,
  VisualizerManifest,
  VisualizerPreset,
} from '../../core/types';
import type { VisualizerModule } from '../../core/visualizer/registry';

const BAND_COUNT = 64;

/**
 * デバッグ用プリセット: AudioEngine が出す 64 帯域をそのまま棒グラフにする。
 * Solar Gate 等の本物のプリセットを作る前に、Registry/Host/AudioEngine の配線が
 * 正しく繋がっているかを目視で確認するためのもの。Visualizer パネルには常に表示される。
 */
class DebugBarsPreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  private mesh!: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private t = 0;

  init(_ctx: VisualizerInitContext): void {
    this.scene.background = new THREE.Color(0x05060a);
    this.camera.position.set(0, 3, 9);
    this.camera.lookAt(0, 0, 0);

    const geo = new THREE.BoxGeometry(0.14, 1, 0.14);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, BAND_COUNT);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BAND_COUNT * 3), 3);
    for (let i = 0; i < BAND_COUNT; i++) {
      this.setBar(i, 0.02);
    }
    this.scene.add(this.mesh);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1));
  }

  update(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void {
    this.t += frame.dt > 0 ? frame.dt : 1 / 60;
    for (let i = 0; i < BAND_COUNT; i++) {
      const raw = frame.bands[i] ?? 0;
      const h = Math.max(0.02, raw * params.sensitivity * params.intensity * 6);
      this.setBar(i, h, raw, frame.beat, params.glow);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    const orbit = params.cameraMotion * 0.35;
    this.camera.position.x = Math.sin(this.t * 0.15) * 9 * orbit;
    this.camera.position.z = 9 - Math.abs(Math.sin(this.t * 0.15)) * 2 * orbit;
    this.camera.lookAt(0, 1, 0);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.scene.clear();
  }

  private setBar(i: number, height: number, raw = 0, beat = 0, glow = 0.5): void {
    const x = (i - BAND_COUNT / 2 + 0.5) * 0.16;
    this.dummy.position.set(x, height / 2, 0);
    this.dummy.scale.set(1, height, 1);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
    const hue = 0.58 + 0.15 * (i / BAND_COUNT) - 0.08 * beat;
    this.color.setHSL(hue, 0.75, 0.32 + 0.35 * raw * glow);
    this.mesh.setColorAt(i, this.color);
  }
}

export const manifest: VisualizerManifest = {
  id: '_debug-bars',
  name: 'Debug: Band Bars',
  thumbnail: '',
  version: 1,
  defaults: {},
};

export const debugBarsModule: VisualizerModule = {
  manifest,
  create: () => new DebugBarsPreset(),
};
