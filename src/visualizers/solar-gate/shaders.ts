import * as THREE from 'three';

/**
 * Solar Gate 専用のシェーダー。どれも短く、three.js の ShaderMaterial の標準的な書き方
 * (position/uv/modelViewMatrix/projectionMatrix は three.js が自動で宣言する) に沿っている。
 */

/** 夜空: 天頂の暗い色 → 地平線の色、地平線付近の帯状の光と、門の奥の「太陽」の滲み。 */
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
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 col = mix(horizonColor, topColor, smoothstep(-0.02, 0.55, h));
        // 地平線の細い帯と、門の真後ろの小さな「太陽」。広げすぎると空全体が茶色くかすむので絞っている
        float band = exp(-abs(h) * 16.0);
        float sun = pow(max(dot(dir, normalize(vec3(0.0, 0.06, -1.0))), 0.0), 90.0);
        col += glowColor * (band * 0.08 + sun * 0.3) * glowStrength;
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

/** 門の奥から天へ伸びる光柱。横方向はガウス形、縦は根元と上端で消える。ビートで明滅させる。 */
export function createPillarMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SolarGatePillar',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      color: { value: new THREE.Color() },
      strength: { value: 0 },
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
      varying vec2 vUv;
      void main() {
        float x = (vUv.x - 0.5) * 2.0;
        float core = exp(-x * x * 40.0);
        float halo = exp(-x * x * 4.0) * 0.3;
        float v = vUv.y;
        float fade = smoothstep(0.0, 0.06, v) * (1.0 - smoothstep(0.3, 1.0, v));
        float a = (core + halo) * fade * strength;
        gl_FragColor = vec4(color * a, a);
      }
    `,
  });
}

/**
 * 反射床のシェーダー (three.js の Reflector に `shader` オプションで渡す)。
 * Reflector 標準の完全な鏡ではなく、縦方向に少しにじませ、門から離れるほど反射を弱めて
 * 地平線の色へ溶かす (床の端が空との境目として見えないようにする)。
 * tDiffuse / color / textureMatrix は Reflector 側が値を設定する。
 */
export const floorReflectorShader = {
  name: 'SolarGateFloor',
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    floorColor: { value: new THREE.Color() },
    horizonColor: { value: new THREE.Color() },
    strength: { value: 0.55 },
    blur: { value: 0.006 },
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
    varying vec4 vUv;
    varying vec2 vPlane;
    void main() {
      vec2 uv = vUv.xy / vUv.w;
      vec3 refl = texture2D(tDiffuse, uv).rgb * 0.28;
      refl += texture2D(tDiffuse, uv + vec2(0.0, blur)).rgb * 0.2;
      refl += texture2D(tDiffuse, uv - vec2(0.0, blur)).rgb * 0.2;
      refl += texture2D(tDiffuse, uv + vec2(0.0, blur * 2.5)).rgb * 0.16;
      refl += texture2D(tDiffuse, uv - vec2(0.0, blur * 2.5)).rgb * 0.16;
      float dist = length(vPlane);
      float fade = exp(-dist * 0.08);
      vec3 col = floorColor + refl * color * strength * fade;
      col = mix(col, horizonColor, smoothstep(12.0, 38.0, dist));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
