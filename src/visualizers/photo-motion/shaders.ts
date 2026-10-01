import * as THREE from 'three';
import { MAX_REGIONS, MAX_SPEAKERS } from './photos';

/**
 * 写真に効果を付けるシェーダー。
 * - スピーカー: 円の中の写真を拡大して描く (中ほど強く、縁はそのまま。いちばん強いとき 18%) → コーンが前へふくらんで見える。少し明るくもする
 * - 光る所: 明るい画素だけを、その所の強さで明るくする (暗い所はそのまま)
 * - スペクトラム: 写真の LED のバーを、横の位置ごとの音の強さより上の部分だけ暗くする (バーが伸び縮みして見える)
 * - スモーク: ゆっくり流れるむらを、決めた四角の中に足す
 * - 層: どの層も画面いっぱいの板で描き、画面 → 画用紙 (uvScale/uvOffset) → 層の絵 (partRect) の順に位置を直す。
 *   部品の層は置き場所の外を描かない。透明な所は透明のまま (下の層が見える)。層全体の濃さ (layerOpacity) も掛ける
 * - 明かりの消え具合 (offDim): 光る所の明るい画素を、静かなときは暗く、音で明るくする (0 なら今までと同じ式)
 * - 光を描き足す種類 (明かりの消えた絵用): VU の盤面の灯りと針・真空管の灯り・すき間から漏れる光・すき間の奥のスペクトラム・LED の列
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
/** 層の絵が画用紙のどこにあるか (x0, y0, x1, y1。下が 0)。画面いっぱいの層は 0, 0, 1, 1 */
uniform vec4 partRect;
uniform float layerOpacity;
uniform float offDim;
/** スピーカー: x, y (写真の uv。下が 0), 半径 (写真の高さに対する), ふくらみ (0..1.2) */
uniform vec4 speakers[MAX_SPEAKERS];
/**
 * 光る所: x0, y0, x1, y1 (写真の uv) と、強さ (x)・種類 (y)・もう 1 つの値 (z)。
 * 種類: 0 = 明るい所を光らせる, 1 = スペクトラム, 2 = VU (z = 針の振れ 0..1), 3 = 真空管の灯り, 4 = すき間の光,
 * 5 = すき間の奥のスペクトラム, 6 = LED の列 (z = 点く高さ 0..1)
 */
uniform vec4 regions[MAX_REGIONS];
uniform vec4 regionLevel[MAX_REGIONS];
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
const vec3 AMBER = vec3(1.0, 0.52, 0.16);
float inRect(vec2 p, vec4 r, float soft) {
  vec2 a = smoothstep(r.xy, r.xy + soft, p) * (1.0 - smoothstep(r.zw - soft, r.zw, p));
  return a.x * a.y;
}

void main() {
  vec2 canvasUv = vUv * uvScale + uvOffset;
  vec2 uv = (canvasUv - partRect.xy) / max(partRect.zw - partRect.xy, vec2(1e-6));
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
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
  vec4 tex = texture2D(map, clamp(uv, 0.0, 1.0));
  vec3 col = tex.rgb;
  col *= 1.0 + 0.3 * clamp(lift, 0.0, 1.5);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float bright = smoothstep(0.12, 0.55, lum);
  // すき間 (暗い所)。明かりの消えた絵で、奥の光が漏れて見える所 (lum は線形の明るさなので、sRGB で 2〜4% 程度の黒)
  float gap = 1.0 - smoothstep(0.0015, 0.006, lum);
  vec3 emit = vec3(0.0);
  // 光る所 (off = 明かりを消す量。光る所の中で、音が小さいほど大きい)
  float glow = globalGlow;
  float off = 0.0;
  for (int i = 0; i < MAX_REGIONS; i++) {
    vec4 r = regions[i];
    if (r.z <= r.x) continue;
    float inside = inRect(uv, r, 0.01);
    if (inside <= 0.0) continue;
    vec4 lv = regionLevel[i];
    float kind = lv.y;
    float u = (uv.x - r.x) / (r.z - r.x);
    float v = (uv.y - r.y) / (r.w - r.y);
    if (kind > 0.5 && kind < 1.5) {
      // スペクトラム: 横の位置の音の強さより上は暗く、下は明るく
      float b = texture2D(bands, vec2(u, 0.5)).r;
      float above = smoothstep(b - 0.04, b + 0.04, v);
      col = mix(col, col * mix(1.0 + 1.1 * lv.x, 0.1, above), bright * inside);
    } else if (kind > 1.5 && kind < 2.5) {
      // VU: 盤面 (明るい所) を暖かい色で照らし、針を描く。根元は下の辺の真ん中
      float face = smoothstep(0.06, 0.25, lum) * inside;
      col = mix(col, col * vec3(1.5, 1.05, 0.5) * (1.0 + 2.6 * lv.x), face);
      float ra = (r.z - r.x) * photoAspect / max(r.w - r.y, 1e-6);
      vec2 p = vec2((u - 0.5) * ra, v - 0.04);
      float ang = mix(-0.85, 0.85, clamp(lv.z, 0.0, 1.0));
      vec2 dir = vec2(sin(ang), cos(ang));
      float along = dot(p, dir);
      float perp = abs(p.x * dir.y - p.y * dir.x);
      float needle = (1.0 - smoothstep(0.03, 0.055, perp)) * smoothstep(0.12, 0.16, along) * (1.0 - smoothstep(0.84, 0.88, along));
      col = mix(col, vec3(0.06, 0.03, 0.02), needle * inside);
    } else if (kind > 2.5 && kind < 3.5) {
      // 真空管の灯り: 管の真ん中ほど明るい橙色
      float cx = (u - 0.5) * 2.6;
      float g = exp(-cx * cx) * smoothstep(0.0, 0.25, v) * (1.0 - smoothstep(0.8, 1.0, v));
      emit += vec3(1.0, 0.45, 0.12) * lv.x * g * inside * 1.1;
    } else if (kind > 3.5 && kind < 4.5) {
      // すき間から漏れる光 (真ん中の高さほど明るい)
      float g = 1.0 - abs(v - 0.5) * 1.2;
      emit += AMBER * lv.x * gap * g * inside * 0.45;
    } else if (kind > 4.5 && kind < 5.5) {
      // すき間の奥のスペクトラム: 細い光の線を並べ、下から音の強さの高さまで光らせる (上ほど赤く、下ほど明るい)
      const float LINES = 46.0;
      float cell = floor(u * LINES);
      float b = texture2D(bands, vec2((cell + 0.5) / LINES, 0.5)).r;
      float fx = fract(u * LINES);
      float line = smoothstep(0.15, 0.35, fx) * (1.0 - smoothstep(0.65, 0.85, fx));
      float below = 1.0 - smoothstep(b - 0.025, b + 0.025, v);
      vec3 c = mix(vec3(1.0, 0.62, 0.2), vec3(1.0, 0.25, 0.06), v);
      emit += c * lv.x * below * line * (1.0 - 0.45 * v) * inside * 1.1;
    } else if (kind > 5.5 && kind < 6.5) {
      // LED の列: 下から点く高さまで、刻みごとに光る
      float seg = smoothstep(0.2, 0.3, fract(v * 12.0)) * (1.0 - smoothstep(0.75, 0.85, fract(v * 12.0)));
      float lit = 1.0 - step(clamp(lv.z, 0.0, 1.0), floor(v * 12.0) / 12.0);
      vec3 c = v > 0.8 ? vec3(1.0, 0.2, 0.05) : AMBER;
      emit += c * lv.x * lit * seg * inside * 1.2;
    } else {
      glow += lv.x * inside;
      off += (1.0 - clamp(lv.x, 0.0, 1.0)) * inside;
    }
  }
  col *= 1.0 - offDim * bright * clamp(off, 0.0, 1.0);
  col += col * bright * glow;
  col += emit;
  // スモーク
  if (hazeAmount > 0.0) {
    vec2 q = uv * vec2(3.0 * photoAspect, 3.0) + vec2(time * 0.06, time * 0.025);
    float n = noise(q) * 0.6 + noise(q * 2.1 + 5.0) * 0.4;
    col += hazeColor * hazeAmount * n * inRect(uv, hazeRect, 0.12);
  }
  gl_FragColor = vec4(col, tex.a * layerOpacity);
}
`;

export function createPhotoMaterial(map: THREE.Texture, bands: THREE.DataTexture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'PhotoMotion',
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    uniforms: {
      map: { value: map },
      bands: { value: bands },
      uvScale: { value: new THREE.Vector2(1, 1) },
      uvOffset: { value: new THREE.Vector2(0, 0) },
      photoAspect: { value: 16 / 9 },
      partRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      layerOpacity: { value: 1 },
      offDim: { value: 0 },
      speakers: { value: Array.from({ length: MAX_SPEAKERS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      regions: { value: Array.from({ length: MAX_REGIONS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      regionLevel: { value: Array.from({ length: MAX_REGIONS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      globalGlow: { value: 0 },
      hazeRect: { value: new THREE.Vector4(0, 0, 0, 0) },
      hazeColor: { value: new THREE.Color() },
      hazeAmount: { value: 0 },
      time: { value: 0 },
    },
  });
}
