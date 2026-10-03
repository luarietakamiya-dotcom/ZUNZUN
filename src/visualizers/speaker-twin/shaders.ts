import * as THREE from 'three';

/** ウーファーのコーンのリングの数 */
export const WOOFER_RINGS = 7;
/** キャビネットの足元のイコライザーの棒の数 (1 台ぶん) */
export const STRIP_BARS = 16;
/** 拍で広がる波の同時の数の上限 */
export const MAX_BURSTS = 4;
/** 1 回の拍で、縁から放射状に飛び出す粒の数 */
export const BURST_SPOKES = 48;
/** 粒が消えるまでの時間の目安 (秒。小さくなる速さに使う) */
const BURST_LIFE_S = '3.2';

/**
 * 2 台のスピーカー (キャビネット) を正面から見た絵を、全画面の板 1 枚で式から描く (座標は画面の高さの半分 = 1)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる前提)。
 * 1 台の中 (q = 中心からの位置 / 半径 R):
 * - ウーファー (q = (0, -0.3)、半径 1): ダストキャップ・7 本のコーンのリング (低音の動きが中心から外へ時間差で伝わる)・縁
 * - ツイーター (q = (0, 1.45)、半径 0.38): 小さなドームと輪。高音で光る
 * - キャビネットの輪郭 (角の丸い四角)
 * - 足元のイコライザー (16 本の棒。左の台は低〜中域、右の台は中〜高域の帯域)
 * 拍で飛ぶ粒 (2026-10-03 ユーザー「波動がちょっとださい」で作り直し、さらに「波動で画面が見えなくなる」で、広がる輪から変えた):
 * 強く鳴った側のウーファーの縁から放射状に 48 粒が飛び出し、彗星のような尾を引いて消える。反対側のスピーカーの方を向いた粒は
 * 遠くまで飛んで、反対側のキャビネットの手前まで届く。届くと、そのキャビネットの輪郭とウーファーの縁が光る (rimL / rimR。左右の掛け合い)。
 * 粒は小さいので、背景の絵が隠れない。色は鳴った側の色 (左 = colA、右 = colB)。
 * 注意: GLSL の予約語 (half など) や関数名 (main) を変数名にしない (コンパイルが失敗して、描画が真っ黒になる)。
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
      rimL: { value: 0 },
      rimR: { value: 0 },
      exL: { value: new Float32Array(WOOFER_RINGS) },
      exR: { value: new Float32Array(WOOFER_RINGS) },
      stripL: { value: new Float32Array(STRIP_BARS) },
      stripR: { value: new Float32Array(STRIP_BARS) },
      burstC: { value: Array.from({ length: MAX_BURSTS }, () => new THREE.Vector2()) },
      burstAge: { value: new Float32Array(MAX_BURSTS) },
      burstAmp: { value: new Float32Array(MAX_BURSTS) },
      burstPhase: { value: new Float32Array(MAX_BURSTS) },
      burstSalt: { value: new Float32Array(MAX_BURSTS) },
      burstDir: { value: new Float32Array(MAX_BURSTS) },
      burstReach: { value: new Float32Array(MAX_BURSTS) },
      burstRate: { value: 1.5 },
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
      #define BURSTS ${MAX_BURSTS}
      #define SPOKES ${BURST_SPOKES}
      uniform float aspect;
      uniform vec2 cL;
      uniform vec2 cR;
      uniform float radius;
      uniform float capL;
      uniform float capR;
      uniform float twL;
      uniform float twR;
      uniform float rimL;
      uniform float rimR;
      uniform float exL[RINGS];
      uniform float exR[RINGS];
      uniform float stripL[BARS];
      uniform float stripR[BARS];
      uniform vec2 burstC[BURSTS];
      uniform float burstAge[BURSTS];
      uniform float burstAmp[BURSTS];
      uniform float burstPhase[BURSTS];
      uniform float burstSalt[BURSTS];
      uniform float burstDir[BURSTS];
      uniform float burstReach[BURSTS];
      uniform float burstRate;
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
      /** 同じ入力なら同じ値になる、ばらつき用の hash (乱数ではない) */
      float hash1(float n) {
        return fract(sin(n * 12.9898) * 43758.5453);
      }

      /** 角の丸い四角の、縁までの距離 (正 = 外) */
      float roundBox(vec2 q, vec2 hs, float r) {
        vec2 d = abs(q) - hs + r;
        return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
      }

      /** 1 台ぶん。p = 画面の位置、c = 中心、cap = ウーファーの動き、tw = ツイーターの強さ、mc / sc = 主な色と副の色 */
      vec3 speaker(vec2 p, vec2 c, float cap, float tw, float rim, float ex[RINGS], float strip[BARS], vec3 mc, vec3 sc) {
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
        col += mc * (line(u - 0.9, 0.05) * (0.15 + 0.3 * cap) + line(u - 0.9, 0.012) * (0.45 + 0.5 * cap)) * (1.0 + 0.8 * rim);

        // ツイーター (中心 (0, 1.45)、半径 0.38)
        vec2 t = q - vec2(0.0, 1.45);
        float v = length(t) / 0.38;
        col += colCap * exp(-v * v * 7.0) * (0.25 + 0.9 * tw);
        col += sc * line(v - 0.55, 0.08) * (0.35 + 0.8 * tw) + sc * line(v - 1.0, 0.06) * (0.4 + 0.5 * tw);

        // キャビネットの輪郭
        float box = roundBox(q - vec2(0.0, 0.1), vec2(1.28, 1.95), 0.28);
        col += sc * line(box, 0.02) * (0.5 + 1.1 * rim);

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
        col += speaker(p, cL, capL, twL, rimL, exL, stripL, colA, colB);
        col += speaker(p, cR, capR, twR, rimR, exR, stripR, colB, colA);

        // 拍で飛ぶ粒 (強く鳴った側のウーファーの縁から、48 個の小さな四角が、ゆっくり回りながら輪になって広がる。
        // キラキラ光り、小さくなりながら光の粉を残す。反対側のスピーカーに向かう粒だけは遠くまで飛ぶ)
        float spoke = 6.2831853 / float(SPOKES);
        for (int i = 0; i < BURSTS; i++) {
          float a = burstAmp[i];
          if (a > 0.001) {
            vec2 q = p - burstC[i];
            float u = length(q) / radius;
            float ang = atan(q.x, q.y);
            float age = burstAge[i];
            float sum = 0.0;
            float hh = 0.0;
            // k = 0: 粒の本体。k = 1..4: 通ったあとに残る光の粉 (小さく、うすく、少しずつ消える)
            for (int k = 0; k < 5; k++) {
              float ag = age - float(k) * 0.07;
              if (ag >= 0.0) {
                float rel = ang - burstPhase[i] - 0.45 * ag; // 輪全体がゆっくり回る
                float jf = floor(rel / spoke + 0.5);
                float dAng = rel - jf * spoke;
                float spokeAng = ang - dAng; // この粒の通り道の向き
                float h = hash1(mod(jf, float(SPOKES)) + burstSalt[i]);
                // 反対側のスピーカーの方を向いた粒ほど、遠くまで飛ぶ (向きの近さを 4 乗で絞る)
                float facing = max(0.0, cos(spokeAng - burstDir[i] * 1.5707963));
                float f4 = facing * facing;
                f4 = f4 * f4;
                float reach = mix(1.1 + 0.25 * h, burstReach[i] * (0.55 + 0.45 * h), f4);
                float rj = 1.08 + reach * (1.0 - exp(-ag * burstRate));
                vec2 dd = vec2(dAng * u, u - rj); // 粒の中心からのずれ (横, 外向き)
                float th = h * 6.2831853 + ag * (0.5 + 0.7 * h); // 四角がゆっくり回る
                float cs = cos(th);
                float sn = sin(th);
                vec2 qq = abs(vec2(cs * dd.x - sn * dd.y, sn * dd.x + cs * dd.y));
                float life = clamp(ag / ${BURST_LIFE_S}, 0.0, 1.0);
                float sz = (0.03 + 0.016 * h) * (1.0 - 0.8 * life) * (k == 0 ? 1.0 : 0.45);
                float sq = 1.0 - smoothstep(0.7, 1.0, max(qq.x, qq.y) / sz);
                float tw = 0.55 + 0.45 * sin(ag * 16.0 + h * 40.0 + float(k) * 1.7); // きらめき
                float w = k == 0 ? 1.0 : 0.5 * exp(-float(k) * 0.45);
                sum += sq * tw * w;
                hh = h;
              }
            }
            vec3 tint = burstC[i].x < 0.0 ? colA : colB;
            col += mix(tint, colCap, 0.25 * hh) * sum * a * 1.4;
            // 縁に短く消える細い輪 (拍の合図)
            float ringR = 1.06 + 0.4 * (1.0 - exp(-age * 5.0));
            col += tint * line(u - ringR, 0.02) * a * 0.45 * exp(-age * 3.5);
          }
        }
        gl_FragColor = vec4(col * intensity, 1.0);
      }
    `,
  });
}
