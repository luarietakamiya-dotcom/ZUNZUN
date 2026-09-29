import { CUSTOM_STYLE_KEY, type LyricsMotion } from '../../types';
import { calmPack } from './calm';
import { intensePack } from './intense';
import type { MotionPack, PackJ } from './types';

/**
 * オリジナルの歌詞モーション (演出パック) の一覧と、JIZURA への登録・プロジェクトへの反映。
 * パックを足すときは、ここの PACKS に 1 行足す。
 */
export const PACKS: readonly MotionPack[] = [calmPack, intensePack];

/** パックの演出とスタイルを JIZURA に登録する (何度呼んでも 1 回だけ) */
export function registerMotionPacks(J: PackJ & { __zunzunPacks?: boolean }): void {
  if (J.__zunzunPacks) return;
  for (const pack of PACKS) {
    for (const e of pack.effects(J)) J.register(e.group, e.key, { ...e.def, set: pack.set }, pack.id);
    J.STYLES[pack.styleKey] = pack.buildStyle(J);
  }
  J.__zunzunPacks = true;
}

/** 歌詞モーションの設定が使うパック (スタイルがパックのものか、それを元にしたマイスタイル)。無ければ null */
export function packForMotion(motion: Pick<LyricsMotion, 'style' | 'custom'>): MotionPack | null {
  const key = motion.style === CUSTOM_STYLE_KEY ? motion.custom?.base : motion.style;
  return PACKS.find((p) => p.styleKey === key) ?? null;
}

/** パックのスタイルで描くときに、JIZURA の project を調整する (部品セットをオンにし、パックの決まりを当てる) */
export function applyMotionPack(project: Record<string, unknown>, motion: Pick<LyricsMotion, 'style' | 'custom'>, J: PackJ): MotionPack | null {
  const pack = packForMotion(motion);
  if (!pack) return null;
  project[pack.set] = true;
  pack.configure?.(project, J);
  return pack;
}

/** パックのスタイルの一覧 (選択肢の表示用): [キー, 名前] */
export function packStyles(J: Pick<PackJ, 'STYLES'>): [string, string][] {
  return PACKS.filter((p) => J.STYLES[p.styleKey]).map((p) => [p.styleKey, J.STYLES[p.styleKey]!.name]);
}
