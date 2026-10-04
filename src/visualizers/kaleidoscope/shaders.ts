import * as THREE from 'three';

/** 半径方向に並べる、スペクトルの帯の数 (中心 = 低音 → 外 = 高音) */
export const KALEIDO_BANDS = 16;

/**
 * 万華鏡を、全画面の板 1 枚で式から描く (座標は画面の高さの半分 = 1、中心は画面の中心)。
 * 1. 角度を 1 枚の扇形 (360° / 枚数) に折りたたむ (鏡写し)。鏡の継ぎ目はなめらかにつながる
 * 2. 折りたたんだ座標をゆるくゆがめて (warp)、ガラス片のような細胞 (輪とにじみ) を並べる
 * 3. 半径ごとに、スペクトルの帯の強さで明るさを変える (中心が低音、外が高音)
 * 曲調 (mood): 静かな曲は大きく太くやわらかい模様、激しい曲は細かくくっきりした筋の多い模様に、ゆっくり移り変わる。
 *   色は preset.ts が曲調に合わせて 2 つの配色の間を混ぜる。音の明るさ (tone) で 2 色の混ざり方が偏る
 * 4. 中心に宝石のような光 (低音でふくらむ)。端はなだらかに暗くする
 * 最後に明るさをやわらかく丸める (広い面積が白く飛ばないように)。
 */
export function createKaleidoscopeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'Kaleidoscope',
    depthTest: false,
    depthWrite: false,
    uniforms: {
      aspect: { value: 16 / 9 },
      t: { value: 0 },
      rot: { value: 0 },
      zoom: { value: 1 },
      warp: { value: 0.5 },
      seg: { value: 6 },
      detail: { value: 1 },
      mood: { value: 0 },
      tone: { value: 0.5 },
      bass: { value: 0 },
      high: { value: 0 },
      bandLevel: { value: new Float32Array(KALEIDO_BANDS) },
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
      #define NB ${KALEIDO_BANDS}
      uniform float aspect;
      uniform float t;
      uniform float rot;
      uniform float zoom;
      uniform float warp;
      uniform float seg;
      uniform float detail;
      uniform float mood; // 曲調: 0 = 静か・おだやか、1 = 激しい・にぎやか (ゆっくり変わる)
      uniform float tone; // 音の明るさ (0 = 低い音が中心、1 = 高い音が中心。ゆっくり変わる)
      uniform float bass;
      uniform float high;
      uniform float bandLevel[NB];
      uniform float intensity;
      uniform vec3 colA;
      uniform vec3 colB;
      uniform vec3 colC;
      varying vec2 vUv;

      /** 半径 r (0..1.4) に対応する帯の強さ (隣の帯となめらかにつなぐ) */
      float levelAt(float r) {
        float x = clamp(r / 1.4, 0.0, 1.0) * float(NB - 1);
        int i = int(floor(x));
        float f = fract(x);
        return mix(bandLevel[i], bandLevel[min(i + 1, NB - 1)], f);
      }

      void main() {
        vec2 p = vec2((vUv.x - 0.5) * 2.0 * aspect, (vUv.y - 0.5) * 2.0) / zoom;
        float r = length(p);
        // 鏡: 角度を 1 枚の扇形に折りたたむ
        float a = atan(p.y, p.x) + rot;
        float s = 6.2831853 / seg;
        a = mod(a, s);
        a = abs(a - 0.5 * s);
        // 静かな曲は大きくゆったりした模様、激しい曲は細かい模様
        vec2 q = r * vec2(cos(a), sin(a)) * detail * (0.75 + 0.55 * mood);
        // ゆるくゆがめる
        vec2 w = q;
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          w += warp * 0.28 * vec2(sin(w.y * 2.7 + t * 0.31 + fi * 1.9), cos(w.x * 2.3 - t * 0.27 + fi * 2.7));
        }
        // ガラス片の細胞: 輪とにじみ、細い筋
        vec2 g = fract(w * 1.7) - 0.5;
        float k = length(g);
        float ringK = (k - 0.30) * (8.0 + 10.0 * mood); // 静か = 太くやわらかい輪、激しい = 細くくっきり
        float ring = exp(-ringK * ringK);
        float blob = exp(-k * k * 60.0);
        float vein = sin(w.x * 6.0 + w.y * 4.0 + t * 0.5) * 3.2;
        float lines = exp(-vein * vein);
        float hueMix = clamp(0.5 + 0.5 * sin(w.x * 2.1 + w.y * 1.7 + t * 0.2) + (tone - 0.5) * 0.8, 0.0, 1.0);
        vec3 col = mix(colA, colB, hueMix) * (ring * 0.9 + lines * (0.12 + 0.6 * mood)) + colC * blob * (0.35 + high * 0.9);
        // 半径ごとの帯の強さ (静かなときも形は見える)
        col *= 0.4 + 1.1 * levelAt(r);
        // 中心の宝石
        col += colC * exp(-r * r * 14.0) * (0.2 + 0.8 * bass);
        // 端をなだらかに暗く
        col *= smoothstep(2.4, 0.5, r);
        col = col / (1.0 + 0.9 * col);
        gl_FragColor = vec4(col * intensity, 1.0);
      }
    `,
  });
}
