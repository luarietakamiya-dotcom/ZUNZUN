import * as THREE from 'three';

/** 縁を左右対称に並べるときの、片側の棒の数 (見える本数は 2 倍) */
export const EDGE_BARS = 48;
/** 拍で縁を走る光の同時の数の上限 */
export const MAX_PULSES = 3;

/**
 * 画面の縁のイコライザーを、全画面の板 1 枚で式から描く (座標は画面の高さの半分 = 1、横は ±aspect)。
 * 黒い背景に光だけを描く (背景の絵に「スクリーン」で重ねる前提)。
 * - 縁を 1 周する位置 s (下の真ん中 = 0 から右回り) から、左右対称の位置 m を作る
 *   (m = 0 が下の真ん中 = 低音、m = 1 が上の真ん中 = 高音)。その位置の棒の強さ lv が、縁から内側へ伸びる長さになる
 * - 棒の細かい区切り (LED 風) は seg で切り替え。棒の先に、ゆっくり落ちるピーク線 (pk)
 * - 拍で縁を走る光 (pulseM / pulseA): 下の真ん中から、左右へ、上の真ん中へ向かって走る
 * - どの辺を使うかは edges (下・右・上・左の順に 0 / 1)
 * 注意: GLSL の予約語 (half・input・output・sample・filter など) や関数名 (main) を変数名にしない。
 */
export function createEdgeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'EdgeEqualizer',
    depthTest: false,
    depthWrite: false,
    uniforms: {
      aspect: { value: 16 / 9 },
      lv: { value: new Float32Array(EDGE_BARS) },
      pk: { value: new Float32Array(EDGE_BARS) },
      pulseM: { value: new Float32Array(MAX_PULSES) },
      pulseA: { value: new Float32Array(MAX_PULSES) },
      edges: { value: new THREE.Vector4(1, 1, 1, 1) },
      barLen: { value: 0.5 },
      led: { value: 0 },
      peakAmount: { value: 1 },
      frame: { value: 0 },
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
      #define BARS ${EDGE_BARS}
      #define PULSES ${MAX_PULSES}
      uniform float aspect;
      uniform float lv[BARS];
      uniform float pk[BARS];
      uniform float pulseM[PULSES];
      uniform float pulseA[PULSES];
      uniform vec4 edges;
      uniform float barLen;
      uniform float led;
      uniform float peakAmount;
      uniform float frame;
      uniform float intensity;
      uniform vec3 colA;
      uniform vec3 colB;
      uniform vec3 colPeak;
      varying vec2 vUv;

      void main() {
        float W = aspect;
        float H = 1.0;
        vec2 p = vec2((vUv.x - 0.5) * 2.0 * W, (vUv.y - 0.5) * 2.0);
        // いちばん近い辺 (0 = 下、1 = 右、2 = 上、3 = 左) と、縁からの深さ d
        float db = p.y + H;
        float dr = W - p.x;
        float dt = H - p.y;
        float dl = p.x + W;
        float d = db;
        int edge = 0;
        if (dr < d) { d = dr; edge = 1; }
        if (dt < d) { d = dt; edge = 2; }
        if (dl < d) { d = dl; edge = 3; }
        float use = edge == 0 ? edges.x : edge == 1 ? edges.y : edge == 2 ? edges.z : edges.w;
        if (use < 0.5) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        // 縁を 1 周する位置 s (下の真ん中 = 0 から右回り)
        float perim = 4.0 * (W + H);
        float s;
        if (edge == 0) s = p.x >= 0.0 ? p.x : perim + p.x;
        else if (edge == 1) s = W + (p.y + H);
        else if (edge == 2) s = W + 2.0 * H + (W - p.x);
        else s = W + 2.0 * H + 2.0 * W + (H - p.y);
        float t = s / perim;
        float m = min(t, 1.0 - t) * 2.0; // 0 = 下の真ん中 (低音)、1 = 上の真ん中 (高音)

        float f0 = m * float(BARS);
        int bi = int(min(floor(f0), float(BARS - 1)));
        float f = fract(f0);
        float seg = smoothstep(0.1, 0.22, f) * (1.0 - smoothstep(0.78, 0.9, f));
        float level = lv[bi];
        float len = barLen * (0.03 + 0.97 * level);
        vec3 bar = mix(colA, colB, m);
        vec3 col = vec3(0.0);

        // 棒 (縁から内側へ)。LED 風なら、深さ方向に区切る
        float inside = step(d, len);
        float ledSeg = mix(1.0, smoothstep(0.1, 0.25, fract(d / 0.03)) * (1.0 - smoothstep(0.75, 0.9, fract(d / 0.03))), led);
        float tip = 0.55 + 0.6 * smoothstep(0.0, 1.0, d / max(len, 0.001));
        col += bar * inside * seg * ledSeg * tip * (0.25 + 0.45 * level);

        // ピーク線 (棒の先でゆっくり落ちる細い線)
        float pkLen = barLen * (0.03 + 0.97 * pk[bi]);
        col += colPeak * exp(-pow((d - pkLen) / 0.007, 2.0)) * seg * peakAmount * step(0.02, pk[bi]);

        // 縁の細い線 (低音でほんのり明るい)
        col += mix(colA, colB, m) * exp(-pow(d / 0.006, 2.0)) * frame;

        // 拍で縁を走る光
        for (int i = 0; i < PULSES; i++) {
          float a = pulseA[i];
          if (a > 0.001) {
            float dm = abs(m - pulseM[i]);
            col += mix(colA, colB, pulseM[i]) * exp(-pow(dm / 0.05, 2.0)) * exp(-pow(d / 0.03, 2.0)) * a;
          }
        }
        gl_FragColor = vec4(col * intensity, 1.0);
      }
    `,
  });
}
