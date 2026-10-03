import * as THREE from 'three';

/**
 * Solar Gate 専用のシェーダー。どれも短く、three.js の ShaderMaterial の標準的な書き方
 * (position/uv/modelViewMatrix/projectionMatrix は three.js が自動で宣言する) に沿っている。
 *
 * 2026-10-03 ユーザー「金の月食リング。オーロラ (フレア)、棒というよりもオーロラみたいなのが伸びる感じ。ほかももっといい感じに」で作り直した:
 * 月食リングのフレア (createFlareMaterial)・地面から立ち上がるオーロラのカーテン (createCurtainMaterial)・黒い宇宙の星雲 (createSkyMaterial)・
 * 縦に長く映る水面 (floorReflectorShader)。
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
        vec3 col = mix(horizonColor * 0.45, topColor, smoothstep(-0.02, 0.4, h));
        // 星雲のもや: 横 (方位) と高さで流れるノイズ。地平線の少し上で濃く、高くなるほど消える
        vec2 q = vec2(atan(dir.x, -dir.z) * 2.2, h * 3.2);
        float n1 = fbm(q * 1.2 + vec2(time * 0.012, 0.0));
        float n2 = fbm(q * 2.6 - vec2(time * 0.02, 5.0));
        float cloud = smoothstep(0.5, 0.92, n1 * 0.6 + n2 * 0.6);
        // 細かい金の粉 (もやの中の小さな光)
        float dust = smoothstep(0.62, 0.9, fbm(q * 9.0 + vec2(time * 0.01, 3.0))) * cloud;
        float vert = smoothstep(0.0, 0.05, h) * (1.0 - smoothstep(0.06, 0.38, h));
        // 左右の外側ほど濃く (門の正面は、リングが見えるよう薄く)
        float side = 0.15 + 0.85 * smoothstep(0.15, 0.85, abs(dir.x));
        col += glowColor * (cloud * 0.16 + dust * 0.6) * vert * side * (0.5 + glowStrength);
        // 地平線の細い帯と、門の真後ろのごく小さな太陽
        float band = exp(-abs(h) * 22.0);
        float sun = pow(max(dot(dir, normalize(vec3(0.0, 0.06, -1.0))), 0.0), 120.0);
        col += glowColor * (band * 0.06 + sun * 0.18) * glowStrength;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** 門の内側の膜。外周寄りが明るい環 + 中心のかすかな光 + ゆっくり回る渦の縞。加算合成。 */
export function createPortalMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SolarGatePortal',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      color: { value: new THREE.Color() },
      strength: { value: 0.3 },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float strength;
      uniform float time;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float a = atan(p.y, p.x);
        float swirl = 0.5 + 0.5 * sin(a * 6.0 + time - r * 9.0);
        float rim = smoothstep(0.5, 0.98, r) * (1.0 - smoothstep(0.98, 1.0, r));
        float core = exp(-r * r * 4.0) * 0.3;
        float alpha = (rim * 0.6 + core) * (0.55 + 0.45 * swirl) * strength;
        gl_FragColor = vec4(color * alpha, alpha);
      }
    `,
  });
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
        float sway = (fbm(vec2(a * 1.4, out_ * 1.6 - time * 0.22)) - 0.5) * 0.12 * out_;
        float dd = da + sway;
        float spread = 0.17 + out_ * 0.3;
        float body = exp(-dd * dd / (spread * spread));
        float rays = fbm(vec2((a + sway) * 46.0, out_ * 0.9 - time * 0.45));
        float streak = 0.2 + 0.8 * smoothstep(0.25, 0.8, rays);
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
        float fs = 0.15 + 0.85 * smoothstep(0.3, 0.8, fbm(vec2(a * 40.0, out_ * 1.5 - time * 0.7)));
        float fr = exp(-out_ * 3.2 / (L + 0.05)) * min(L, 1.2) * fs * smoothstep(0.0, 0.015, out_) * (1.0 - smoothstep(0.0, 1.0, out_ / (L + 0.05)) * 0.6) * edge;
        fr *= fringe * 1.6;

        vec3 col = color * (burn + flare + diamond) + fringeColor * fr;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** 地面から立ち上がるオーロラのカーテンの数と、置き場所 (世界の x。門の左右に、太いのと細いのを交互に) */
export const CURTAIN_COUNT = 9;
export const CURTAIN_X = [-9.4, -7.9, -6.1, -4.2, 0, 4.2, 6.1, 7.9, 9.4] as const;
/** 太さ (世界の長さ): 細い光の線の太さ。中くらいの帯は 0.5 に近い (根元が強く広がる) */
export const CURTAIN_W = [0.5, 0.2, 0.55, 0.18, 0.16, 0.18, 0.55, 0.2, 0.5] as const;
/** 根元が円錐状に広がる (縞の模様が出る) カーテン (1 = 太い) */
export const CURTAIN_THICK = [0, 0, 1, 0, 0, 0, 1, 0, 0] as const;
export const CURTAIN_PLANE = { width: 44, height: 14 } as const;

/**
 * 地面から立ち上がるオーロラのカーテン (板 1 枚に 9 本を描く。参考の絵の、地面から縦に伸びる光の柱)。
 * 細い光の芯 + やわらかい縦縞のもや。根元が強く光り、上へ消える。太いカーテンは根元が円錐状に広がり、横縞が出る。
 * 高さ height[i] (世界の長さ) と明るさ level[i] は音で変わる。
 */
export function createCurtainMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SolarGateCurtain',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      color: { value: new THREE.Color() },
      time: { value: 0 },
      strength: { value: 0 },
      height: { value: new Float32Array(CURTAIN_COUNT).fill(7) },
      level: { value: new Float32Array(CURTAIN_COUNT).fill(0.4) },
      cx: { value: Float32Array.from(CURTAIN_X) },
      cw: { value: Float32Array.from(CURTAIN_W) },
      thick: { value: Float32Array.from(CURTAIN_THICK) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vW;
      void main() {
        vW = vec2((uv.x - 0.5) * ${CURTAIN_PLANE.width.toFixed(1)}, uv.y * ${CURTAIN_PLANE.height.toFixed(1)});
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #define COUNT ${CURTAIN_COUNT}
      uniform vec3 color;
      uniform float time;
      uniform float strength;
      uniform float height[COUNT];
      uniform float level[COUNT];
      uniform float cx[COUNT];
      uniform float cw[COUNT];
      uniform float thick[COUNT];
      varying vec2 vW;
      ${NOISE_GLSL}
      void main() {
        float sum = 0.0;
        for (int i = 0; i < COUNT; i++) {
          float h = height[i];
          float t = vW.y / h;
          if (t > 1.2) continue;
          // 上へ行くほど少し揺れる (オーロラのカーテン)
          float sway = (fbm(vec2(float(i) * 3.7, vW.y * 0.35 - time * 0.4)) - 0.5) * 0.5 * t;
          float dx = (vW.x - cx[i] - sway) / cw[i];
          // 根元が広がる円錐 (太いカーテンだけ)
          float cone = 1.0 + thick[i] * 2.2 * exp(-vW.y * 0.7);
          float ddx = dx / cone;
          float core = exp(-ddx * ddx * 55.0);
          float halo = exp(-ddx * ddx * 0.9) * 0.55 + exp(-ddx * ddx * 0.18) * 0.12;
          float vert = (1.0 - smoothstep(0.25, 1.0, t)) * smoothstep(0.0, 0.015, vW.y);
          // 縦縞 (オーロラの筋) と、太いカーテンの横縞
          float streak = 0.45 + 0.55 * fbm(vec2(vW.x * 1.6 + float(i) * 9.0, vW.y * 0.35 - time * 0.4));
          float band = mix(1.0, 0.6 + 0.4 * sin(vW.y * 16.0 - time * 2.2), thick[i] * exp(-vW.y * 0.5));
          float foot = exp(-vW.y * 2.6) * exp(-ddx * ddx * (thick[i] > 0.5 ? 1.2 : 6.0)) * (thick[i] > 0.5 ? 1.5 : 0.9);
          sum += level[i] * ((core + halo * streak) * vert * band + foot);
        }
        float a = sum * (0.45 + strength);
        // 重なって足し算で真っ白にならないよう、明るいところほど頭打ちにする
        a = 0.9 * (1.0 - exp(-a / 0.9));
        gl_FragColor = vec4(color * a, a);
      }
    `,
  });
}

/**
 * 反射床のシェーダー (three.js の Reflector に `shader` オプションで渡す)。2026-10-03 に水面にした:
 * 完全な鏡ではなく、縦方向に長く引き伸ばして (7 か所をぼかして重ねる) 光が水面に長く映る感じにし、
 * 細かいさざ波 (ノイズで反射の位置を横にずらす) を重ねる。門から離れるほど反射を弱めて地平線の色へ溶かす
 * (床の端が空との境目として見えないようにする)。
 * tDiffuse / color / textureMatrix は Reflector 側が値を設定する。time は preset が毎フレーム入れる。
 */
export const floorReflectorShader = {
  name: 'SolarGateFloor',
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    floorColor: { value: new THREE.Color() },
    horizonColor: { value: new THREE.Color() },
    strength: { value: 0.62 },
    blur: { value: 0.0075 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vPlane;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vPlane = position.xy;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform vec3 floorColor;
    uniform vec3 horizonColor;
    uniform float strength;
    uniform float blur;
    uniform float time;
    varying vec4 vUv;
    varying vec2 vPlane;
    ${NOISE_GLSL}
    void main() {
      vec2 uv = vUv.xy / vUv.w;
      // さざ波: 反射の位置を、ゆっくり動くノイズで横にずらす (遠いほど細かく)
      float ripple = (fbm(vec2(vPlane.x * 0.9, vPlane.y * 2.2 - time * 0.35)) - 0.5) * 0.012;
      uv.x += ripple;
      // 縦に長く: 下 (手前) へ向かって長く引く 7 か所
      vec3 refl = texture2D(tDiffuse, uv).rgb * 0.24;
      refl += texture2D(tDiffuse, uv + vec2(0.0, blur)).rgb * 0.19;
      refl += texture2D(tDiffuse, uv - vec2(0.0, blur)).rgb * 0.17;
      refl += texture2D(tDiffuse, uv + vec2(0.0, blur * 2.6)).rgb * 0.14;
      refl += texture2D(tDiffuse, uv - vec2(0.0, blur * 2.6)).rgb * 0.12;
      refl += texture2D(tDiffuse, uv + vec2(0.0, blur * 5.0)).rgb * 0.08;
      refl += texture2D(tDiffuse, uv - vec2(0.0, blur * 5.0)).rgb * 0.06;
      float dist = length(vPlane);
      float fade = exp(-dist * 0.075);
      // 波の筋: 反射の明るさを、細い横筋でゆらす
      float sheen = 0.82 + 0.18 * sin(vPlane.y * 9.0 + fbm(vPlane * 0.7) * 6.0 - time * 0.8);
      vec3 col = floorColor + refl * color * strength * fade * sheen;
      col = mix(col, horizonColor * 0.45, smoothstep(12.0, 38.0, dist));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
