import * as THREE from 'three';

/** コーンのリングの数 (中心から外へ) */
export const CONE_RINGS = 9;
/** 拍で広がる波の同時の数の上限 */
export const MAX_BURSTS = 4;
/** 1 回の拍で、縁から放射状に飛び出す粒の数 */
export const BURST_SPOKES = 48;
/** まわりのイコライザーの棒の数 (左右対称に並べるので、見える本数は 2 倍) */
export const EQ_BARS = 40;

/**
 * スピーカーのコーンを正面から見た絵を、全画面の板 1 枚で式から描く (座標は画面の高さの半分 = 1、中心はスピーカーの中心)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる前提: 黒は透けて、光だけが乗る)。
 * u = 中心からの距離 / スピーカーの半径。
 * - ダストキャップ: 中心のドームのにじみ + 縁の輪。低音 (cap) でふくらんで明るくなる
 * - コーンのリング: 9 本。低音の動きが中心から外へ、時間差 (ringEx) をつけて伝わる (コーンが波打つ)
 * - サラウンド (縁): 太いやわらかい輪と細い輪、外枠の輪
 * - 拍で飛ぶ粒 (2026-10-03 ユーザー「波動で画面が見えなくなるから、円状に飛ぶ粒子がいいかな」で、画面いっぱいに広がる輪から変えた):
 *   縁から放射状に 48 粒が飛び出し、彗星のような尾を引いて消える。粒ごとに飛ぶ距離が違う (形から決まる hash。乱数は使わない)。
 *   飛ぶ範囲は半径の 2.9 倍までで、画面いっぱいには広がらない (絵が見えたまま)。あわせて、縁に短く消える細い輪が出る
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
      burstAge: { value: new Float32Array(MAX_BURSTS) },
      burstAmp: { value: new Float32Array(MAX_BURSTS) },
      burstPhase: { value: new Float32Array(MAX_BURSTS) },
      burstSalt: { value: new Float32Array(MAX_BURSTS) },
      burstRate: { value: 1.8 },
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
      #define BURSTS ${MAX_BURSTS}
      #define SPOKES ${BURST_SPOKES}
      #define BARS ${EQ_BARS}
      uniform float aspect;
      uniform vec2 center;
      uniform float radius;
      uniform float cap;
      uniform float ringEx[RINGS];
      uniform float burstAge[BURSTS];
      uniform float burstAmp[BURSTS];
      uniform float burstPhase[BURSTS];
      uniform float burstSalt[BURSTS];
      uniform float burstRate;
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
      /** 同じ入力なら同じ値になる、ばらつき用の hash (乱数ではない) */
      float hash1(float n) {
        return fract(sin(n * 12.9898) * 43758.5453);
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

        // 拍で飛ぶ粒: 縁から放射状に 48 粒。粒ごとに飛ぶ距離が違い、彗星のような尾を引く
        float angAll = atan(p.x, p.y);
        float spoke = 6.2831853 / float(SPOKES);
        for (int i = 0; i < BURSTS; i++) {
          float a = burstAmp[i];
          if (a > 0.001) {
            float age = burstAge[i];
            float rel = angAll - burstPhase[i];
            float jf = floor(rel / spoke + 0.5);
            float dAng = rel - jf * spoke;
            float h = hash1(mod(jf, float(SPOKES)) + burstSalt[i]);
            float reach = 0.7 + 1.3 * h; // 飛ぶ距離 (半径の倍数。いちばん遠い粒でも半径の 2.9 倍まで)
            float rj = 1.08 + reach * (1.0 - exp(-age * burstRate));
            float arc = dAng * u; // 粒の通り道からの横のずれ
            float dr = u - rj; // 負 = 粒より内側 (尾の側)
            float size = 0.02 + 0.018 * h;
            float head = exp(-(arc / size) * (arc / size) - (dr / (size * 1.5)) * (dr / (size * 1.5)));
            float tail = dr < 0.0 ? exp(dr / 0.2) * exp(-(arc / (size * 0.7)) * (arc / (size * 0.7))) * 0.5 * smoothstep(-0.8, -0.02, dr) : 0.0;
            col += mix(colA, colB, h) * (head * 1.1 + tail) * a;
            // 縁に短く消える細い輪 (拍の合図)
            float ringR = 1.06 + 0.4 * (1.0 - exp(-age * 5.0));
            col += colA * line(u - ringR, 0.02) * a * 0.45 * exp(-age * 3.5);
          }
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
