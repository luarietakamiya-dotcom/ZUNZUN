import * as THREE from 'three';
import type { ParticleKind } from './scenes';

/**
 * 「流れる街並み」のシェーダー。
 *
 * 背景 (createCityMaterial):
 * - 横長の絵を画面の高さいっぱいに置き、横に流す (scroll は絵の横幅を 1 とした位置)。
 * - つなぎ目: 絵を何枚か (別の絵を) つなげて流すときは、絵の右端の seam の幅と、次の絵の左端の seam の幅を重ねて、
 *   なめらかに溶かす (seam = SEAM)。1 枚の長さは 1 - seam になる。
 *   1 枚だけ流すときは seam = 0: 絵そのものが左右の端でつながるように作ってある (2026-10-03 の 3 枚をつないだ絵) ので、溶かさない。
 * - ぼかし: 円の中の 16 か所を重みつきで混ぜる (blur = 半径。絵の高さを 1 とした長さ)。
 * - きらめき: 絵を小さな升に分け、升ごとに 1 か所、まわりより明るい所 (窓の灯り・街灯・ネオン・水面の照り返し)
 *   にだけ、十字の光をまたたかせる (空や雲のように一様に明るい所では光らない)。位置とまたたきの速さは升ごとの
 *   決まった値 (hash) なので、同じ時刻なら同じ絵になる。
 * 色はテクスチャを sRGB として読む (線形の値で計算する。明るさのしきい値も線形の値)。
 *
 * 舞うもの (createParticleMaterial): 板 1 枚を数百個に複製して、位置・回転・ひらめきを頂点シェーダーで時刻から決める。
 * 形と色は種類ごとに、フラグメントシェーダーで描く (花びら・雪・木の葉・光の粒・紙ふぶき)。
 */

/** 隣の絵と重ねて溶かす幅 (絵の横幅に対する割合) */
export const SEAM = 0.08;
/** つなげられる絵の数 (シェーダーのテクスチャの数) */
export const MAX_SCENES = 9;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D map0;
uniform sampler2D map1;
uniform sampler2D map2;
uniform sampler2D map3;
uniform sampler2D map4;
uniform sampler2D map5;
uniform sampler2D map6;
uniform sampler2D map7;
uniform sampler2D map8;
uniform int count;
uniform float period;
uniform float seam;
uniform float imgAspect;
uniform float aspect;
uniform float scroll;
uniform float blur;
uniform float texelV;
uniform float time;
uniform float sparkle;
uniform float sparkleBoost;
uniform float brightness;
varying vec2 vUv;

vec3 tex(int i, vec2 uv) {
  if (i == 0) return texture2D(map0, uv).rgb;
  if (i == 1) return texture2D(map1, uv).rgb;
  if (i == 2) return texture2D(map2, uv).rgb;
  if (i == 3) return texture2D(map3, uv).rgb;
  if (i == 4) return texture2D(map4, uv).rgb;
  if (i == 5) return texture2D(map5, uv).rgb;
  if (i == 6) return texture2D(map6, uv).rgb;
  if (i == 7) return texture2D(map7, uv).rgb;
  return texture2D(map8, uv).rgb;
}

/** 並べた絵の上の位置 s (絵の横幅 = 1)、高さ v の色。つなぎ目は溶かす */
vec3 seq(float s, float v) {
  float total = float(count) * period;
  s = mod(s, total);
  int i = int(min(floor(s / period), float(count - 1)));
  float local = s - float(i) * period;
  v = clamp(v, texelV * 0.5, 1.0 - texelV * 0.5);
  vec3 c = tex(i, vec2(local, v));
  if (seam > 0.0 && local < seam) {
    int p = i == 0 ? count - 1 : i - 1;
    float w = smoothstep(0.0, 1.0, local / seam);
    c = mix(tex(p, vec2(local + period, v)), c, w);
  }
  return c;
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  // 画面の高さ = 絵の高さ。画面が絵より横長なら、横をそろえて上下を切る
  float z = max(1.0, aspect / imgAspect);
  float v = 0.5 + (vUv.y - 0.5) / z;
  float s = scroll + vUv.x * aspect / (imgAspect * z);

  vec3 col;
  if (blur > 0.0001) {
    // 円の中の 16 か所 (黄金角で並べる) + 真ん中を、中ほど重く混ぜる
    col = seq(s, v);
    float wsum = 1.0;
    for (int k = 0; k < 16; k++) {
      float r = sqrt((float(k) + 0.5) / 16.0);
      float a = float(k) * 2.39996;
      vec2 d = vec2(cos(a), sin(a)) * r * blur;
      float w = exp(-r * r * 2.0);
      col += seq(s + d.x / imgAspect, v + d.y) * w;
      wsum += w;
    }
    col /= wsum;
  } else {
    col = seq(s, v);
  }
  col *= brightness;

  // きらめき: 升 (絵の高さの 1/28) ごとに 1 か所。まわりより明るい所だけ
  if (sparkle > 0.001) {
    float cs = 1.0 / 28.0;
    vec2 g = vec2(mod(s, float(count) * period) * imgAspect, v) / cs;
    vec2 cell = floor(g);
    float h0 = hash(cell);
    if (h0 < 0.35 + 0.5 * sparkle) {
      vec2 pos = 0.25 + 0.5 * vec2(hash(cell + 7.1), hash(cell + 3.7));
      vec2 center = (cell + pos) * cs;
      float cS = center.x / imgAspect;
      float here = lum(seq(cS, center.y));
      float e = 0.012;
      float around = 0.25 * (lum(seq(cS + e / imgAspect, center.y)) + lum(seq(cS - e / imgAspect, center.y)) + lum(seq(cS, center.y + e)) + lum(seq(cS, center.y - e)));
      float bright = smoothstep(0.05, 0.2, here - around) * smoothstep(0.1, 0.4, here);
      if (bright > 0.0) {
        float phase = hash(cell + 1.3) * 6.2831;
        float rate = 1.2 + 2.5 * hash(cell + 9.2);
        float tw = pow(max(0.0, sin(time * rate + phase)), 6.0);
        vec2 d = (g - cell - pos) * cs;
        float size = 0.004 * (0.7 + 0.6 * hash(cell + 4.4));
        float core = exp(-dot(d, d) / (size * size));
        float rayH = exp(-abs(d.y) / (size * 0.18)) * exp(-abs(d.x) / (size * 3.5));
        float rayV = exp(-abs(d.x) / (size * 0.18)) * exp(-abs(d.y) / (size * 3.5));
        float star = core + 0.8 * (rayH + rayV);
        vec3 tint = mix(vec3(1.0), seq(cS, center.y) / max(0.001, here), 0.35);
        col += tint * star * tw * bright * sparkle * (1.6 + 2.0 * sparkleBoost);
      }
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createCityMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'CityScroll',
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      map0: { value: null },
      map1: { value: null },
      map2: { value: null },
      map3: { value: null },
      map4: { value: null },
      map5: { value: null },
      map6: { value: null },
      map7: { value: null },
      map8: { value: null },
      count: { value: 1 },
      period: { value: 1 - SEAM },
      seam: { value: SEAM },
      imgAspect: { value: 5 },
      aspect: { value: 16 / 9 },
      scroll: { value: 0 },
      blur: { value: 0 },
      texelV: { value: 1 / 400 },
      time: { value: 0 },
      sparkle: { value: 0 },
      sparkleBoost: { value: 0 },
      brightness: { value: 1 },
    },
  });
}

/** 舞うものの種類 → シェーダーの番号 */
export const PARTICLE_CODE: Record<ParticleKind, number> = { petals: 0, snow: 1, leaves: 2, lights: 3, confetti: 4 };

const PVERT = /* glsl */ `
attribute vec4 seedA;
attribute vec4 seedB;
uniform float time;
uniform float drift;
uniform float aspect;
uniform float sizeScale;
uniform int kind;
varying vec2 vLocal;
varying vec4 vSeed;
varying float vFade;
varying float vFlip;
void main() {
  float depth = seedA.w;
  float speed = mix(0.45, 1.0, depth);
  float fall = kind == 1 ? 0.05 : (kind == 3 ? -0.025 : 0.08);
  float y = fract(seedA.y + time * fall * speed * (0.8 + 0.4 * seedB.x));
  // 上から下へ (光の粒は下から上へ)
  float sy = kind == 3 ? -0.1 + 1.2 * y : 1.1 - 1.2 * y;
  float sway = sin(time * (0.6 + 0.8 * seedB.y) + seedB.z * 6.2831) * 0.03 * (kind == 3 ? 0.4 : 1.0);
  // 景色といっしょに流れる (手前ほど速い)
  float x = fract(seedA.x + drift * mix(0.7, 1.3, depth) + sway);
  float sx = -0.1 + 1.2 * x;
  float size = mix(0.02, 0.05, depth) * sizeScale * (kind == 3 ? 0.8 : 1.0);
  float ang = time * (0.4 + 1.6 * seedB.w) * (seedB.x > 0.5 ? 1.0 : -1.0) + seedB.z * 6.2831;
  // ひらひら: 横の幅が裏返るように変わる (雪と光の粒は回さない)
  float flip = (kind == 1 || kind == 3) ? 1.0 : cos(time * (1.0 + 2.0 * seedB.y) + seedA.z * 6.2831);
  vec2 p = position.xy * vec2(max(0.15, abs(flip)), 1.0);
  float c = cos(ang);
  float s = sin(ang);
  if (kind == 1 || kind == 3) { c = 1.0; s = 0.0; }
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) * size;
  vLocal = position.xy * 2.0;
  vSeed = seedB;
  vFlip = flip;
  vFade = smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.92, 1.0, y));
  gl_Position = vec4(sx * 2.0 - 1.0 + p.x * 2.0 / aspect, sy * 2.0 - 1.0 + p.y * 2.0, 0.0, 1.0);
}
`;

const PFRAG = /* glsl */ `
uniform int kind;
uniform float opacity;
uniform float glow;
varying vec2 vLocal;
varying vec4 vSeed;
varying float vFade;
varying float vFlip;
void main() {
  vec2 p = vLocal;
  float a = 0.0;
  vec3 col = vec3(1.0);
  if (kind == 0) {
    // 花びら: 先に切れ込みのある、しずくの形。桜色〜白
    float y = p.y * 0.5 + 0.5;
    float w = 0.62 * sin(3.1416 * pow(clamp(y, 0.0, 1.0), 0.8));
    float notch = smoothstep(0.0, 0.18, abs(p.x) + (1.0 - y) * 0.2) ;
    a = (1.0 - smoothstep(w - 0.08, w, abs(p.x))) * step(0.0, y) * step(y, 1.0);
    a *= mix(1.0, notch, step(0.85, y));
    col = mix(vec3(1.0, 0.62, 0.78), vec3(1.0, 0.92, 0.95), vSeed.x);
    col *= 0.85 + 0.25 * (1.0 - abs(p.x));
  } else if (kind == 1) {
    // 雪: やわらかい丸
    a = 1.0 - smoothstep(0.2, 1.0, length(p));
    col = vec3(1.0);
  } else if (kind == 2) {
    // 木の葉: 両端のとがった形と、真ん中の筋。緑〜黄色
    float w = 0.55 * (1.0 - p.y * p.y);
    a = 1.0 - smoothstep(w - 0.08, w, abs(p.x));
    a *= step(abs(p.y), 1.0);
    col = mix(vec3(0.35, 0.62, 0.22), vec3(0.95, 0.75, 0.25), vSeed.x * vSeed.x);
    col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.06, abs(p.x)));
  } else if (kind == 3) {
    // 光の粒: 真ん中が強く光る丸 (足し合わせて描く)
    float d = length(p);
    a = exp(-d * d * 9.0) * 0.9 + 0.35 * exp(-d * d * 2.5);
    a *= 1.0 - smoothstep(0.7, 1.0, d);
    col = mix(vec3(1.0, 0.7, 0.3), vec3(1.0, 0.88, 0.6), vSeed.x) * (1.2 + 1.5 * glow);
  } else {
    // 紙ふぶき: 細長い四角。明るい色
    a = step(abs(p.x), 0.5) * step(abs(p.y), 0.9);
    float h = vSeed.x * 6.0;
    col = clamp(abs(mod(h + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0) * 0.8 + 0.2;
  }
  // 裏返るときは少し暗く
  col *= 0.75 + 0.25 * abs(vFlip);
  a *= vFade * opacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
}
`;

export function createParticleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'CityScrollParticles',
    vertexShader: PVERT,
    fragmentShader: PFRAG,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    uniforms: {
      time: { value: 0 },
      drift: { value: 0 },
      aspect: { value: 16 / 9 },
      sizeScale: { value: 1 },
      kind: { value: 0 },
      opacity: { value: 1 },
      glow: { value: 0 },
    },
  });
}
