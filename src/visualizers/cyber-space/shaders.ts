import * as THREE from 'three';

/**
 * 「サイバー空間」のシェーダー。
 *
 * 背景 (createCyberMaterial):
 * - 絵を画面いっぱいに収め (はみ出した所を切る)、奥の消失点 vp へ向かって寄る (zoom)。
 * - 寄るときのブレ: vp から外へ向かう線の上の 8 か所を混ぜる (zoomBlur)。
 * - 色ずれ: 赤は外へ、青は内へ、vp からの向きにずらす (split)。
 * - ネオン: 明るくて色の濃い所 (mask) だけを、neon の分だけ 1 より明るくする (ブルームでにじむ)。暗い所はそのまま。
 * - 色の移り変わり: ネオンの所だけ色相を hue (ラジアン) だけ回す。
 * - 光の波: 拍ごとに vp から広がる輪 (最大 MAX_RINGS 本)。床に沿って見えるように横長の楕円にする。輪の通る所を明るくする
 *   (ネオンの所ほど強く)。
 * 色はテクスチャを sRGB として読む (線形の値で計算する。しきい値も線形の値)。
 *
 * ワープの線 (createWarpMaterial): 板 1 枚を複製して、vp から外へ飛ぶ細長い光にする。外へ行くほど速く長くなる (奥行き)。
 * 足し合わせて描く。
 */

export const MAX_RINGS = 4;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
#define MAX_RINGS ${MAX_RINGS}
uniform sampler2D map;
uniform vec2 fit;
uniform vec2 vp;
uniform float imgAspect;
uniform float zoom;
uniform float zoomBlur;
uniform float split;
uniform float neon;
uniform float hue;
uniform float energy;
/** 輪: 半径 (絵の高さ = 1), 強さ */
uniform vec2 rings[MAX_RINGS];
varying vec2 vUv;

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 hueRotate(vec3 c, float a) {
  // YIQ の色の面で回す
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * c;
  float cs = cos(a);
  float sn = sin(a);
  yiq.yz = vec2(cs * yiq.y - sn * yiq.z, sn * yiq.y + cs * yiq.z);
  return max(vec3(0.0), toRGB * yiq);
}

vec3 sampleAt(vec2 uv) {
  return texture2D(map, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
}

void main() {
  // 画面 → 絵 (画面いっぱいに収める) → vp へ寄る
  vec2 uv = 0.5 + (vUv - 0.5) * fit;
  uv = vp + (uv - vp) / zoom;
  vec2 dir = uv - vp;

  // 色ずれ (vp からの向き)。外ほど大きく
  vec2 off = dir * split;
  vec3 col;
  if (zoomBlur > 0.0005) {
    col = vec3(0.0);
    float wsum = 0.0;
    for (int k = 0; k < 8; k++) {
      float t = float(k) / 7.0;
      float w = 1.0 - 0.6 * t;
      vec2 q = uv - dir * zoomBlur * t;
      col += vec3(sampleAt(q + off).r, sampleAt(q).g, sampleAt(q - off).b) * w;
      wsum += w;
    }
    col /= wsum;
  } else {
    col = vec3(sampleAt(uv + off).r, sampleAt(uv).g, sampleAt(uv - off).b);
  }

  // ネオンの所 (明るくて色が濃い)
  float l = lum(col);
  float mx = max(col.r, max(col.g, col.b));
  float mn = min(col.r, min(col.g, col.b));
  float sat = (mx - mn) / max(mx, 0.0001);
  float mask = smoothstep(0.06, 0.4, l) * smoothstep(0.35, 0.7, sat) + smoothstep(0.75, 1.0, l) * 0.2;
  mask = clamp(mask, 0.0, 1.0);

  if (abs(hue) > 0.0001) col = mix(col, hueRotate(col, hue), mask);

  // 光の波 (横長の楕円。床に沿って広がって見える)
  vec2 d = vec2(dir.x * imgAspect, dir.y * 2.4);
  float r = length(d);
  float wave = 0.0;
  for (int i = 0; i < MAX_RINGS; i++) {
    vec2 rg = rings[i];
    if (rg.y <= 0.0) continue;
    float w = 0.03 + rg.x * 0.06;
    wave += rg.y * exp(-pow((r - rg.x) / w, 2.0));
  }

  col *= 0.85 + 0.25 * energy;
  col += col * mask * neon;
  col += col * wave * (0.35 + 0.9 * mask) + vec3(0.25, 0.55, 1.0) * wave * 0.05;
  // 白く飛びすぎないように (ブルームには 1 より明るい値が要るので、上だけ丸める)
  col = col / (1.0 + max(vec3(0.0), col - 1.0) * 0.6);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createCyberMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'CyberSpace',
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      map: { value: null },
      fit: { value: new THREE.Vector2(1, 1) },
      vp: { value: new THREE.Vector2(0.5, 0.3) },
      imgAspect: { value: 16 / 9 },
      zoom: { value: 1 },
      zoomBlur: { value: 0 },
      split: { value: 0 },
      neon: { value: 0 },
      hue: { value: 0 },
      energy: { value: 0 },
      rings: { value: Array.from({ length: MAX_RINGS }, () => new THREE.Vector2(0, 0)) },
    },
  });
}

const WVERT = /* glsl */ `
attribute vec4 seed;
uniform float time;
uniform float aspect;
uniform vec2 vpScreen;
uniform float stretch;
varying float vFade;
varying float vColor;
varying vec2 vLocal;
void main() {
  float ang = seed.x * 6.2831;
  float p = fract(seed.y + time * (0.25 + 0.35 * seed.z));
  // 外へ行くほど速く (奥行き)
  float r = pow(p, 2.2) * 1.4;
  vec2 dirv = vec2(cos(ang), sin(ang));
  float len = (0.02 + r * 0.22) * stretch;
  float wid = 0.0015 + 0.004 * p;
  // 板の x を向き、y を太さに。中心は vp から r のところ
  vec2 along = dirv * (position.x * len);
  vec2 across = vec2(-dirv.y, dirv.x) * (position.y * wid);
  vec2 q = dirv * (r + len * 0.5) + along + across;
  vFade = smoothstep(0.0, 0.15, p) * (1.0 - smoothstep(0.85, 1.0, p));
  vColor = seed.w;
  vLocal = position.xy * 2.0;
  gl_Position = vec4(vpScreen.x * 2.0 - 1.0 + q.x * 2.0 / aspect, vpScreen.y * 2.0 - 1.0 + q.y * 2.0, 0.0, 1.0);
}
`;

const WFRAG = /* glsl */ `
uniform float brightness;
varying float vFade;
varying float vColor;
varying vec2 vLocal;
void main() {
  // 先 (外側) が明るく、根元が細く消える
  float head = smoothstep(-1.0, 1.0, vLocal.x);
  float edge = 1.0 - smoothstep(0.3, 1.0, abs(vLocal.y));
  vec3 cyan = vec3(0.3, 0.9, 1.0);
  vec3 magenta = vec3(1.0, 0.35, 0.95);
  vec3 col = mix(cyan, magenta, step(0.6, vColor)) * brightness;
  float a = head * edge * vFade;
  gl_FragColor = vec4(col * a, a);
}
`;

export function createWarpMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'CyberSpaceWarp',
    vertexShader: WVERT,
    fragmentShader: WFRAG,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      time: { value: 0 },
      aspect: { value: 16 / 9 },
      vpScreen: { value: new THREE.Vector2(0.5, 0.3) },
      stretch: { value: 1 },
      brightness: { value: 1 },
    },
  });
}
