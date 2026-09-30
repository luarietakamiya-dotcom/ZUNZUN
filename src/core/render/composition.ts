import { BASE_LAYERS, defaultComposition, type CompositionSettings, type VisualizerBlend } from '../types';

/**
 * レイヤーの順番の扱い (純粋な関数。Vitest で確かめる)。docs/ARCHITECTURE.md「レイヤー」。
 * 順番は奥 → 手前。決まったレイヤー (背景・ビジュアライザー・歌詞・重ねる画像) と、素材のレイヤー ('media:<id>')。
 */

const MEDIA_ID = /^media:[A-Za-z0-9_-]{1,64}$/;
export const isMediaLayer = (id: string): boolean => MEDIA_ID.test(id);
const isKnown = (id: string): boolean => (BASE_LAYERS as readonly string[]).includes(id) || isMediaLayer(id);

const unit = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const blendOf = (v: unknown, d: VisualizerBlend): VisualizerBlend => (v === 'screen' || v === 'add' || v === 'over' ? v : d);

/**
 * 壊れた値を直す。順番は重複と知らないものを捨て、足りない決まったレイヤーは既定の位置に足す。
 * mediaIds を渡すと、そこに無い素材のレイヤーは捨て、順番に無い素材は手前に足す。
 * legacy は古いプロジェクトの背景の設定 (blend / visualizerOpacity) で、composition が無いときにだけ使う
 */
export function normalizeComposition(
  raw: unknown,
  opts: { mediaIds?: readonly string[]; legacy?: { blend?: unknown; visualizerOpacity?: unknown } | null } = {},
): CompositionSettings {
  const d = defaultComposition();
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const media = opts.mediaIds ? new Set(opts.mediaIds.map((m) => `media:${m}`)) : null;
  const keep = (id: string): boolean => isKnown(id) && (!isMediaLayer(id) || !media || media.has(id));
  const order: string[] = [];
  for (const id of Array.isArray(r?.order) ? r.order : []) if (typeof id === 'string' && keep(id) && !order.includes(id)) order.push(id);
  // 足りない決まったレイヤーは、既定の順番で隣にあるものの後ろに入れる
  BASE_LAYERS.forEach((id, k) => {
    if (order.includes(id)) return;
    const prev = BASE_LAYERS.slice(0, k).reverse().find((p) => order.includes(p));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, id);
  });
  if (media) for (const m of media) if (!order.includes(m)) order.push(m);
  const hidden = Array.isArray(r?.hidden) ? [...new Set(r.hidden.filter((id): id is string => typeof id === 'string' && order.includes(id)))] : [];
  const legacy = r ? null : opts.legacy;
  return {
    order,
    hidden,
    visualizerBlend: blendOf(r ? r.visualizerBlend : legacy?.blend, d.visualizerBlend),
    visualizerOpacity: unit(r ? r.visualizerOpacity : legacy?.visualizerOpacity, d.visualizerOpacity),
    lyricsOpacity: unit(r?.lyricsOpacity, d.lyricsOpacity),
  };
}

/** レイヤーを 1 つ手前 (dir = 1) か奥 (dir = -1) へ動かした順番 */
export function moveLayer(order: readonly string[], id: string, dir: 1 | -1): string[] {
  const out = [...order];
  const i = out.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/**
 * 1 コマの描き方。draw = 描くレイヤー (奥 → 手前)。
 * fast = ビジュアライザーより奥にあるのが背景だけ (か何も無い) → 今までどおり、ビジュアライザーを画面へ直接描いてから背景を
 * 上から重ねる (スクリーン・加算は順番を入れ替えても同じ結果。'over' も式で合わせてある)。そうでなければ、ビジュアライザーを
 * 描いた画面を写し取ってから、奥から順に重ね直す
 */
export function framePlan(c: CompositionSettings, available: (id: string) => boolean): { draw: string[]; fast: boolean } {
  const draw = c.order.filter((id) => !c.hidden.includes(id) && available(id));
  const vi = draw.indexOf('visualizer');
  const fast = vi < 0 ? false : draw.slice(0, vi).every((id) => id === 'background');
  return { draw, fast };
}
