import * as THREE from 'three';

/**
 * Live Stage 専用のシェーダー。three.js の ShaderMaterial の標準的な書き方
 * (position/normal/uv/modelViewMatrix などは three.js が自動で宣言する) に沿っている。
 */

/** 3D の値ノイズ (スモークのむら用)。GLSL の断片として各シェーダーに埋め込む。 */
const NOISE_GLSL = /* glsl */ `
  float lsHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float lsNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(lsHash(i + vec3(0, 0, 0)), lsHash(i + vec3(1, 0, 0)), f.x),
                   mix(lsHash(i + vec3(0, 1, 0)), lsHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(lsHash(i + vec3(0, 0, 1)), lsHash(i + vec3(1, 0, 1)), f.x),
                   mix(lsHash(i + vec3(0, 1, 1)), lsHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`;

/**
 * ムービングライトの光の筋 (底の開いた円錐)。ボリュームライト風に見せるため、
 * - 視線に対して正面を向く面 (= 円錐の中心軸付近) ほど明るく、輪郭に向かって消える
 * - 根元 (along=0) が最も明るく、先に行くほど減衰する
 * - スモークのむら (ノイズ) と濃度 (density = bass) を掛ける
 * 加算合成。ジオメトリは根元が原点、-Y 方向に長さ beamLength だけ伸びている前提。
 */
export function createBeamMaterial(beamLength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'LiveStageBeam',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      color: { value: new THREE.Color() },
      strength: { value: 0.5 },
      density: { value: 0.5 },
      time: { value: 0 },
      beamLength: { value: beamLength },
    },
    vertexShader: /* glsl */ `
      uniform float beamLength;
      varying float vAlong;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      varying vec3 vWorld;
      void main() {
        vAlong = clamp(-position.y / beamLength, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        vNormalV = normalize(normalMatrix * normal);
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float strength;
      uniform float density;
      uniform float time;
      varying float vAlong;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      varying vec3 vWorld;
      ${NOISE_GLSL}
      void main() {
        // 補間した値を 0..1 に収めてから使う: 光の筋の三角形がカメラのすぐ近く・後ろにかかると、GPU によっては
        // 補間の誤差で vAlong などが範囲を大きく外れ、pow で数千の明るさになる。それを bloom が広げて
        // 1 コマだけ画面全体が真っ白になっていた (tests/e2e/flash-safety.spec.ts で見つかった)
        float along = clamp(vAlong, 0.0, 1.0);
        float facing = clamp(abs(dot(normalize(vNormalV), normalize(-vViewPos))), 0.0, 1.0);
        float core = pow(facing, 2.2);
        float fall = pow(1.0 - along, 1.6) + 0.5 * exp(-along * 22.0);
        vec3 q = vWorld * 0.45 + vec3(time * 0.12, -time * 0.05, time * 0.08);
        float n = lsNoise(q) * 0.65 + lsNoise(q * 2.3) * 0.35;
        float smoke = density * (0.3 + 1.1 * n);
        // カメラに近い所ほど薄くする (光の筋がカメラに迫って画面を覆い、真っ白になるのを防ぐ)。
        // 6 より遠ければちょうど 1 なので、今までのカメラ・向きでは見た目は変わらない
        float nearFade = smoothstep(1.2, 6.0, -vViewPos.z);
        float a = core * fall * smoke * strength * nearFade;
        gl_FragColor = vec4(color * a, 1.0);
      }
    `,
  });
}

/**
 * ステージに漂うスモーク (縦の板)。ノイズをゆっくり流し、低い位置ほど濃くする。加算合成。
 * 灰色の霧で画面全体がかすまないよう、濃度 (density) は控えめな範囲で使う。
 */
export function createHazeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'LiveStageHaze',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      color: { value: new THREE.Color() },
      density: { value: 0.3 },
      time: { value: 0 },
      offset: { value: 0 },
      /** 奥の壁の位置 (z)。板が壁に刺さる所で線が見えないよう、壁の手前 1.5 で消す (-8.5 より手前は今までどおり) */
      wallZ: { value: -10 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float density;
      uniform float time;
      uniform float offset;
      uniform float wallZ;
      varying vec2 vUv;
      varying vec3 vWorld;
      ${NOISE_GLSL}
      void main() {
        vec3 q = vec3(vWorld.x * 0.16 + time * 0.05 + offset, vWorld.y * 0.3 - time * 0.02, time * 0.03 + offset);
        float n = lsNoise(q) * 0.6 + lsNoise(q * 2.7) * 0.4;
        n = smoothstep(0.25, 1.0, n);
        float low = (1.0 - smoothstep(0.0, 0.85, vUv.y)) * smoothstep(0.0, 0.12, vUv.y);
        float sides = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
        float a = density * n * low * sides * smoothstep(wallZ, wallZ + 1.5, vWorld.z);
        gl_FragColor = vec4(color * a, 1.0);
      }
    `,
  });
}

/** 奥の壁: ごく暗いパネルの目地 + 足元から立ち上がる色の照り返し (glow = bass/beat)。 */
export function createWallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'LiveStageWall',
    uniforms: {
      baseColor: { value: new THREE.Color() },
      glowColor: { value: new THREE.Color() },
      glow: { value: 0.3 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 baseColor;
      uniform vec3 glowColor;
      uniform float glow;
      varying vec2 vUv;
      void main() {
        vec2 g = abs(fract(vUv * vec2(30.0, 15.0)) - 0.5);
        float seam = smoothstep(0.47, 0.5, max(g.x, g.y));
        vec3 col = baseColor * (1.0 - 0.5 * seam);
        float rise = exp(-vUv.y * 7.0) * (0.6 + 0.4 * (1.0 - abs(vUv.x - 0.5) * 2.0));
        col += glowColor * glow * rise;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/**
 * ステージの床 (three.js の Reflector に `shader` オプションで渡す)。
 * 磨いた黒い床に光がぼんやり映る程度にする。反射像は縦方向ににじませ、手前ほど弱くする。
 * tDiffuse / color / textureMatrix は Reflector 側が値を設定する。
 */
export const stageFloorShader = {
  name: 'LiveStageFloor',
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    floorColor: { value: new THREE.Color() },
    strength: { value: 0.35 },
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
    uniform float strength;
    varying vec4 vUv;
    varying vec2 vPlane;
    void main() {
      vec2 uv = vUv.xy / vUv.w;
      vec3 refl = texture2D(tDiffuse, uv).rgb * 0.4;
      refl += texture2D(tDiffuse, uv + vec2(0.0, 0.006)).rgb * 0.2;
      refl += texture2D(tDiffuse, uv - vec2(0.0, 0.006)).rgb * 0.2;
      refl += texture2D(tDiffuse, uv + vec2(0.0, 0.014)).rgb * 0.1;
      refl += texture2D(tDiffuse, uv - vec2(0.0, 0.014)).rgb * 0.1;
      // 平面の +Y がステージの奥 (-Z)。奥ほど浅い角度で見るので反射を強くする
      float fres = mix(0.35, 1.0, smoothstep(-10.0, 8.0, vPlane.y));
      vec3 col = floorColor + refl * color * strength * fres;
      col *= 1.0 - smoothstep(18.0, 38.0, length(vPlane));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
