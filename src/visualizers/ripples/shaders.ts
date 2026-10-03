import * as THREE from 'three';

/** 同時に広がる波紋の数の上限 */
export const MAX_RIPPLES = 14;

/**
 * 水面の波紋を、全画面の板 1 枚のシェーダーで式から描く (座標は画面の高さの半分 = 1、中心は画面の真ん中)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる前提: 黒は透けて、光だけが絵に乗る)。
 * 波紋 1 つ = 中心 pos・いまの半径 rad・明るさ amp・大きさ scl。
 * - 先頭 (半径のところ) がいちばん明るい細い輪。その後ろに、水の波のように何本かの輪が続いて薄れる
 *   (前は短く、後ろは長く伸びる非対称の包み)。広がるほど後ろの輪は間延びする
 * - 何本もの波紋は足し算なので、重なると干渉したように明るく / 複雑になる
 * 色は半径が大きい (古い) ほど colB へ。
 */
export function createRippleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'Ripples',
    depthTest: false,
    depthWrite: false,
    uniforms: {
      aspect: { value: 16 / 9 },
      pos: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector2()) },
      rad: { value: new Float32Array(MAX_RIPPLES) },
      amp: { value: new Float32Array(MAX_RIPPLES) },
      scl: { value: new Float32Array(MAX_RIPPLES).fill(1) },
      freq: { value: 40 },
      intensity: { value: 1 },
      colA: { value: new THREE.Color() },
      colB: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #define N ${MAX_RIPPLES}
      uniform float aspect;
      uniform vec2 pos[N];
      uniform float rad[N];
      uniform float amp[N];
      uniform float scl[N];
      uniform float freq;
      uniform float intensity;
      uniform vec3 colA;
      uniform vec3 colB;
      varying vec2 vUv;

      void main() {
        vec2 p = vec2((vUv.x - 0.5) * 2.0 * aspect, (vUv.y - 0.5) * 2.0);
        vec3 col = vec3(0.0);
        for (int i = 0; i < N; i++) {
          float a = amp[i];
          if (a < 0.002) continue;
          float R = rad[i];
          float s = scl[i];
          float d = length(p - pos[i]);
          float x = d - R; // 先頭からの距離 (負 = 後ろ)
          // 前は短く、後ろは長く伸びる包み。広がるほど後ろは間延びする
          float w = (0.04 + 0.06 * s + 0.03 * R) * (x < 0.0 ? 1.5 : 0.5);
          float env = exp(-(x / w) * (x / w));
          float crest = 0.5 + 0.5 * cos(x * freq / s);
          float front = exp(-(x / (0.012 * s + 0.004)) * (x / (0.012 * s + 0.004)));
          float b = (pow(crest, 4.0) * env * 0.5 + front * 0.75) * a;
          col += mix(colA, colB, clamp(R / 2.6, 0.0, 1.0)) * b;
        }
        gl_FragColor = vec4(col * intensity, 1.0);
      }
    `,
  });
}
