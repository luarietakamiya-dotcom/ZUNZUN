import crystalVoidUrl from '../../assets/cyber-space/crystal-void.webp';
import neonGateUrl from '../../assets/cyber-space/neon-gate.webp';
import skyHallUrl from '../../assets/cyber-space/sky-hall.webp';
import type { Text2 } from '../../core/i18n';

/**
 * 「サイバー空間」で使う絵 (ユーザーが用意した 3 枚。1672 × 941、src/assets/cyber-space/)。
 * vp = 奥の消失点 (通路の突き当たり・光の柱の根元)。絵の上での割合 (左上が 0,0)。光の波とワープの線はここから広がる。
 * 位置は絵を見て合わせた。
 */
export interface CyberScene {
  id: string;
  name: Text2;
  url: string;
  /** 絵の横 / 縦 */
  aspect: number;
  vp: readonly [number, number];
  /** 光らせる強さの倍率 (もともと明るい絵は弱めに。白く飛ばないように) */
  gain: number;
}

export const SCENES: readonly CyberScene[] = [
  { id: 'neon-gate', name: { ja: 'ネオンのゲート', en: 'Neon gate' }, url: neonGateUrl, aspect: 1672 / 941, vp: [0.5, 0.7], gain: 1 },
  { id: 'crystal-void', name: { ja: '結晶の宇宙', en: 'Crystal void' }, url: crystalVoidUrl, aspect: 1672 / 941, vp: [0.5, 0.76], gain: 0.85 },
  { id: 'sky-hall', name: { ja: '空の神殿', en: 'Sky hall' }, url: skyHallUrl, aspect: 1672 / 941, vp: [0.5, 0.665], gain: 0.5 },
];

export const sceneById = (id: unknown): CyberScene => SCENES.find((s) => s.id === id) ?? SCENES[0]!;
