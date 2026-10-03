import * as THREE from 'three';

/** 曲線を作る帯域の点の数 (間はなめらかにつなぐ) */
export const WAVE_POINTS = 48;
/** 拍で曲線の上を走る光の同時の数の上限 */
export const MAX_SPOTS = 3;

/**
 * スペクトルのなめらかな光の曲線を、全画面の板 1 枚で式から描く (座標は画面の高さの半分 = 1、横は ±aspect)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる前提)。
 * - 曲線は 3 本 (速い・少し遅い・遅い)。遅い線ほど、前の音の形が残る (リボンのような残像)。点と点の間はなめらかにつなぐ
 * - 曲線の下はうすく塗り (うすい色の面)、基準線の下には、うすい反射 (離れるほど薄れる)
 * - 拍で曲線の上を走る光 (spotX / spotA。左から右へ)
 * 注意: GLSL の予約語 (half・input・output・sample・filter など) や関数名 (main) を変数名にしない。
 */
export function createWaveMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SpectrumWave',
    depthTest: false,
    depthWrite: false,
    uniforms: {
      aspect: { value: 16 / 9 },
      fast: { value: new Float32Array(WAVE_POINTS) },
      mid: { value: new Float32Array(WAVE_POINTS) },
      slow: { value: new Float32Array(WAVE_POINTS) },
      spotX: { value: new Float32Array(MAX_SPOTS) },
      spotA: { value: new Float32Array(MAX_SPOTS) },
      baseY: { value: -0.6 },
      height: { value: 0.9 },
      mirror: { value: 0.6 },
      ribbons: { value: 1 },
      fillAmount: { value: 0.7 },
      intensity: { value: 1 },
      colA: { value: new THREE.Color() },
      colB: { value: new THREE.Color() },
      colC: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #define POINTS ${WAVE_POINTS}
      #define SPOTS ${MAX_SPOTS}
      uniform float aspect;
      uniform float fast[POINTS];
      uniform float mid[POINTS];
      uniform float slow[POINTS];
      uniform float spotX[SPOTS];
      uniform float spotA[SPOTS];
      uniform float baseY;
      uniform float height;
      uniform float mirror;
      uniform float ribbons;
      uniform float fillAmount;
      uniform float intensity;
      uniform vec3 colA;
      uniform vec3 colB;
      uniform vec3 colC;
      varying vec2 vUv;

      /** 点の並びを、なめらかにつないだ値 (x は 0..1) */
      float level(float arr[POINTS], float x) {
        float f = clamp(x, 0.0, 1.0) * float(POINTS - 1);
        int i0 = int(floor(f));
        int i1 = int(min(float(i0 + 1), float(POINTS - 1)));
        float t = fract(f);
        t = t * t * (3.0 - 2.0 * t);
        return mix(arr[i0], arr[i1], t);
      }

      void main() {
        vec2 p = vec2((vUv.x - 0.5) * 2.0 * aspect, (vUv.y - 0.5) * 2.0);
        float x01 = (p.x + aspect) / (2.0 * aspect);
        float dx = 0.004;
        vec3 col = vec3(0.0);
        // 基準線の上は曲線、下は反射 (反射は基準線で折り返した位置で曲線を見る)
        float below = p.y < baseY ? 1.0 : 0.0;
        float py = below > 0.5 ? baseY + (baseY - p.y) : p.y;
        float refl = below > 0.5 ? mirror * exp(-(baseY - p.y) * 2.2) : 1.0;

        for (int k = 0; k < 3; k++) {
          float lv0 = k == 0 ? level(fast, x01) : k == 1 ? level(mid, x01) : level(slow, x01);
          float lv1 = k == 0 ? level(fast, x01 + dx) : k == 1 ? level(mid, x01 + dx) : level(slow, x01 + dx);
          float yc = baseY + height * lv0;
          float yn = baseY + height * lv1;
          float slope = (yn - yc) / (dx * 2.0 * aspect);
          float dist = abs(py - yc) / sqrt(1.0 + slope * slope);
          float w = k == 0 ? 0.008 : 0.006;
          float gain = k == 0 ? 1.0 : (k == 1 ? 0.55 : 0.32) * ribbons;
          vec3 c = k == 0 ? colA : (k == 1 ? colB : colC);
          col += c * exp(-(dist / w) * (dist / w)) * gain * refl;
          // 曲線のまわりのやわらかいにじみ
          col += c * exp(-(dist / 0.04) * (dist / 0.04)) * 0.12 * gain * refl;
          // 曲線の下のうすい塗り (主な線だけ)
          if (k == 0 && py < yc && py > baseY) {
            float depth = (yc - py) / max(yc - baseY, 0.001);
            col += mix(colB, colA, 1.0 - depth) * (0.16 * (1.0 - depth) + 0.03) * fillAmount * refl;
          }
        }

        // 拍で曲線の上を走る光
        float yMain = baseY + height * level(fast, x01);
        float dMain = abs(py - yMain);
        for (int i = 0; i < SPOTS; i++) {
          float a = spotA[i];
          if (a > 0.001) {
            float dxs = (x01 - spotX[i]) * aspect;
            col += mix(colA, colC, 0.5) * exp(-(dxs / 0.09) * (dxs / 0.09)) * exp(-(dMain / 0.05) * (dMain / 0.05)) * a * refl;
          }
        }
        gl_FragColor = vec4(col * intensity, 1.0);
      }
    `,
  });
}
