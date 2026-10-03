import * as THREE from 'three';

/** 列と帯域の対応に使う、強さの配列の長さ (列の数は 24 / 32 / 48 のどれでも、この 48 個から選ぶ) */
export const LED_BANDS = 48;

/**
 * LED のドット格子のメーターを、全画面の板 1 枚で式から描く (座標は画面の高さの半分 = 1、横は ±aspect)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる前提)。
 * - 丸い LED が、cols 列 × (画面の高さに収まる数) 行。列ごとに強さ lv の分だけ下 (または中央から上下) から点灯する
 * - 点灯していない LED は、うっすら光る (dim。低音で少し強くなる)。ピークの LED は 1 つだけ明るく残る (pk)
 * - 色は、下から「緑 → 黄 → 赤」(クラシック) か、テーマの 2 色のグラデーション
 * 注意: GLSL の予約語 (half・input・output・sample・filter など) や関数名 (main) を変数名にしない。
 */
export function createLedMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'LedMatrix',
    depthTest: false,
    depthWrite: false,
    uniforms: {
      aspect: { value: 16 / 9 },
      cols: { value: 32 },
      lv: { value: new Float32Array(LED_BANDS) },
      pk: { value: new Float32Array(LED_BANDS) },
      heightFrac: { value: 0.7 },
      centered: { value: 0 },
      classic: { value: 1 },
      dotSize: { value: 0.8 },
      dim: { value: 0.12 },
      boost: { value: 1 },
      intensity: { value: 1 },
      colA: { value: new THREE.Color() },
      colB: { value: new THREE.Color() },
      colPeak: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #define BANDS ${LED_BANDS}
      uniform float aspect;
      uniform float cols;
      uniform float lv[BANDS];
      uniform float pk[BANDS];
      uniform float heightFrac;
      uniform float centered;
      uniform float classic;
      uniform float dotSize;
      uniform float dim;
      uniform float boost;
      uniform float intensity;
      uniform vec3 colA;
      uniform vec3 colB;
      uniform vec3 colPeak;
      varying vec2 vUv;

      void main() {
        vec2 p = vec2((vUv.x - 0.5) * 2.0 * aspect, (vUv.y - 0.5) * 2.0);
        float cell = 2.0 * aspect / cols;
        // 行の数: 画面の高さの heightFrac に収まる数 (中央から上下に広げるときは、片側の数)
        float span = centered > 0.5 ? heightFrac : 2.0 * heightFrac;
        float rowsMax = max(1.0, floor(span / cell));
        float ci = floor((p.x + aspect) / cell);
        float fx = fract((p.x + aspect) / cell) - 0.5;
        float yRel = centered > 0.5 ? abs(p.y) : p.y + 1.0;
        float cj = floor(yRel / cell);
        float fy = fract(yRel / cell) - 0.5;
        if (cj >= rowsMax || ci < 0.0 || ci >= cols) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        int bi = int(min(floor((ci + 0.5) / cols * float(BANDS)), float(BANDS - 1)));
        float level = lv[bi];
        float lit = clamp(level * rowsMax - cj, 0.0, 1.0);
        float frac = (cj + 0.5) / rowsMax;
        vec3 base;
        if (classic > 0.5) {
          vec3 green = vec3(0.15, 1.0, 0.25);
          vec3 yellow = vec3(1.0, 0.85, 0.12);
          vec3 red = vec3(1.0, 0.15, 0.1);
          base = frac < 0.65 ? mix(green, yellow, smoothstep(0.45, 0.65, frac)) : mix(yellow, red, smoothstep(0.65, 0.9, frac));
        } else {
          base = mix(colA, colB, frac);
        }
        // 丸い LED
        float d = length(vec2(fx, fy));
        float r = 0.5 * dotSize;
        float shape = 1.0 - smoothstep(r - 0.12, r, d);
        // にじみは、格子の枠 (±0.5) のところで切れて四角い影にならないよう、枠の手前でなめらかに消す
        float win = 1.0 - smoothstep(0.3, 0.5, max(abs(fx), abs(fy)));
        float glow = exp(-pow(d / (r * 1.6), 2.0)) * 0.25 * win;
        vec3 col = base * (shape + glow) * (dim + lit * (1.0 - dim) * boost) * 0.65;
        // ピークの LED (1 つだけ明るく残る)
        float pkRow = floor(pk[bi] * rowsMax - 1e-4);
        if (pk[bi] > 0.02 && abs(cj - pkRow) < 0.5) col += colPeak * (shape + glow) * 0.5;
        gl_FragColor = vec4(col * intensity, 1.0);
      }
    `,
  });
}
