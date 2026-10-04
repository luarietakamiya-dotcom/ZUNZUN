import type { LyricsEffectGroup, LyricsLineMotion, LyricsMotion } from '../types';

export const EFFECT_GROUPS: readonly LyricsEffectGroup[] = ['layout', 'enter', 'hold', 'exit', 'decor', 'treat', 'cam', 'fx', 'trans'];
const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const object = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && ID.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);

/** 保存ファイルの固定カットはJSON値だけを複製し、極端な深さ・大きさを受け付けない。 */
function copyJson(v: unknown, depth = 0): unknown {
  if (depth > 10) return null;
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.slice(0, 10000);
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (Array.isArray(v)) return v.slice(0, 512).map((x) => copyJson(x, depth + 1));
  if (!object(v)) return null;
  return Object.fromEntries(Object.entries(v).slice(0, 128).filter(([k]) => !['__proto__', 'constructor', 'prototype'].includes(k)).map(([k, x]) => [k, copyJson(x, depth + 1)]));
}

export function sanitizeMotionEdits(raw: Record<string, unknown>): Pick<LyricsMotion, 'effects' | 'lines'> {
  const result: Pick<LyricsMotion, 'effects' | 'lines'> = {};
  if (object(raw.effects)) {
    result.effects = {};
    for (const group of EFFECT_GROUPS) {
      const values = raw.effects[group];
      if (object(values)) result.effects[group] = Object.fromEntries(Object.entries(values).slice(0, 1000).filter(([k, v]) => id(k) && typeof v === 'boolean')) as Record<string, boolean>;
    }
  }
  if (object(raw.lines)) {
    result.lines = {};
    for (const [key, value] of Object.entries(raw.lines).slice(0, 5000)) {
      if (!/^(0|[1-9]\d{0,4})$/.test(key) || !object(value) || typeof value.text !== 'string') continue;
      const line: LyricsLineMotion = { text: value.text.slice(0, 10000) };
      for (const g of ['layout', 'enter', 'hold', 'exit', 'treat', 'cam'] as const) if (id(value[g])) line[g] = value[g];
      if (Array.isArray(value.decor)) line.decor = value.decor.filter(id).slice(0, 32);
      for (const k of ['cuts', 'seed', 'lockedSeed'] as const) if (typeof value[k] === 'number' && Number.isFinite(value[k])) line[k] = k === 'cuts' ? Math.max(1, Math.min(12, Math.round(value[k]))) : value[k] >>> 0;
      if (value.lock === true && Array.isArray(value.lockedCuts) && value.lockedCuts.length > 0 && value.lockedCuts.length <= 256) {
        const valid = value.lockedCuts.every((c) => object(c) && typeof c.utext === 'string' && ['layout', 'enter', 'exit', 'hold', 'treat', 'cam'].every((k) => id(c[k])) && object(c.params) && Array.isArray(c.decor) && c.decor.every((d) => object(d) && id(d.id)) && ['inDur', 'outDur', 'scheme', 'seed'].every((k) => typeof c[k] === 'number' && Number.isFinite(c[k])));
        if (valid) {
          line.lock = true;
          line.lockedCuts = copyJson(value.lockedCuts) as Record<string, unknown>[];
        }
      }
      result.lines[key] = line;
    }
  }
  return result;
}

/** スタイル・パックの既定を適用した後でユーザーの指定を反映する。 */
export function applyMotionEdits(project: Record<string, unknown>, motion: LyricsMotion, texts: readonly string[], blocked: Partial<Record<LyricsEffectGroup, readonly string[]>> = {}): void {
  const enabled = project.enabled as Record<string, Record<string, boolean>>;
  for (const group of EFFECT_GROUPS) {
    enabled[group] = { ...(enabled[group] ?? {}), ...(motion.effects?.[group] ?? {}) };
    for (const key of blocked[group] ?? []) enabled[group][key] = false;
  }
  const overrides: Record<string, Record<string, unknown>> = Object.fromEntries(Object.entries(motion.lines ?? {}).filter(([key, value]) => texts[Number(key)] === value.text).map(([key, value]) => {
    const override = { ...structuredClone(value) };
    if (override.lockedCuts?.some((cut) => blocked.layout?.includes(String(cut.layout)))) {
      delete override.lock;
      delete override.lockedCuts;
      delete override.lockedSeed;
    }
    for (const group of ['layout', 'enter', 'exit', 'hold', 'treat', 'cam'] as const) if (blocked[group]?.includes(override[group] ?? '')) delete override[group];
    return [key, override];
  }));
  // 自動の場面転換が、手で選んだ登場・退場を「カット」に置き換えないようにする。
  for (let index = 0; index < texts.length; index++) {
    const current = overrides[String(index)];
    const previous = overrides[String(index - 1)];
    if (current?.lock) continue;
    const all = !!(current?.enter || current?.exit);
    if (!all && !previous?.exit) continue;
    const value = current ?? (overrides[String(index)] = {});
    const count = all ? Math.min(256, Math.max(Number(value.cuts) || 0, [...texts[index]!].length * 3 + 3)) : 1;
    value.cutTech = Object.fromEntries(Array.from({ length: count }, (_, k) => [String(k), { trans: 'none' }]));
  }
  project.overrides = overrides;
}
