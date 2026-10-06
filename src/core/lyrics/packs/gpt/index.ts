import { hyperPack } from '../kinetic-packs';
import type { MotionPack, PackJ } from '../types';

// GPT自身の改訂Hyperを競作用に分離。既存プリセット・Claude版の登録を変更しない。
const set = 'vsgHyper';
const effects = (J: PackJ) => hyperPack.effects(J).map(e => ({
  ...e, key: `vsg${e.key.slice(2)}`,
  def: { ...e.def, set, tags: ['Hyper.g'] },
}));
export const gptHyperPack: MotionPack = {
  id: 'visualsync-Hyper.g', styleKey: 'vs-hyper.g', set, effects,
  buildStyle(J) {
    const style = hyperPack.buildStyle(J);
    const bias: Record<string, Record<string, number>> = {};
    for (const e of effects(J)) (bias[e.group] ??= {})[e.key] = 10;
    return { ...style, name: 'ハイパー・ビート.g', bias };
  },
  configure(project, J) {
    const own = new Set(effects(J).map(e => `${e.group}/${e.key}`));
    const enabled = { ...(project.enabled as Record<string, Record<string, boolean>> ?? {}) };
    for (const group of J.GROUP_KEYS) {
      const values = { ...(enabled[group] ?? {}) };
      for (const key of J.order(group)) if (!own.has(`${group}/${key}`)) values[key] = false;
      enabled[group] = values;
    }
    project.enabled = enabled;
    project.fx = { ...(project.fx as Record<string, unknown>), glitch: 0, chroma: 0, flash: false, hud: 'off', koma: 0, onTwos: false };
  },
};
export const GPT_PACKS: readonly MotionPack[] = [gptHyperPack];
