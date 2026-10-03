import grandAvenueUrl from '../../assets/city-scroll/grand-avenue.webp';
import harborTownUrl from '../../assets/city-scroll/harbor-town.webp';
import marathonUrl from '../../assets/city-scroll/marathon.webp';
import neonNightUrl from '../../assets/city-scroll/neon-night.webp';
import palacePlazaUrl from '../../assets/city-scroll/palace-plaza.webp';
import oldDowntownUrl from '../../assets/city-scroll/old-downtown.webp';
import rainyStreetUrl from '../../assets/city-scroll/rainy-street.webp';
import residentialUrl from '../../assets/city-scroll/residential.webp';
import tramStreetUrl from '../../assets/city-scroll/tram-street.webp';
import type { Text2 } from '../../core/i18n';

/**
 * 「流れる街並み」で使う横長の絵 (ユーザーが用意した 9 枚。5940 × 1195、src/assets/city-scroll/)。
 * 2026-10-03 に高解像度の絵へ差し替え (ChatGPT で作った 1980 × 1195 を 3 枚、横につないだもの。3 枚目の右端は 1 枚目の左端へ
 * つながるので、1 枚だけ流すときは継ぎ目なしでループする)。別の絵をつなげて流す「全部つなげる」だけ、絵の境目を
 * 少し重ねて溶かす (shaders.ts の SEAM)。
 * 看板の文字が裏返るので、鏡のように折り返すつなぎ方は使わない。
 */

/** 絵の横 / 縦 (5940 × 1195) */
const ASPECT = 5940 / 1195;

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
  { id: 'grand-avenue', name: { ja: '青空の大通り', en: 'Grand avenue' }, url: grandAvenueUrl, aspect: ASPECT, particles: 'leaves' },
  { id: 'neon-night', name: { ja: 'ネオンと桜の夜', en: 'Neon night' }, url: neonNightUrl, aspect: ASPECT, particles: 'petals' },
  { id: 'old-downtown', name: { ja: '看板の下町', en: 'Old downtown' }, url: oldDowntownUrl, aspect: ASPECT, particles: 'lights' },
  { id: 'harbor-town', name: { ja: '花の港町', en: 'Harbor town' }, url: harborTownUrl, aspect: ASPECT, particles: 'petals' },
  { id: 'tram-street', name: { ja: '路面電車の街', en: 'Tram street' }, url: tramStreetUrl, aspect: ASPECT, particles: 'leaves' },
  { id: 'palace-plaza', name: { ja: '宮殿と噴水の広場', en: 'Palace plaza' }, url: palacePlazaUrl, aspect: ASPECT, particles: 'petals' },
  { id: 'residential', name: { ja: '並木の住宅街', en: 'Tree-lined neighborhood' }, url: residentialUrl, aspect: ASPECT, particles: 'leaves' },
  { id: 'rainy-street', name: { ja: '雨の夜の商店街', en: 'Rainy night street' }, url: rainyStreetUrl, aspect: ASPECT, particles: 'lights' },
  { id: 'marathon', name: { ja: 'マラソンの沿道', en: 'Marathon route' }, url: marathonUrl, aspect: ASPECT, particles: 'confetti' },
];

/** 全部の絵を順につなげて流す */
export const ALL_SCENES = 'all';

export const sceneById = (id: unknown): CityScene => SCENES.find((s) => s.id === id) ?? SCENES[0]!;

/** 流す絵の並び (「全部つなげる」なら全部、それ以外は 1 枚) */
export function sceneSequence(id: unknown): CityScene[] {
  return id === ALL_SCENES ? [...SCENES] : [sceneById(id)];
}
