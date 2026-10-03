import * as THREE from 'three';

/**
 * Solar Gate 専用のシェーダー。どれも短く、three.js の ShaderMaterial の標準的な書き方
 * (position/uv/modelViewMatrix/projectionMatrix は three.js が自動で宣言する) に沿っている。
 *
 * 2026-10-03 ユーザー「金の月食リング。オーロラ (フレア)、棒というよりもオーロラみたいなのが伸びる感じ。ほかももっといい感じに」で作り直した:
 * 月食リングのフレア (createFlareMaterial)・黒い宇宙の星雲 (createSkyMaterial)・門の内側の真っ暗な面 (createPortalMaterial)。
 * (2026-10-03 ユーザー「周りの光柱と水面入れず宇宙にする」で、光のカーテンと水面は外した)
 */

/** フレアの板が、リングの半径の何倍まで描くか (板の一辺 = 2 × この値 × リングの半径) */
export const PLANE_EXTENT = 2.4;

/**
 * 共通の GLSL: 値ノイズと fbm (4 重ね)。星雲・オーロラのゆらぎ・さざ波に使う。hash は決まった式だけで、乱数は使わない
 * (同じ時刻なら同じ絵)。
 */
const NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s;
  }
`;

/**
 * 夜空: 黒い宇宙 (天頂は黒、地平線のあたりだけごくわずかに色づく) に、金色の星雲のもやがゆっくり流れる。
 * もやは地平線の少し上と、門の左右に濃い (広げすぎると空全体が茶色くかすむので、地平線から離れるほど消す)。
 */
export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SolarGateSky',
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      glowColor: { value: new THREE.Color() },
      glowStrength: { value: 0.4 },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 glowColor;
      uniform float glowStrength;
      uniform float time;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 col = mix(horizonColor * 0.25, topColor, 0.6);
        // 星雲のもや: 横 (方位) と高さで流れるノイズ。地平線の少し上で濃く、高くなるほど消える
        vec2 q = vec2(atan(dir.x, -dir.z) * 2.2, h * 3.2);
        float n1 = fbm(q * 1.2 + vec2(time * 0.012, 0.0));
        float n2 = fbm(q * 2.6 - vec2(time * 0.02, 5.0));
        float cloud = smoothstep(0.42, 1.05, n1 * 0.6 + n2 * 0.6);
        // 細かい金の粉 (もやの中の小さな光)
        float dust = smoothstep(0.62, 0.9, fbm(q * 9.0 + vec2(time * 0.01, 3.0))) * cloud;
        // 宇宙: 星雲は空全体に (門の正面は、リングが見えるよう薄く)
        float side = 0.25 + 0.75 * smoothstep(0.1, 0.8, length(dir.xy - vec2(0.0, 0.02)));
        col += glowColor * (cloud * 0.14 + dust * 0.5) * side * (0.5 + glowStrength);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** 門の内側: 真っ暗 (不透明な黒)。後ろの星や星雲を隠す。ここへ画像を入れたいときは、オーバーレイの画像を重ねる */
export function createPortalMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: 0x000000, name: 'SolarGatePortal' });
}

/** 月食リングのフレアの外周の扇の数 (低音・帯域で伸びる、やわらかいオーロラの縁) */
export const FRINGE_SECTORS = 64;

/**
 * 月食リングのフレア (リングの面に重ねる板。座標はリングの半径を 1 とした長さ)。
 * - ダイヤモンドリング: リングの 1 か所 (angle) だけが太陽のように燃え、小さく強い光の点と十字の光条が出る
 * - フレア: そこから外へ、オーロラのカーテンのように揺れながら流れる (横にゆがめたノイズの縞が、外へ向かって流れる)
 * - 縁: 輪のまわり全体に、やわらかいオーロラの縁 (reach = 方位ごとの伸び。低音・帯域で伸びる)
 * 強さ strength は音で変わる。加算合成で、1 より明るい所は Bloom がにじませる。
 */
export function createFlareMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SolarGateFlare',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      color: { value: new THREE.Color() },
      fringeColor: { value: new THREE.Color() },
      time: { value: 0 },
      angle: { value: 0.9 },
      strength: { value: 0.3 },
      fringe: { value: 0.6 },
      reach: { value: new Float32Array(FRINGE_SECTORS) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = (uv - 0.5) * 2.0 * ${PLANE_EXTENT.toFixed(2)};
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #define PI 3.14159265
      #define SECTORS ${FRINGE_SECTORS}
      uniform vec3 color;
      uniform vec3 fringeColor;
      uniform float time;
      uniform float angle;
      uniform float strength;
      uniform float fringe;
      uniform float reach[SECTORS];
      varying vec2 vP;
      ${NOISE_GLSL}
      void main() {
        float r = length(vP);
        float a = atan(vP.y, vP.x);
        float da = mod(a - angle + PI, 2.0 * PI) - PI;
        float out_ = max(r - 1.0, 0.0);

        // 燃えるリング: 細い線 (幅 1.4%) の、燃える所だけを太く明るく
        float ringLine = exp(-pow((r - 1.0) / 0.016, 2.0));
        float arc = exp(-da * da / 0.45);
        float arcCore = exp(-da * da / 0.035);
        float burn = ringLine * (arc * 0.6 + arcCore * 1.8) * strength;

        // フレア: 外へ向かって横にゆがむ (オーロラのカーテン) 縞が、外へ流れる
        // ゆがみは弱く (強いと煙の渦になる)。外へ向かう細い縞 (オーロラのカーテンの筋) を、角度方向に細かく刻む
        // 隣の筋どうしが外へ向かってゆるやかな曲線でつながるよう、方位を大きくうねらせる (うねりは隣と同じ向き)
        float sway = (fbm(vec2(a * 1.1, out_ * 1.3 - time * 0.2)) - 0.5) * 0.34 * out_;
        float dd = da + sway;
        float spread = 0.17 + out_ * 0.3;
        float body = exp(-dd * dd / (spread * spread));
        // 筋は太く・低く (棒に見えないよう、つぶつぶの細い縞をやめて、ゆるいうねりの濃淡にする)
        float rays = fbm(vec2((a + sway) * 11.0, out_ * 0.8 - time * 0.3));
        float streak = 0.55 + 0.45 * smoothstep(0.2, 0.8, rays);
        // 外へ向かって細く長く消える。板の端 (r = PLANE) では 0 になる窓を掛ける (板の四角い縁が見えないように)
        float edge = 1.0 - smoothstep(${(PLANE_EXTENT * 0.72).toFixed(2)}, ${PLANE_EXTENT.toFixed(2)}, r);
        float fall = exp(-out_ * 2.6) * smoothstep(0.0, 0.02, out_) * edge;
        float flare = body * streak * fall * strength * 1.7;

        // ダイヤモンド: 小さく強い光の点と、十字の光条
        vec2 p0 = vec2(cos(angle), sin(angle));
        vec2 d = vP - p0;
        float dl = length(d);
        float diamond = exp(-dl * dl * 420.0) * 1.6 + exp(-dl * dl * 40.0) * 0.25;
        float cross = (exp(-abs(d.x) * 90.0) + exp(-abs(d.y) * 90.0)) * exp(-dl * 4.0) * 0.16;
        diamond = (diamond + cross) * strength;

        // 縁: 輪のまわり全体の、やわらかいオーロラの縁 (方位ごとの伸び reach をなめらかにつなぐ)
        float u = (a / (2.0 * PI) + 0.5) * float(SECTORS);
        int i0 = int(floor(u)) % SECTORS;
        int i1 = (i0 + 1) % SECTORS;
        float L = mix(reach[i0], reach[i1], fract(u));
        float fa = a + (fbm(vec2(a * 1.1 + 3.0, out_ * 1.3 - time * 0.2)) - 0.5) * 0.3 * out_;
        float fs = 0.5 + 0.5 * smoothstep(0.2, 0.8, fbm(vec2(fa * 9.0, out_ * 1.2 - time * 0.4)));
        float fr = exp(-out_ * 3.2 / (L + 0.05)) * min(L, 1.2) * fs * smoothstep(0.0, 0.015, out_) * (1.0 - smoothstep(0.0, 1.0, out_ / (L + 0.05)) * 0.6) * edge;
        fr *= fringe * 1.6;

        vec3 col = color * (burn + flare + diamond) + fringeColor * fr;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
