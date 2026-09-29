import type { BackgroundSettings } from '../types';

/**
 * 背景の画像・動画から色を読み取る (オリジナルの歌詞モーション「動画に寄り添う」が文字の色に使う)。
 * - extractPalette: 画素から「暗い色・明るい色・差し色 2 つ」を取り出す (純粋な関数。テストあり)
 * - backgroundPalette: 背景のファイルから読み取る (画像は縮めて 1 枚、動画は決まった 5 つの時刻のコマ)。
 *   同じファイル (sha256) なら覚えておいた結果を返す。プレビューと書き出しで同じ色になる
 */

export interface BgPalette {
  /** 暗い色 (影・読みやすさのための縁取りに使う) */
  dark: string;
  /** 明るい色 */
  light: string;
  /** いちばん目立つ色み */
  accent: string;
  /** 2 番目の色み (色相が離れたもの。無ければ accent を少しずらしたもの) */
  accent2: string;
}

const hex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return hex(f(0) * 255, f(8) * 255, f(4) * 255);
}

export function hexToHsl(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return toHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** RGBA の画素 (4 つずつ) から色を読み取る */
export function extractPalette(rgba: Uint8ClampedArray | Uint8Array): BgPalette {
  const n = Math.floor(rgba.length / 4);
  if (n === 0) return { dark: '#08090c', light: '#eeeeee', accent: '#9fb8d6', accent2: '#d6b89f' };
  const lums: { l: number; i: number }[] = [];
  const BINS = 24;
  const bins = Array.from({ length: BINS }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    const [h, s, l] = toHsl(r, g, b);
    lums.push({ l, i });
    // 色み: 彩度があり、暗すぎも明るすぎもしない画素だけ
    if (s > 0.2 && l > 0.12 && l < 0.9) {
      const k = Math.min(BINS - 1, Math.floor(h * BINS));
      const w = s * (1 - Math.abs(l - 0.5));
      const bin = bins[k]!;
      bin.w += w;
      bin.r += r * w;
      bin.g += g * w;
      bin.b += b * w;
    }
  }
  lums.sort((a, b) => a.l - b.l);
  const avg = (from: number, to: number): string => {
    let r = 0;
    let g = 0;
    let b = 0;
    let c = 0;
    for (let k = Math.floor(from * n); k < Math.max(Math.floor(from * n) + 1, Math.floor(to * n)); k++) {
      const i = lums[Math.min(n - 1, k)]!.i;
      r += rgba[i * 4]!;
      g += rgba[i * 4 + 1]!;
      b += rgba[i * 4 + 2]!;
      c++;
    }
    return hex(r / c, g / c, b / c);
  };
  const dark = avg(0, 0.12);
  const light = avg(0.88, 1);
  // 隣の区間とならした重みで、いちばん重い色相と、それから 60° 以上離れた 2 番目
  const smooth = bins.map((_, k) => bins[k]!.w + 0.5 * (bins[(k + 1) % BINS]!.w + bins[(k + BINS - 1) % BINS]!.w));
  const order = smooth.map((w, k) => ({ w, k })).sort((a, b) => b.w - a.w || a.k - b.k);
  const colorOf = (k: number): string | null => {
    const bin = bins[k]!;
    return bin.w > 0 ? hex(bin.r / bin.w, bin.g / bin.w, bin.b / bin.w) : null;
  };
  const first = order[0]!.w > 0 ? order[0]!.k : -1;
  const second = first >= 0 ? order.find((o) => o.w > 0 && Math.min(Math.abs(o.k - first), BINS - Math.abs(o.k - first)) >= BINS / 6) : undefined;
  const [lh] = hexToHsl(light);
  const accent = (first >= 0 && colorOf(first)) || hslToHex(lh, 0.35, 0.7);
  const [ah, as, al] = hexToHsl(accent);
  const accent2 = (second && colorOf(second.k)) || hslToHex((ah + 0.08) % 1, as, al);
  return { dark, light, accent, accent2 };
}

/** 読み取った色から、文字の配色を作る (文字は明るく読みやすく、差し色は背景の色みのまま明るさだけ上げる) */
export function paletteToScheme(p: BgPalette): { bg: string; fg: string; sub: string; accent: string; accent2: string; ink: string; dim: string; ghostA: string; ghostB: string } {
  const [lh, ls] = hexToHsl(p.light);
  // 文字: 明るい色の色みをほんの少し残した、ほぼ白
  const fg = hslToHex(lh, Math.min(0.25, ls), 0.92);
  const sub = hslToHex(lh, Math.min(0.2, ls), 0.74);
  const lift = (c: string): string => {
    const [h, s] = hexToHsl(c);
    return hslToHex(h, Math.min(0.7, Math.max(0.3, s)), 0.72);
  };
  const accent = lift(p.accent);
  const accent2 = lift(p.accent2);
  const [dh, ds] = hexToHsl(p.dark);
  const bg = hslToHex(dh, Math.min(0.4, ds), 0.06);
  return { bg, fg, sub, accent, accent2, ink: fg, dim: hslToHex(dh, Math.min(0.4, ds), 0.12), ghostA: accent, ghostB: accent2 };
}

// ------------------------------------------------------------------ 背景のファイルから読む (ブラウザ)

const cache = new Map<string, BgPalette>();
const pending = new Map<string, Promise<BgPalette | null>>();
/** 読み取りに使う大きさ (画素) */
const SAMPLE_W = 64;
const SAMPLE_H = 36;

async function pixelsOfImage(file: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(file, { resizeWidth: SAMPLE_W, resizeHeight: SAMPLE_H, resizeQuality: 'medium' });
  try {
    const c = document.createElement('canvas');
    c.width = SAMPLE_W;
    c.height = SAMPLE_H;
    const g = c.getContext('2d');
    if (!g) throw new Error('2D canvas が使えません');
    g.drawImage(bitmap, 0, 0);
    return g.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
  } finally {
    bitmap.close();
  }
}

async function pixelsOfVideo(file: Blob): Promise<Uint8ClampedArray> {
  const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error('動画を読めません');
    const first = await track.getFirstTimestamp();
    const end = await track.computeDuration();
    const sink = new CanvasSink(track, { width: SAMPLE_W, height: SAMPLE_H, fit: 'fill' });
    // 決まった 5 つの時刻 (10% 〜 90%)
    const times = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => first + (end - first) * f);
    const out = new Uint8ClampedArray(SAMPLE_W * SAMPLE_H * 4 * times.length);
    const c = document.createElement('canvas');
    c.width = SAMPLE_W;
    c.height = SAMPLE_H;
    const g = c.getContext('2d');
    if (!g) throw new Error('2D canvas が使えません');
    let k = 0;
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      if (wc) {
        g.clearRect(0, 0, SAMPLE_W, SAMPLE_H);
        g.drawImage(wc.canvas, 0, 0, SAMPLE_W, SAMPLE_H);
        out.set(g.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data, k * SAMPLE_W * SAMPLE_H * 4);
      }
      k++;
    }
    return out;
  } finally {
    input.dispose();
  }
}

/** 背景の色を読み取る (同じファイルなら覚えておいたものを返す)。背景が無ければ null */
export async function backgroundPalette(settings: BackgroundSettings | null, file: Blob | null): Promise<BgPalette | null> {
  if (!settings || !file) return null;
  const key = settings.sha256;
  const hit = cache.get(key);
  if (hit) return hit;
  let job = pending.get(key);
  if (!job) {
    job = (settings.kind === 'video' ? pixelsOfVideo(file) : pixelsOfImage(file))
      .then((px) => {
        const pal = extractPalette(px);
        cache.set(key, pal);
        return pal;
      })
      .catch(() => null)
      .finally(() => pending.delete(key));
    pending.set(key, job);
  }
  return job;
}

/** プレビュー用: 覚えてあればすぐ返し、無ければ読み取りを始めて null を返す (毎フレーム呼んでよい) */
export function backgroundPaletteNow(settings: BackgroundSettings | null, file: Blob | null): BgPalette | null {
  if (!settings || !file) return null;
  const hit = cache.get(settings.sha256);
  if (hit) return hit;
  void backgroundPalette(settings, file);
  return null;
}
