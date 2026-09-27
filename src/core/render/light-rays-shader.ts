import * as THREE from 'three';

/**
 * スクリーン空間の簡易ライトレイ (God Rays) シェーダー。
 * GPU Gems 3 "Volumetric Light Scattering" のスクリーンスペース近似 (radial blur) を単純化したもの。
 * 画面上のライト位置 (lightPosition, 0..1 のスクリーン座標) から放射状に前フレーム画像をぼかして重ねる。
 * three.js の ShaderPass にそのまま渡せる形 (uniforms/vertexShader/fragmentShader) で定義している。
 */
export const lightRaysShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    lightPosition: { value: new THREE.Vector2(0.5, 0.15) },
    exposure: { value: 0.35 },
    decay: { value: 0.96 },
    density: { value: 0.8 },
    weight: { value: 0.4 },
    samples: { value: 48 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 lightPosition;
    uniform float exposure;
    uniform float decay;
    uniform float density;
    uniform float weight;
    uniform int samples;
    varying vec2 vUv;

    const int MAX_SAMPLES = 96;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 deltaUv = (vUv - lightPosition) * density / float(samples);
      vec2 uv = vUv;
      float illumination = 1.0;
      vec3 rays = vec3(0.0);
      for (int i = 0; i < MAX_SAMPLES; i++) {
        if (i >= samples) break;
        uv -= deltaUv;
        vec3 s = texture2D(tDiffuse, uv).rgb;
        rays += s * illumination * weight;
        illumination *= decay;
      }
      vec3 color = base.rgb + rays * exposure;
      gl_FragColor = vec4(color, base.a);
    }
  `,
};
