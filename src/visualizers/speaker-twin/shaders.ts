import * as THREE from 'three';

/** ウーファーのコーンのリングの数 */
export const WOOFER_RINGS = 7;
/** キャビネットの足元のイコライザーの棒の数 (1 台ぶん) */
export const STRIP_BARS = 16;
/** 拍で広がる波の同時の数の上限 */
export const MAX_WAVES = 5;

/**
 * 2 台のスピーカー (キャビネット) を正面から見た絵を、全画面の板 1 枚で式から描く (座標は画面の高さの半分 = 1)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる前提)。
 * 1 台の中 (q = 中心からの位置 / 半径 R):
 * - ウーファー (q = (0, -0.3)、半径 1): ダストキャップ・7 本のコーンのリング (低音の動きが中心から外へ時間差で伝わる)・縁
 * - ツイーター (q = (0, 1.45)、半径 0.38): 小さなドームと輪。高音で光る
 * - キャビネットの輪郭 (角の丸い四角)
 * - 足元のイコライザー (16 本の棒。左の台は低〜中域、右の台は中〜高域の帯域)
 * 拍の波は、強く鳴った側のウーファーから広がる。
 */
export function createTwinMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SpeakerTwin',
    depthTest: false,
    depthWrite: false,
    uniforms: {
      aspect: { value: 16 / 9 },
      cL: { value: new THREE.Vector2(-0.6, 0) },
      cR: { value: new THREE.Vector2(0.6, 0) },
      radius: { value: 0.34 },
      capL: { value: 0 },
      capR: { value: 0 },
      twL: { value: 0 },
      twR: { value: 0 },
      exL: { value: new Float32Array(WOOFER_RINGS) },
      exR: { value: new Float32Array(WOOFER_RINGS) },
      stripL: { value: new Float32Array(STRIP_BARS) },
      stripR: { value: new Float32Array(STRIP_BARS) },
      waveC: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector2()) },
      waveR: { value: new Float32Array(MAX_WAVES) },
      waveA: { value: new Float32Array(MAX_WAVES) },
      stripAmount: { value: 0.8 },
      intensity: { value: 1 },
      colA: { value: new THREE.Color() },
      colB: { value: new THREE.Color() },
      colCap: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #define RINGS ${WOOFER_RINGS}
      #define BARS ${STRIP_BARS}
      #define WAVES ${MAX_WAVES}
      uniform float aspect;
      uniform vec2 cL;
      uniform vec2 cR;
      uniform float radius;
      uniform float capL;
      uniform float capR;
      uniform float twL;
      uniform float twR;
      uniform float exL[RINGS];
      uniform float exR[RINGS];
      uniform float stripL[BARS];
      uniform float stripR[BARS];
      uniform vec2 waveC[WAVES];
      uniform float waveR[WAVES];
      uniform float waveA[WAVES];
      uniform float stripAmount;
      uniform float intensity;
      uniform vec3 colA;
      uniform vec3 colB;
      uniform vec3 colCap;
      varying vec2 vUv;

      float line(float d, float w) {
        float x = d / w;
        return exp(-x * x);
      }

      /** 角の丸い四角の、縁までの距離 (正 = 外) */
      float roundBox(vec2 q, vec2 hs, float r) {
        vec2 d = abs(q) - hs + r;
        return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
      }

      /** 1 台ぶん。p = 画面の位置、c = 中心、cap = ウーファーの動き、tw = ツイーターの強さ */
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #define RINGS ${WOOFER_RINGS}
      #define BARS ${STRIP_BARS}
      #define WAVES ${MAX_WAVES}
      uniform float aspect;
      uniform vec2 cL;
      uniform vec2 cR;
      uniform float radius;
      uniform float capL;
      uniform float capR;
      uniform float twL;
      uniform float twR;
      uniform float exL[RINGS];
      uniform float exR[RINGS];
      uniform float stripL[BARS];
      uniform float stripR[BARS];
      uniform vec2 waveC[WAVES];
      uniform float waveR[WAVES];
      uniform float waveA[WAVES];
      uniform float stripAmount;
      uniform float intensity;
      uniform vec3 colA;
      uniform vec3 colB;
      uniform vec3 colCap;
      varying vec2 vUv;

      float line(float d, float w) {
        float x = d / w;
        return exp(-x * x);
      }

      /** 角の丸い四角の、縁までの距離 (正 = 外) */
      float roundBox(vec2 q, vec2 hs, float r) {
        vec2 d = abs(q) - hs + r;
        return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
      }

      /** 1 台ぶん。p = 画面の位置、c = 中心、cap = ウーファーの動き、tw = ツイーターの強さ */
      vec3 speaker(vec2 p, vec2 c, float cap, float tw, float ex[RINGS], float strip[BARS], vec3 mc, vec3 sc) {
        vec2 q = (p - c) / radius;
        vec3 col = vec3(0.0);

        // ウーファー (中心 (0, -0.3))
        vec2 w = q - vec2(0.0, -0.3);
        float u = length(w);
        col += colCap * exp(-u * u * (16.0 - 6.0 * cap)) * (0.45 + 0.8 * cap);
        col += mc * line(u - 0.19 * (1.0 + 0.12 * cap), 0.014) * (0.7 + 0.7 * cap);
        for (int k = 0; k < RINGS; k++) {
          float fk = float(k) / float(RINGS - 1);
          float e = ex[k];
          float uu = (0.3 + 0.48 * fk) * (1.0 + 0.07 * e * (0.5 + fk));
          col += mix(mc, sc, fk * 0.5) * line(u - uu, 0.011 + 0.004 * fk) * (0.34 + 0.85 * e);
        }
        col += mc * (line(u - 0.9, 0.05) * (0.15 + 0.3 * cap) + line(u - 0.9, 0.012) * (0.45 + 0.5 * cap));

        // ツイーター (中心 (0, 1.45)、半径 0.38)
        vec2 t = q - vec2(0.0, 1.45);
        float v = length(t) / 0.38;
        col += colCap * exp(-v * v * 7.0) * (0.25 + 0.9 * tw);
        col += sc * line(v - 0.55, 0.08) * (0.35 + 0.8 * tw) + sc * line(v - 1.0, 0.06) * (0.4 + 0.5 * tw);

        // キャビネットの輪郭
        float box = roundBox(q - vec2(0.0, 0.1), vec2(1.28, 1.95), 0.28);
        col += sc * line(box, 0.02) * 0.5;

        // 足元のイコライザー (16 本)
        vec2 s = q - vec2(0.0, -2.35);
        if (abs(s.x) < 1.25) {
          float f = (s.x + 1.25) / 2.5 * float(BARS);
          int bi = int(min(floor(f), float(BARS - 1)));
          float fr = fract(f);
          float seg = smoothstep(0.1, 0.22, fr) * (1.0 - smoothstep(0.78, 0.9, fr));
          float h = 0.08 + 0.5 * strip[bi];
          float inside = step(0.0, s.y + 0.1) * step(s.y, h - 0.1);
          col += mix(mc, sc, float(bi) / float(BARS - 1)) * inside * seg * (0.45 + 0.7 * strip[bi]) * stripAmount;
        }
        return col;
      }

      void main() {
        vec2 p = vec2((vUv.x - 0.5) * 2.0 * aspect, (vUv.y - 0.5) * 2.0);
        vec3 col = vec3(0.0);
        col += speaker(p, cL, capL, twL, exL, stripL, colA, colB);
        col += speaker(p, cR, capR, twR, exR, stripR, colB, colA);

        // 拍の波 (強く鳴った側のウーファーから)
        for (int i = 0; i < WAVES; i++) {
          float a = waveA[i];
          if (a > 0.001) {
            float d = length(p - waveC[i]) / radius;
            col += mix(colA, colB, 0.5) * line(d - waveR[i], 0.05 + 0.03 * waveR[i]) * a;
          }
        }
        gl_FragColor = vec4(col * intensity, 1.0);
      }
    `,
  });
}
