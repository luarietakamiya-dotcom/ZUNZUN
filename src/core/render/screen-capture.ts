import * as THREE from 'three';
import type { VisualizerBlend } from '../types';

/**
 * 画面に描いたビジュアライザーを写し取り、あとで好きな順番・重ね方で描き直すためのもの (レイヤーの順番を組み替えたとき用)。
 * 写し取るのは画面に出ている値そのもの (色の変換をしない) なので、描き直すと元の見た目と同じになる。
 * (ビジュアライザーを画面の外に描くと、PostFX の最後の Bloom の色の扱いが画面へ描くときと変わるため、画面へ描いてから写す。
 *  core/render/background.ts の説明も参照)
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform float opacity;
/** 1 = 濃さを透明度に使う ('over')、0 = 色に掛ける ('screen' / 'add') */
uniform float useAlpha;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(map, vUv).rgb;
  gl_FragColor = useAlpha > 0.5 ? vec4(c, opacity) : vec4(c * opacity, 1.0);
}
`;

export class ScreenCapture {
  private texture: THREE.FramebufferTexture | null = null;
  private readonly size = new THREE.Vector2();
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { map: { value: null }, opacity: { value: 1 }, useAlpha: { value: 0 } },
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  private readonly mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    this.mesh.frustumCulled = false;
  }

  /** いま画面に描いてある絵を写し取る */
  capture(renderer: THREE.WebGLRenderer): void {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x));
    const h = Math.max(1, Math.floor(this.size.y));
    if (!this.texture || this.texture.image.width !== w || this.texture.image.height !== h) {
      this.texture?.dispose();
      this.texture = new THREE.FramebufferTexture(w, h);
      this.texture.colorSpace = THREE.NoColorSpace;
      this.material.uniforms.map!.value = this.texture;
    }
    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(this.texture);
  }

  /** 写し取った絵を、画面に描いてある絵の上に重ねる */
  draw(renderer: THREE.WebGLRenderer, blend: VisualizerBlend, opacity: number): void {
    if (!this.texture) return;
    const m = this.material;
    m.uniforms.opacity!.value = Math.max(0, Math.min(1, opacity));
    m.uniforms.useAlpha!.value = blend === 'over' ? 1 : 0;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    // 画面の透明度 (alpha) は 1 のまま触らない。'over' で透明度まで混ぜると画面の alpha が 1 未満になり、
    // ブラウザが canvas を画像にするときに色を alpha で割ってしまい、明るく写った (実際に 1.3 倍になった)
    m.blendSrcAlpha = THREE.ZeroFactor;
    m.blendDstAlpha = THREE.OneFactor;
    if (blend === 'over') {
      m.blendSrc = THREE.SrcAlphaFactor;
      m.blendDst = THREE.OneMinusSrcAlphaFactor;
    } else {
      m.blendSrc = THREE.OneFactor;
      // screen: src + dst × (1 − src)。add: src + dst
      m.blendDst = blend === 'screen' ? THREE.OneMinusSrcColorFactor : THREE.OneFactor;
    }
    renderer.setRenderTarget(null);
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.mesh, this.camera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.texture?.dispose();
    this.texture = null;
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
