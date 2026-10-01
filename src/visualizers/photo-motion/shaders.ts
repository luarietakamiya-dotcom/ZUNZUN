import * as THREE from 'three';
import { MAX_REGIONS, MAX_SPEAKERS } from './photos';

/**
 * 写真に効果を付けるシェーダー。
 * - スピーカー: 円の中の写真を拡大して描く (中ほど強く、縁はそのまま。いちばん強いとき 18%) → コーンが前へふくらんで見える。少し明るくもする
 * - 光る所: 明るい画素だけを、その所の強さで明るくする (暗い所はそのまま)
 * - スペクトラム: 写真の LED のバーを、横の位置ごとの音の強さより上の部分だけ暗くする (バーが伸び縮みして見える)
 * - スモーク: ゆっくり流れるむらを、決めた四角の中に足す
 * 写真の色は sRGB のテクスチャとして読む (three.js が線形に直し、画面へ描くときに戻すので、写真の色のまま出る)
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
#define MAX_SPEAKERS ${MAX_SPEAKERS}
#define MAX_REGIONS ${MAX_REGIONS}
uniform sampler2D map;
uniform sampler2D bands;
/** 画面の uv → 写真の uv (画面いっぱいに収める切り抜き・カメラの動き) */
uniform vec2 uvScale;
uniform vec2 uvOffset;
uniform float photoAspect;
/** スピーカー: x, y (写真の uv。下が 0), 半径 (写真の高さに対する), ふくらみ (0..1.2) */
uniform vec4 speakers[MAX_SPEAKERS];
/** 光る所: x0, y0, x1, y1 (写真の uv) と、強さ・種類 (0 = 明るい所を光らせる, 1 = スペクトラム) */
uniform vec4 regions[MAX_REGIONS];
uniform vec2 regionLevel[MAX_REGIONS];
uniform float globalGlow;
uniform vec4 hazeRect;
uniform vec3 hazeColor;
uniform float hazeAmount;
uniform float time;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float inRect(vec2 p, vec4 r, float soft) {
  vec2 a = smoothstep(r.xy, r.xy + soft, p) * (1.0 - smoothstep(r.zw - soft, r.zw, p));
  return a.x * a.y;
}

void main() {
  vec2 uv = vUv * uvScale + uvOffset;
  // スピーカー: 円の中を少し拡大して読む (ふくらんで見える)
  float lift = 0.0;
  for (int i = 0; i < MAX_SPEAKERS; i++) {
    vec4 s = speakers[i];
    if (s.z <= 0.0) continue;
    vec2 d = (uv - s.xy) * vec2(photoAspect, 1.0);
    float dist = length(d) / s.z;
    if (dist < 1.0) {
      float k = 1.0 - dist * dist;
      float f = s.w * k * k;
      uv = s.xy + (uv - s.xy) * (1.0 - 0.18 * f);
      lift += f;
    }
  }
  vec3 col = texture2D(map, clamp(uv, 0.0, 1.0)).rgb;
  col *= 1.0 + 0.3 * clamp(lift, 0.0, 1.5);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float bright = smoothstep(0.12, 0.55, lum);
  // 光る所
  float glow = globalGlow;
  for (int i = 0; i < MAX_REGIONS; i++) {
    vec4 r = regions[i];
    if (r.z <= r.x) continue;
    float inside = inRect(uv, r, 0.01);
    if (inside <= 0.0) continue;
    vec2 lv = regionLevel[i];
    if (lv.y > 0.5) {
      // スペクトラム: 横の位置の音の強さより上は暗く、下は明るく
      float u = (uv.x - r.x) / (r.z - r.x);
      float v = (uv.y - r.y) / (r.w - r.y);
      float b = texture2D(bands, vec2(u, 0.5)).r;
      float above = smoothstep(b - 0.04, b + 0.04, v);
      col = mix(col, col * mix(1.0 + 1.1 * lv.x, 0.1, above), bright * inside);
    } else {
      glow += lv.x * inside;
    }
  }
  col += col * bright * glow;
  // スモーク
  if (hazeAmount > 0.0) {
    vec2 q = uv * vec2(3.0 * photoAspect, 3.0) + vec2(time * 0.06, time * 0.025);
    float n = noise(q) * 0.6 + noise(q * 2.1 + 5.0) * 0.4;
    col += hazeColor * hazeAmount * n * inRect(uv, hazeRect, 0.12);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createPhotoMaterial(map: THREE.Texture, bands: THREE.DataTexture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'PhotoMotion',
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      map: { value: map },
      bands: { value: bands },
      uvScale: { value: new THREE.Vector2(1, 1) },
      uvOffset: { value: new THREE.Vector2(0, 0) },
      photoAspect: { value: 16 / 9 },
      speakers: { value: Array.from({ length: MAX_SPEAKERS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      regions: { value: Array.from({ length: MAX_REGIONS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      regionLevel: { value: Array.from({ length: MAX_REGIONS }, () => new THREE.Vector2(0, 0)) },
      globalGlow: { value: 0 },
      hazeRect: { value: new THREE.Vector4(0, 0, 0, 0) },
      hazeColor: { value: new THREE.Color() },
      hazeAmount: { value: 0 },
      time: { value: 0 },
    },
  });
}
