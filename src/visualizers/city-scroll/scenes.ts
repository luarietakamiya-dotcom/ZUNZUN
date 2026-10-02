import grandAvenueUrl from '../../assets/city-scroll/grand-avenue.webp';
import harborTownUrl from '../../assets/city-scroll/harbor-town.webp';
import neonNightUrl from '../../assets/city-scroll/neon-night.webp';
import oldDowntownUrl from '../../assets/city-scroll/old-downtown.webp';
import tramStreetUrl from '../../assets/city-scroll/tram-street.webp';
import type { Text2 } from '../../core/i18n';

/**
 * 「流れる街並み」で使う横長の絵 (ユーザーが用意した 5 枚。2000 × 400、src/assets/city-scroll/)。
 * どの絵も左右の端の絵はつながっていないので、端どうしを少し重ねて溶かしてつなぐ (shaders.ts の SEAM)。
 * 看板の文字が裏返るので、鏡のように折り返すつなぎ方は使わない。
 */

/** 舞い落ちる (舞う) もの */
export type ParticleKind = 'petals' | 'snow' | 'leaves' | 'lights' | 'confetti';

export interface CityScene {
  id: string;
  name: Text2;
  url: string;
  /** 絵の横 / 縦 */
  aspect: number;
  /** 「場面に合わせる」のときに舞うもの */
  particles: ParticleKind;
}

export const SCENES: readonly CityScene[] = [
  { id: 'grand-avenue', name: { ja: '青空の大通り', en: 'Grand avenue' }, url: grandAvenueUrl, aspect: 5, particles: 'leaves' },
  { id: 'neon-night', name: { ja: 'ネオンと桜の夜', en: 'Neon night' }, url: neonNightUrl, aspect: 5, particles: 'petals' },
  { id: 'old-downtown', name: { ja: '看板の下町', en: 'Old downtown' }, url: oldDowntownUrl, aspect: 5, particles: 'lights' },
  { id: 'harbor-town', name: { ja: '花の港町', en: 'Harbor town' }, url: harborTownUrl, aspect: 5, particles: 'petals' },
  { id: 'tram-street', name: { ja: '路面電車の街', en: 'Tram street' }, url: tramStreetUrl, aspect: 5, particles: 'leaves' },
];

/** 5 枚を順につなげて流す */
export const ALL_SCENES = 'all';

export const sceneById = (id: unknown): CityScene => SCENES.find((s) => s.id === id) ?? SCENES[0]!;

/** 流す絵の並び (「全部つなげる」なら 5 枚、それ以外は 1 枚) */
export function sceneSequence(id: unknown): CityScene[] {
  return id === ALL_SCENES ? [...SCENES] : [sceneById(id)];
}
