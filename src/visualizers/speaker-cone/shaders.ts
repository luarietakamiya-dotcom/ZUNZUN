import * as THREE from 'three';

/** コーンのリングの数 (中心から外へ) */
export const CONE_RINGS = 9;
/** 拍で広がる波の同時の数の上限 */
export const MAX_BURSTS = 4;
/** 1 回の拍で、縁から放射状に飛び出す粒の数 */
export const BURST_SPOKES = 48;
/** まわりのイコライザーの棒の数 (左右対称に並べるので、見える本数は 2 倍) */
export const EQ_BARS = 40;
/** 粒が消えるまでの時間の目安 (秒。小さくなる速さに使う) */
const BURST_LIFE_S = '2.4';

/**
 * スピーカーのコーンを正面から見た絵を、全画面の板 1 枚で式から描く (座標は画面の高さの半分 = 1、中心はスピーカーの中心)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる前提: 黒は透けて、光だけが乗る)。
 * u = 中心からの距離 / スピーカーの半径。
 * - ダストキャップ: 中心のドームのにじみ + 縁の輪。低音 (cap) でふくらんで明るくなる
 * - コーンのリング: 9 本。低音の動きが中心から外へ、時間差 (ringEx) をつけて伝わる (コーンが波打つ)
 * - サラウンド (縁): 太いやわらかい輪と細い輪、外枠の輪
 * - 拍で飛ぶ粒 (2026-10-03 ユーザー「波動で画面が見えなくなるから、円状に飛ぶ粒子がいいかな」で、画面いっぱいに広がる輪から変えた):
 *   2026-10-03 さらに「四角い小さい粒が上下左右にゆっくり回転しながら輪を作るように広がり、キラキラ光の粉を残しながら小さくなる」に変更。
 *   縁から 48 個の小さな四角が、輪になって (ほぼ同じ距離まで) 広がる。四角は 1 個ずつゆっくり回り、きらめき、小さくなりながら通ったあとに光の粉を残す。
 *   飛ぶ範囲は半径の 2.4 倍までで、画面いっぱいには広がらない (絵が見えたまま)。あわせて、縁に短く消える細い輪が出る
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

        // 拍で飛ぶ粒: 縁から 48 個の小さな四角が、ゆっくり回りながら輪になって広がる。キラキラ光り、小さくなりながら光の粉を残す
        float angAll = atan(p.x, p.y);
        for (int i = 0; i < BURSTS; i++) {
          float a = burstAmp[i];
          if (a > 0.001) {
            float age = burstAge[i];
            float sum = 0.0;
            float hh = 0.0;
            // k = 0: 粒の本体。k = 1..4: 通ったあとに残る光の粉 (小さく、うすく、少しずつ消える)
            for (int k = 0; k < 5; k++) {
              float ag = age - float(k) * 0.07;
              if (ag >= 0.0) {
                float rot = 0.45 * ag; // 輪全体がゆっくり回る
                float rel = angAll - burstPhase[i] - rot;
                float spoke = 6.2831853 / float(SPOKES);
                float jf = floor(rel / spoke + 0.5);
                float dAng = rel - jf * spoke;
                float h = hash1(mod(jf, float(SPOKES)) + burstSalt[i]);
                float rj = 1.08 + (1.1 + 0.25 * h) * (1.0 - exp(-ag * burstRate));
                vec2 dd = vec2(dAng * u, u - rj); // 粒の中心からのずれ (横, 外向き)
                float th = h * 6.2831853 + ag * (0.5 + 0.7 * h); // 四角がゆっくり回る
                float cs = cos(th);
                float sn = sin(th);
                vec2 q = abs(vec2(cs * dd.x - sn * dd.y, sn * dd.x + cs * dd.y));
                float life = clamp(ag / ${BURST_LIFE_S}, 0.0, 1.0);
                float sz = (0.03 + 0.016 * h) * (1.0 - 0.8 * life) * (k == 0 ? 1.0 : 0.45);
                float sq = 1.0 - smoothstep(0.7, 1.0, max(q.x, q.y) / sz);
                float tw = 0.55 + 0.45 * sin(ag * 16.0 + h * 40.0 + float(k) * 1.7); // きらめき
                float w = k == 0 ? 1.0 : 0.5 * exp(-float(k) * 0.45);
                sum += sq * tw * w;
                hh = h;
              }
            }
            col += mix(colA, colB, hh) * sum * a * 1.4;
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
