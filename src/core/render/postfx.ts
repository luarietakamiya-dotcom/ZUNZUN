import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { PostFxConfig } from '../types';
import { lightRaysShader } from './light-rays-shader';

export type { PostFxConfig };

export const defaultPostFxConfig = (): PostFxConfig => ({
  bloomStrength: 1.2,
  bloomRadius: 0.5,
  bloomThreshold: 0.15,
  lightRays: false,
  lightRayPosition: [0.5, 0.15],
});

/**
 * VisualizerHost が 1 つだけ持つ PostFX スタック。Bloom は three.js 公式の UnrealBloomPass、
 * Light Rays は自作の放射ブラー (light-rays-shader.ts)。プリセット切り替え時は scene/camera だけ
 * 差し替え、EffectComposer 自体は使い回す (毎回作り直すとレンダーターゲットの再確保コストがかかる)。
 */
export class PostFxStack {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly lightRaysPass: ShaderPass;
  private config: PostFxConfig = defaultPostFxConfig();

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      this.config.bloomStrength,
      this.config.bloomRadius,
      this.config.bloomThreshold,
    );
    this.composer.addPass(this.bloomPass);

    this.lightRaysPass = new ShaderPass(lightRaysShader);
    this.lightRaysPass.enabled = this.config.lightRays;
    this.composer.addPass(this.lightRaysPass);
  }

  /** プリセット切り替え時に呼ぶ。以後このシーン/カメラを描画する。 */
  setScene(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  /** プリセットごとの基準値を適用する (manifest.post があれば Host が渡す)。 */
  configure(config: Partial<PostFxConfig>): void {
    this.config = { ...this.config, ...config };
    this.bloomPass.threshold = this.config.bloomThreshold;
    this.bloomPass.radius = this.config.bloomRadius;
    this.bloomPass.strength = this.config.bloomStrength;
    this.lightRaysPass.enabled = this.config.lightRays;
    const [lx, ly] = this.config.lightRayPosition;
    (this.lightRaysPass.uniforms.lightPosition!.value as THREE.Vector2).set(lx, ly);
  }

  /** 共通パラメータ Glow (0..1) を、プリセットの基準値に掛け合わせて bloom の強さに反映する。 */
  setGlow(glow01: number): void {
    this.bloomPass.strength = this.config.bloomStrength * (0.3 + THREE.MathUtils.clamp(glow01, 0, 1) * 1.4);
  }

  resize(width: number, height: number): void {
    this.composer.setSize(Math.max(1, width), Math.max(1, height));
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
