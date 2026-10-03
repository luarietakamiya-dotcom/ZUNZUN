import * as THREE from 'three';

/** コーンのリングの数 (中心から外へ) */
export const CONE_RINGS = 9;
/** 拍で広がる波の同時の数の上限 */
export const MAX_WAVES = 5;
/** まわりのイコライザーの棒の数 (左右対称に並べるので、見える本数は 2 倍) */
export const EQ_BARS = 40;

/**
 * スピーカーのコーンを正面から見た絵を、全画面の板 1 枚で式から描く (座標は画面の高さの半分 = 1、中心はスピーカーの中心)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる前提: 黒は透けて、光だけが乗る)。
 * u = 中心からの距離 / スピーカーの半径。
 * - ダストキャップ: 中心のドームのにじみ + 縁の輪。低音 (cap) でふくらんで明るくなる
 * - コーンのリング: 9 本。低音の動きが中心から外へ、時間差 (ringEx) をつけて伝わる (コーンが波打つ)
 * - サラウンド (縁): 太いやわらかい輪と細い輪、外枠の輪
 * - 拍の波: 外へ広がって薄れる輪 (waveR / waveA)
 * - イコライザー: 外枠のまわりに放射状の棒 (左右対称。上が低音、下が高音。eq = 棒ごとの 0..1)
 */
export function createConeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SpeakerCone',
    depthTest: false,
    depthWrite: false,
    uniforms: {
      aspect: { value: 16 / 9 },
      center: { value: new THREE.Vector2(0, 0) },
      radius: { value: 0.5 },
      cap: { value: 0 },
      ringEx: { value: new Float32Array(CONE_RINGS) },
      waveR: { value: new Float32Array(MAX_WAVES) },
      waveA: { value: new Float32Array(MAX_WAVES) },
      eq: { value: new Float32Array(EQ_BARS) },
      eqAmount: { value: 0.8 },
      fill: { value: 1 },
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
      #define RINGS ${CONE_RINGS}
      #define WAVES ${MAX_WAVES}
      #define BARS ${EQ_BARS}
      uniform float aspect;
      uniform vec2 center;
      uniform float radius;
      uniform float cap;
      uniform float ringEx[RINGS];
      uniform float waveR[WAVES];
      uniform float waveA[WAVES];
      uniform float eq[BARS];
      uniform float eqAmount;
      uniform float fill;
      uniform float intensity;
      uniform vec3 colA;
      uniform vec3 colB;
      uniform vec3 colCap;
      varying vec2 vUv;

      float line(float d, float w) {
        float x = d / w;
        return exp(-x * x);
      }

      void main() {
        vec2 p = vec2((vUv.x - 0.5) * 2.0 * aspect, (vUv.y - 0.5) * 2.0) - center;
        float u = length(p) / radius;
        vec3 col = vec3(0.0);

        // ダストキャップ: 中心のドームと、縁の輪 (低音でふくらむ)
        col += colCap * exp(-u * u * (16.0 - 6.0 * cap)) * (0.5 + 0.9 * cap);
        col += colA * line(u - 0.19 * (1.0 + 0.12 * cap), 0.012) * (0.8 + 0.8 * cap);

        // コーンのリング: 中心から外へ、時間差をつけて動く
        for (int k = 0; k < RINGS; k++) {
          float fk = float(k) / float(RINGS - 1);
          float e = ringEx[k];
          float uu = (0.27 + 0.52 * fk) * (1.0 + 0.07 * e * (0.5 + fk));
          float w = 0.008 + 0.004 * fk;
          col += mix(colA, colB, fk * 0.6) * line(u - uu, w) * (0.38 + 0.9 * e);
        }

        // サラウンド (縁) と外枠
        col += colA * (line(u - 0.93, 0.05) * (0.18 + 0.35 * cap) + line(u - 0.93, 0.010) * (0.5 + 0.6 * cap) + line(u - 1.03, 0.008) * 0.5);
        col += colB * line(u - 1.14, 0.006) * 0.5;

        // コーンの面のごくうすい明るさ (下の絵に光が当たったように)
        float d = (u - 0.55) / 0.38;
        col += colA * exp(-d * d) * 0.05 * (0.4 + cap) * fill;

        // 拍で広がる波
        for (int i = 0; i < WAVES; i++) {
          float a = waveA[i];
          if (a > 0.001) col += mix(colA, colB, 0.5) * line(u - waveR[i], 0.018 + 0.02 * waveR[i]) * a;
        }

        // イコライザー: 外枠のまわりの放射状の棒 (左右対称、上が低音)
        float ang = atan(p.x, p.y);
        float t = abs(ang) / 3.14159265;
        float s = t * float(BARS);
        int si = int(min(floor(s), float(BARS - 1)));
        float f = fract(s);
        float seg = smoothstep(0.08, 0.2, f) * (1.0 - smoothstep(0.8, 0.92, f));
        float v = eq[si];
        float len = 0.04 + 0.62 * v;
        float inner = 1.24;
        float inside = step(inner, u) * step(u, inner + len);
        float fall = 1.0 - (u - inner) / max(len, 0.001) * 0.5;
        col += mix(colA, colB, t) * inside * seg * fall * (0.5 + 0.8 * v) * eqAmount;

        gl_FragColor = vec4(col * intensity, 1.0);
      }
    `,
  });
}
