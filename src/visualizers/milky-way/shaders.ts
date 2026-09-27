import * as THREE from 'three';

/**
 * Milky Way 専用のシェーダー。three.js の ShaderMaterial の標準的な書き方
 * (position/uv/modelViewMatrix/projectionMatrix は three.js が自動で宣言する) に沿っている。
 */

/** 3D の値ノイズ + fbm。天の川の濃淡と暗い塵の筋に使う (外部テクスチャ不要、seed で模様をずらせる)。 */
const NOISE_GLSL = /* glsl */ `
  float mwHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float mwNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(mwHash(i), mwHash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(mwHash(i + vec3(0.0, 1.0, 0.0)), mwHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(mwHash(i + vec3(0.0, 0.0, 1.0)), mwHash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(mwHash(i + vec3(0.0, 1.0, 1.0)), mwHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float mwFbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * mwNoise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return v;
  }
`;

/**
 * 夜空 + 天の川。天の川は「帯の中心となる大円」を axisN (帯の面の法線) と axisC (銀河中心の方向) で定め、
 * 帯からの距離 (lat) と帯に沿った角度 (lon) で明るさを決める。中心付近は太く暖色、塵の筋で暗く抜ける。
 */
export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'MilkyWaySky',
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      airglowColor: { value: new THREE.Color() },
      coreColor: { value: new THREE.Color() },
      armColor: { value: new THREE.Color() },
      axisC: { value: new THREE.Vector3(0, 0, -1) },
      axisN: { value: new THREE.Vector3(0, 1, 0) },
      axisT: { value: new THREE.Vector3(1, 0, 0) },
      seedOffset: { value: new THREE.Vector3() },
      skyRotation: { value: 0 },
      galaxyStrength: { value: 0.5 },
      airglow: { value: 0.4 },
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
      uniform vec3 airglowColor;
      uniform vec3 coreColor;
      uniform vec3 armColor;
      uniform vec3 axisC;
      uniform vec3 axisN;
      uniform vec3 axisT;
      uniform vec3 seedOffset;
      uniform float skyRotation;
      uniform float galaxyStrength;
      uniform float airglow;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizonColor, topColor, smoothstep(0.0, 0.65, h));

        // 空の自転 (Y 軸まわりのごくゆっくりした回転)
        float cr = cos(skyRotation);
        float sr = sin(skyRotation);
        vec3 r = vec3(cr * d.x + sr * d.z, d.y, -sr * d.x + cr * d.z);

        vec3 g = vec3(dot(r, axisC), dot(r, axisN), dot(r, axisT));
        float lat = g.y;
        float lon = atan(g.z, g.x);
        float core = exp(-pow(lon / 0.6, 2.0));
        float width = 0.07 + 0.075 * core;
        float band = exp(-pow(lat / width, 2.0));
        float halo = exp(-pow(lat / (width * 2.2), 2.0)) * 0.1;
        vec3 q = g * 4.0 + seedOffset;
        float n = mwFbm(q);
        float n2 = mwFbm(q * 3.1 + 11.0);
        // 星雲の濃淡 (大小 2 段の雲) と、細かな暗い塵の筋、帯の中心を走る細い暗黒帯 (リフト)
        float clouds = pow(smoothstep(0.3, 0.9, n * 0.65 + n2 * 0.45), 1.4);
        float dust = smoothstep(0.48, 0.78, mwFbm(q * 8.0 + 5.0)) * smoothstep(0.1, 0.7, band);
        float rift = exp(-pow((lat + 0.02 * sin(lon * 3.0 + seedOffset.x)) / (0.02 + 0.016 * core), 2.0));
        float darken = max(dust * 0.5, rift * 0.55 * (0.4 + 0.6 * n));
        float glow = (band * (0.12 + 1.9 * clouds) + halo) * (1.0 - darken) * (0.45 + 1.0 * core);
        vec3 gcol = mix(armColor, coreColor, clamp(core + (n2 - 0.5) * 0.6, 0.0, 1.0));
        col += gcol * glow * galaxyStrength * 0.3;

        // 地平線の大気光 (夜光)
        col += airglowColor * exp(-max(h, 0.0) * 14.0) * airglow;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/**
 * 星 (Points)。1 粒ずつ大きさ・明るさ・色・またたきの位相を持ち、twinkle (high) で明滅の深さが変わる。
 * gl_PointSize は「1080p の高さを基準にした px」× pixelScale で、書き出し解像度が変わっても見た目の大きさが揃う。
 */
export function createStarMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'MilkyWayStars',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      time: { value: 0 },
      twinkle: { value: 0.2 },
      boost: { value: 1 },
      pixelScale: { value: 1 },
      skyRotation: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float starSize;
      attribute float starPhase;
      attribute float starBright;
      attribute vec3 starColor;
      uniform float time;
      uniform float twinkle;
      uniform float boost;
      uniform float pixelScale;
      uniform float skyRotation;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float cr = cos(skyRotation);
        float sr = sin(skyRotation);
        vec3 p = vec3(cr * position.x - sr * position.z, position.y, sr * position.x + cr * position.z);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float tw = 1.0 - twinkle * (0.5 + 0.5 * sin(time * (1.5 + starPhase * 4.0) + starPhase * 6.2831853));
        vAlpha = starBright * tw * boost;
        vColor = starColor;
        gl_PointSize = starSize * pixelScale * (0.85 + 0.3 * tw);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        float a = exp(-r2 * 4.5) * vAlpha;
        gl_FragColor = vec4(vColor * a, a);
      }
    `,
  });
}

/**
 * 湖面 (three.js の Reflector に `shader` オプションで渡す)。
 * 反射像を波でゆらし (ripple = rms)、遠くほど反射が強くなる (浅い角度ほど水面は鏡に近い)。
 * tDiffuse / color / textureMatrix は Reflector 側が値を設定する。
 */
export const lakeReflectorShader = {
  name: 'MilkyWayLake',
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    waterColor: { value: new THREE.Color() },
    horizonColor: { value: new THREE.Color() },
    strength: { value: 0.8 },
    ripple: { value: 0.3 },
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
    uniform vec3 waterColor;
    uniform vec3 horizonColor;
    uniform float strength;
    uniform float ripple;
    uniform float time;
    varying vec4 vUv;
    varying vec2 vPlane;
    void main() {
      vec2 p = vPlane;
      float dist = length(p);
      float w = sin(p.y * 1.3 + time * 1.1) * 0.6
              + sin(p.x * 0.7 - p.y * 2.1 + time * 1.7) * 0.4
              + sin(p.x * 2.3 + p.y * 0.9 - time * 0.8) * 0.25;
      vec2 offset = vec2(w * 0.003, w * 0.01) * ripple / (1.0 + dist * 0.05);
      vec2 uv = vUv.xy / vUv.w + offset;
      vec3 refl = texture2D(tDiffuse, uv).rgb * 0.5;
      refl += texture2D(tDiffuse, uv + vec2(0.0, 0.004 * (0.5 + ripple))).rgb * 0.25;
      refl += texture2D(tDiffuse, uv - vec2(0.0, 0.004 * (0.5 + ripple))).rgb * 0.25;
      float fres = mix(0.45, 0.95, smoothstep(3.0, 60.0, dist));
      vec3 col = waterColor + refl * color * strength * fres;
      col = mix(col, horizonColor, smoothstep(140.0, 195.0, dist));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
