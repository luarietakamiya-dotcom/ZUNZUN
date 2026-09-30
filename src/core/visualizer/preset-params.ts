import type { PresetControl } from '../types';

/**
 * プリセットだけの設定 (manifest.controls) の値の扱い (純粋な関数)。
 * 保存された値 (Project JSON の visualizer.params[プリセットの id]) は、そのプリセットの設定の一覧に合わせて
 * 直してから使う: 知らない名前は捨て、範囲の外は収め、選べない値・無い値は既定にする。
 */

export type PresetParamValues = Record<string, number | string>;

export function resolvePresetParams(controls: readonly PresetControl[] | undefined, saved: unknown): PresetParamValues {
  const src = saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  const out: PresetParamValues = {};
  for (const c of controls ?? []) {
    const v = src[c.key];
    if (c.type === 'range') {
      out[c.key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(c.max, Math.max(c.min, v)) : c.default;
    } else {
      out[c.key] = typeof v === 'string' && c.options.some((o) => o.value === v) ? v : c.default;
    }
  }
  return out;
}

/**
 * Project JSON の visualizer.params を読むときの片づけ: { プリセットの id: { 名前: 数か文字 } } の形だけを残す
 * (中身の範囲はプリセットの設定の一覧を知っている resolvePresetParams で直す)
 */
export function sanitizePresetParamsMap(raw: unknown): Record<string, PresetParamValues> {
  const out: Record<string, PresetParamValues> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, vals] of Object.entries(raw as Record<string, unknown>).slice(0, 64)) {
    if (!/^[a-z0-9-]{1,64}$/.test(id) || !vals || typeof vals !== 'object' || Array.isArray(vals)) continue;
    const clean: PresetParamValues = {};
    for (const [k, v] of Object.entries(vals as Record<string, unknown>).slice(0, 64)) {
      if (!/^[A-Za-z0-9_]{1,64}$/.test(k)) continue;
      if ((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 64)) clean[k] = v;
    }
    out[id] = clean;
  }
  return out;
}
