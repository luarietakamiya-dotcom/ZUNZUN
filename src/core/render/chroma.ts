import type { ChromaKey } from '../types';

/**
 * クロマキー (決めた色を透かす) の計算。GPU のシェーダー (CHROMA_GLSL) と同じ式を TypeScript でも持ち、Vitest で確かめる。
 * - 「透かす色らしさ」= 透かす色でいちばん強い色の成分 (グリーンバックなら緑) が、ほかの成分よりどれだけ強いかを、
 *   その画素の明るさで割った割合。明るさで割るので、影で暗くなった緑も明るい緑と同じように透ける
 *   (最初は色み (YCbCr の Cb・Cr) の距離で測ったが、暗い緑は色みが小さくなって透けなかった)
 * - 透かす色そのものの「らしさ」を 1 として、1 − tolerance より近ければ透明、そこから softness の幅でなめらかに不透明へ
 * - ほぼ黒い画素は透かさない (黒い髪・服に少し緑がかかっていても消えないように)
 * - spill: 透かす色らしい画素ほど、強い成分をほかの成分まで下げて、縁に残る緑のにじみを消す
 */

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
};

export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0x00ff00;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 透かす色でいちばん強い成分の番号 (0 = 赤、1 = 緑、2 = 青) */
function primaryOf(k: [number, number, number]): number {
  return k[1] >= k[0] && k[1] >= k[2] ? 1 : k[2] >= k[0] ? 2 : 0;
}

/** 「透かす色らしさ」(強い成分がほかよりどれだけ強いか ÷ 強い成分) */
function keyness(c: [number, number, number], p: number): number {
  const others = Math.max(...c.filter((_v, i) => i !== p));
  return (c[p]! - others) / Math.max(1e-3, c[p]!);
}

/** シェーダーに渡す値 */
export function chromaUniforms(k: ChromaKey): { mask: [number, number, number]; keyKeyness: number; tol: number; soft: number; spill: number } {
  const key = hexToRgb01(k.color);
  const p = primaryOf(key);
  const mask: [number, number, number] = [0, 0, 0];
  mask[p] = 1;
  return { mask, keyKeyness: Math.max(0.05, keyness(key, p)), tol: clamp01(k.tolerance), soft: Math.max(0.001, clamp01(k.softness) * 0.5), spill: clamp01(k.spill) };
}

/** 1 画素のクロマキー。rgb は 0..1。戻り値は [r, g, b, 透明度 (0 = 透ける)] */
export function applyChroma(rgb: [number, number, number], k: ChromaKey): [number, number, number, number] {
  if (!k.enabled) return [rgb[0], rgb[1], rgb[2], 1];
  const u = chromaUniforms(k);
  const p = u.mask.indexOf(1);
  const rel = (keyness(rgb, p) / u.keyKeyness) * smoothstep(0.02, 0.12, rgb[p]!);
  const alpha = 1 - smoothstep(1 - u.tol - u.soft, 1 - u.tol, rel);
  const amount = u.spill * clamp01(rel);
  const others = Math.max(...rgb.filter((_v, i) => i !== p));
  const out: [number, number, number] = [rgb[0], rgb[1], rgb[2]];
  out[p] = rgb[p]! + (Math.min(rgb[p]!, others) - rgb[p]!) * amount;
  return [out[0], out[1], out[2], alpha];
}

/** シェーダー用 (applyChroma と同じ式)。uniform: chromaOn, chromaMask, chromaKeyness, chromaTol, chromaSoft, chromaSpill */
export const CHROMA_GLSL = /* glsl */ `
uniform float chromaOn;
uniform vec3 chromaMask;
uniform float chromaKeyness;
uniform float chromaTol;
uniform float chromaSoft;
uniform float chromaSpill;
vec4 zzChroma(vec3 rgb) {
  if (chromaOn < 0.5) return vec4(rgb, 1.0);
  float prim = dot(rgb, chromaMask);
  vec3 o = rgb * (vec3(1.0) - chromaMask);
  float others = max(max(o.r, o.g), o.b);
  float rel = ((prim - others) / max(0.001, prim)) / chromaKeyness * smoothstep(0.02, 0.12, prim);
  float alpha = 1.0 - smoothstep(1.0 - chromaTol - chromaSoft, 1.0 - chromaTol, rel);
  float amount = chromaSpill * clamp(rel, 0.0, 1.0);
  float lowered = prim + (min(prim, others) - prim) * amount;
  vec3 outc = rgb * (vec3(1.0) - chromaMask) + chromaMask * lowered;
  return vec4(outc, alpha);
}
`;
