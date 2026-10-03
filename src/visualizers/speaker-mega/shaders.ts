import * as THREE from 'three';

/** 虹色のコーンのリングの数 */
export const MEGA_RINGS = 11;
/** 拍で広がる衝撃波の同時の数の上限 */
export const MEGA_WAVES = 6;
/** まわりのイコライザーの棒の数 (左右対称に並べるので、見える本数は 2 倍) */
export const MEGA_BARS = 48;
/** 回転する光の筋の本数 */
export const MEGA_RAYS = 24;

/**
 * めちゃくちゃ派手なスピーカーを、全画面の板 1 枚で式から描く (座標は画面の高さの半分 = 1、中心はスピーカーの中心)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる前提)。u = 中心からの距離 / スピーカーの半径。
 * - 虹色のコーンのリング (11 本。低音の動きが中心から外へ時間差で伝わる。色は hue から外へ向かって虹色に流れる)
 * - 中心の大きなドーム (低音でふくらむ) と、縁の輪、外へにじむハロー
 * - 回転する光の筋 (24 本。縁から外へ伸び、長さは低音で変わる。回る向きと速さは JS が決める rot)
 * - 拍の衝撃波 (R・G・B の輪が少しずつずれて広がる)
 * - まわりのイコライザー (48 本、左右対称。虹色)
 * - 拍の星の閃光 (十字の細い光。star)
 * 光が重なって真っ白にならないよう、最後にやわらかく頭打ちにする (色が残る)。
 * 注意: GLSL の予約語 (half・input・output・sample・filter など) や関数名 (main) を変数名にしない。
 */
export function createMegaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SpeakerMega',
    depthTest: false,
    depthWrite: false,
    uniforms: {
      aspect: { value: 16 / 9 },
      center: { value: new THREE.Vector2(0, 0) },
      radius: { value: 0.42 },
      cap: { value: 0 },
      halo: { value: 0 },
      star: { value: 0 },
      rot: { value: 0 },
      hue: { value: 0 },
      rayLen: { value: 1 },
      rayAmount: { value: 0.8 },
      eqAmount: { value: 0.9 },
      ringEx: { value: new Float32Array(MEGA_RINGS) },
      waveR: { value: new Float32Array(MEGA_WAVES) },
      waveA: { value: new Float32Array(MEGA_WAVES) },
      eq: { value: new Float32Array(MEGA_BARS) },
      intensity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #define RINGS ${MEGA_RINGS}
      #define WAVES ${MEGA_WAVES}
      #define BARS ${MEGA_BARS}
      #define RAYS ${MEGA_RAYS}
      #define PI 3.14159265
      uniform float aspect;
      uniform vec2 center;
      uniform float radius;
      uniform float cap;
      uniform float halo;
      uniform float star;
      uniform float rot;
      uniform float hue;
      uniform float rayLen;
      uniform float rayAmount;
      uniform float eqAmount;
      uniform float ringEx[RINGS];
      uniform float waveR[WAVES];
      uniform float waveA[WAVES];
      uniform float eq[BARS];
      uniform float intensity;
      varying vec2 vUv;

      float line(float d, float w) {
        float x = d / w;
        return exp(-x * x);
      }
      vec3 hsv(float h, float s, float v) {
        vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
        return v * mix(vec3(1.0), k, s);
      }

      void main() {
        vec2 p = vec2((vUv.x - 0.5) * 2.0 * aspect, (vUv.y - 0.5) * 2.0) - center;
        float r = length(p);
        float u = r / radius;
        vec3 col = vec3(0.0);

        // ハロー (外へにじむ光)
        col += hsv(hue + 0.05, 0.7, 1.0) * exp(-pow((u - 0.95) / 0.55, 2.0)) * (0.05 + 0.12 * halo);

        // 中心のドームと縁の輪
        col += hsv(hue + 0.55, 0.45, 1.0) * exp(-u * u * (11.0 - 5.0 * cap)) * (0.5 + 1.0 * cap);
        col += hsv(hue, 0.6, 1.0) * line(u - 0.2 * (1.0 + 0.15 * cap), 0.014) * (0.8 + 0.9 * cap);

        // 虹色のコーンのリング
        for (int k = 0; k < RINGS; k++) {
          float fk = float(k) / float(RINGS - 1);
          float e = ringEx[k];
          float uu = (0.27 + 0.56 * fk) * (1.0 + 0.08 * e * (0.5 + fk));
          col += hsv(hue + fk * 0.6, 0.78, 1.0) * line(u - uu, 0.009 + 0.004 * fk) * (0.4 + 1.0 * e);
        }
        // サラウンド (縁)
        col += hsv(hue + 0.7, 0.7, 1.0) * (line(u - 0.95, 0.05) * (0.18 + 0.4 * cap) + line(u - 0.95, 0.011) * (0.55 + 0.7 * cap));

        // 回転する光の筋 (縁から外へ)
        float a = atan(p.x, p.y) - rot;
        float sector = 2.0 * PI / float(RAYS);
        float si = floor(a / sector + 0.5);
        float ph = a - si * sector;
        float beam = exp(-pow(abs(ph) * u / 0.045, 2.0));
        float fall = (1.0 - smoothstep(1.0, 1.0 + rayLen, u)) * smoothstep(0.98, 1.2, u);
        col += hsv(hue + si * 0.043, 0.8, 1.0) * beam * fall * rayAmount * 0.6;

        // 拍の衝撃波 (R・G・B の輪が少しずつずれる)
        for (int i = 0; i < WAVES; i++) {
          float wa = waveA[i];
          if (wa > 0.001) {
            float w = 0.025 + 0.02 * waveR[i];
            col += vec3(line(u - waveR[i], w), line(u - waveR[i] * 0.965, w), line(u - waveR[i] * 0.93, w)) * wa;
          }
        }

        // まわりのイコライザー (虹色、左右対称)
        float ang = atan(p.x, p.y);
        float t = abs(ang) / PI;
        float s = t * float(BARS);
        int bi = int(min(floor(s), float(BARS - 1)));
        float f = fract(s);
        float seg = smoothstep(0.08, 0.2, f) * (1.0 - smoothstep(0.8, 0.92, f));
        float v = eq[bi];
        float len = 0.05 + 0.62 * v;
        float inner = 1.2;
        float inside = step(inner, u) * step(u, inner + len);
        float tail = 1.0 - (u - inner) / max(len, 0.001) * 0.5;
        col += hsv(hue + t * 0.8, 0.8, 1.0) * inside * seg * tail * (0.3 + 0.6 * v) * eqAmount;

        // 拍の星の閃光 (十字の細い光)
        if (star > 0.02) {
          float cr = cos(rot * 0.5);
          float sr = sin(rot * 0.5);
          vec2 q = vec2(cr * p.x - sr * p.y, sr * p.x + cr * p.y) / radius;
          float arm = exp(-abs(q.x) * 40.0) * exp(-abs(q.y) * (2.4 - 1.4 * star)) + exp(-abs(q.y) * 40.0) * exp(-abs(q.x) * (2.4 - 1.4 * star));
          col += hsv(hue + 0.1, 0.25, 1.0) * arm * star * 0.6;
        }

        // 重なって真っ白にならないよう、やわらかく頭打ち (色が残る)
        col *= intensity;
        col = col / (1.0 + 0.9 * col);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
