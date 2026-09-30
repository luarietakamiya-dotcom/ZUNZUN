import type { ChromaKey } from '../types';

/**
 * クロマキー (決めた色を透かす) の計算。GPU のシェーダー (CHROMA_GLSL) と同じ式を TypeScript でも持ち、Vitest で確かめる。
 * - 「透かす色らしさ」= 透かす色でいちばん強い色の成分 (グリーンバックなら緑) が、ほかの成分よりどれだけ強いかを、
 *   その画素の明るさで割った割合。明るさで割るので、影で暗くなった緑も明るい緑と同じように透ける
 *   (最初は色み (YCbCr の Cb・Cr) の距離で測ったが、暗い緑は色みが小さくなって透けなかった)
 * - 透かす色そのものの「らしさ」を 1 として、1 − tolerance より近ければ透明、そこから softness の幅でなめらかに不透明へ
 * - ほぼ黒い画素は透かさない (黒い髪・服に少し緑がかかっていても消えないように)
 * - spill: 透かす色らしい画素ほど、強い成分をほかの成分まで下げて、縁に残る緑のにじみを消す
 * - choke (縁を削る): まわりの画素の透明度のいちばん小さい値を使い、残る所の縁を内側へ削る (erodeAlpha。シェーダーは media.ts)
 * - autoChroma: 絵全体から背景の緑 (か青) を見つけ、透かす色と範囲を「背景がほぼ全部透ける値」に決める
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
export function chromaUniforms(k: ChromaKey): { mask: [number, number, number]; keyKeyness: number; tol: number; soft: number; spill: number; chokePx: number } {
  const key = hexToRgb01(k.color);
  const p = primaryOf(key);
  const mask: [number, number, number] = [0, 0, 0];
  mask[p] = 1;
  return {
    mask,
    keyKeyness: Math.max(0.05, keyness(key, p)),
    tol: clamp01(k.tolerance),
    soft: Math.max(0.001, clamp01(k.softness) * 0.5),
    spill: clamp01(k.spill),
    chokePx: clamp01(Number.isFinite(k.choke) ? k.choke : 0) * CHOKE_MAX_PX,
  };
}

/** 縁を削る量 1 のときに見る距離 (素材の画素) */
export const CHOKE_MAX_PX = 3;

/** 縁を削る: 真ん中とまわり (上下左右と斜め) の透明度のうち、いちばん小さい値 (シェーダーと同じ。削らないなら真ん中の値) */
export function erodeAlpha(center: number, neighbors: readonly number[], chokePx: number): number {
  if (!(chokePx > 0)) return center;
  return Math.min(center, ...neighbors);
}

/**
 * 絵 (RGBA の並び、0..255) から背景の色を見つけて、透かす色と範囲を決める。見つからなければ null。
 * - 緑が強い画素と青が強い画素の数を比べ、多い方を背景の色とする (全体の 3% 未満なら「無い」)
 * - その画素のうち、とくに色の強い半分の平均を透かす色にする
 * - 背景の画素の 95% が完全に透ける範囲にする (むら・影の少し暗い緑まで消えるように。上げすぎると人まで透けるので 0.75 まで)
 */
export function autoChroma(data: ArrayLike<number>): Pick<ChromaKey, 'color' | 'tolerance' | 'softness' | 'spill' | 'choke'> | null {
  const n = Math.floor(data.length / 4);
  if (n === 0) return null;
  const cand: [number[], number[]] = [[], []];
  const rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    rgb[0] = (data[i * 4] ?? 0) / 255;
    rgb[1] = (data[i * 4 + 1] ?? 0) / 255;
    rgb[2] = (data[i * 4 + 2] ?? 0) / 255;
    for (const [slot, p] of [
      [0, 1],
      [1, 2],
    ] as const) {
      if (rgb[p] > 0.06 && keyness(rgb, p) > 0.25) cand[slot].push(i);
    }
  }
  const slot = cand[0].length >= cand[1].length ? 0 : 1;
  const p = slot === 0 ? 1 : 2;
  const ids = cand[slot];
  if (ids.length < n * 0.03) return null;
  const px = (i: number): [number, number, number] => [(data[i * 4] ?? 0) / 255, (data[i * 4 + 1] ?? 0) / 255, (data[i * 4 + 2] ?? 0) / 255];
  const scored = ids.map((i) => ({ i, k: keyness(px(i), p) })).sort((a, b) => b.k - a.k);
  const top = scored.slice(0, Math.max(1, Math.floor(scored.length / 2)));
  const avg: [number, number, number] = [0, 0, 0];
  for (const { i } of top) {
    const c = px(i);
    for (let j = 0; j < 3; j++) avg[j] = avg[j]! + c[j]! / top.length;
  }
  const color = '#' + avg.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');
  // 背景の画素ごとの「透かす色らしさ」(applyChroma と同じ式) の、下から 5% の値が、ちょうど透ける境目になる範囲
  const keyK = Math.max(0.05, keyness(hexToRgb01(color), p));
  const rels = ids.map((i) => {
    const c = px(i);
    return (keyness(c, p) / keyK) * smoothstep(0.02, 0.12, c[p]!);
  });
  rels.sort((a, b) => a - b);
  const p5 = rels[Math.floor(rels.length * 0.05)] ?? 1;
  const tolerance = Math.min(0.75, Math.max(0.15, 1 - p5 + 0.03));
  return { color, tolerance, softness: 0.12, spill: 0.85, choke: 0.35 };
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
