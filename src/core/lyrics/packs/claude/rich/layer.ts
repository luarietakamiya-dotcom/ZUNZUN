import type { LayoutEnv } from '../../design-kit';
import { easeInOut, easeOut } from '../../util';
import { cap } from '../skin';
import type { G } from './kit';

/**
 * 質感の層（背景・飛沫・筆跡など重い絵）は、カットごとに 1 枚のキャンバスへ描いて使い回す（キャッシュ）。
 * 毎コマは drawImage だけ。登場（滑り込み・ワイプ・ズーム）・拍の脈動・ゆっくりしたずれは、層ごとに変換で作る。
 */
const cache = new Map<string, HTMLCanvasElement>();
const MAX_ENTRIES = 24;

/** 層を取り出す（無ければ paint で描く）。描画面が無い環境（ユニットテスト）では null */
export function layerOf(key: string, W: number, H: number, paint: (g: G) => void, maxPx = 1280): HTMLCanvasElement | null {
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  if (typeof document === 'undefined') return null;
  const k = Math.min(1, maxPx / Math.max(W, H)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
  const g = c.getContext('2d');
  if (!g || typeof g.save !== 'function' || typeof g.scale !== 'function') return null;
  g.scale(k, k);
  try { paint(g); } catch { return null; }
  cache.set(key, c);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return c;
}

export type Enter = 'fade' | 'slideL' | 'slideR' | 'slideU' | 'slideD' | 'zoom' | 'wipeL' | 'wipeR' | 'none';
export interface Place {
  /** 登場の仕方 */
  enter?: Enter;
  /** 滑り込む距離（設計サイズの割合） */
  dist?: number;
  /** 拍の脈動（拡大の割合） */
  pulse?: number;
  /** ゆっくりしたずれ（設計サイズの割合、1 周 12 秒） */
  drift?: number;
  alpha?: number;
  /** 登場を遅らせる割合（0..1） */
  delay?: number;
  /** 縦に流れ続ける速さ（画面の高さ / 秒）。降る雪・文字の雨に使う（層を 2 枚つないで繰り返す） */
  scrollY?: number;
}

/** 層を env.ctx に重ねる。env.pass が main 以外のときは何もしない */
export function place(env: LayoutEnv, layer: HTMLCanvasElement | null, o: Place = {}, hit = 0, motion = 1): void {
  if (!layer || env.pass !== 'main') return;
  const g = env.ctx; if (typeof g.drawImage !== 'function') return;
  const { W, H } = env, d = o.delay ?? 0, q = easeOut(cap((env.pIn - d) / Math.max(0.05, 1 - d))), out = 1 - easeInOut(cap(env.pOut)), enter = o.enter ?? 'fade';
  let dx = 0, dy = 0, s = 1, a = (o.alpha ?? 1) * out, clip = 1;
  const dist = o.dist ?? 0.18;
  if (enter === 'fade') a *= q;
  else if (enter === 'slideL') { dx = -(1 - q) * W * dist; a *= cap(q * 3); }
  else if (enter === 'slideR') { dx = (1 - q) * W * dist; a *= cap(q * 3); }
  else if (enter === 'slideU') { dy = -(1 - q) * H * dist; a *= cap(q * 3); }
  else if (enter === 'slideD') { dy = (1 - q) * H * dist; a *= cap(q * 3); }
  else if (enter === 'zoom') { s = 1 + (1 - q) * 0.25; a *= cap(q * 2.5); }
  else if (enter === 'wipeL' || enter === 'wipeR') clip = q;
  s *= 1 + (o.pulse ?? 0) * hit;
  const drift = (o.drift ?? 0) * motion;
  dx += Math.sin(env.lt * 0.52) * W * drift; dy += Math.cos(env.lt * 0.41) * H * drift;
  if (a <= 0.003) return;
  g.save();
  g.globalAlpha = a;
  if (clip < 1) { g.beginPath(); if (enter === 'wipeL') g.rect(0, 0, W * clip, H); else g.rect(W * (1 - clip), 0, W * clip, H); g.clip(); }
  g.translate(W / 2 + dx, H / 2 + dy); g.scale(s, s); g.translate(-W / 2, -H / 2);
  if (o.scrollY) { const off = (((env.lt * o.scrollY * motion) % 1) + 1) % 1 * H; g.drawImage(layer, 0, off, W, H); g.drawImage(layer, 0, off - H, W, H); } else g.drawImage(layer, 0, 0, W, H);
  g.restore();
}

/** 背景を塗る強さ。装飾（fx.decor）が低いと透け、0 で文字だけ。既定の 0.5 で全面に描く */
export const richOf = (env: LayoutEnv): number => cap((env.fx.decor ?? 0.5) / 0.4);
