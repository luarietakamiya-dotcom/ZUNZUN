import * as THREE from 'three';

/**
 * Live Stage の配色 (共通パラメータ Color Theme に対応)。値は線形色空間。
 * ムービングライトは偶数番と奇数番で beamA / beamB を交互に使う。
 * 光の筋は加算合成で重なるので 1 本 1 本は控えめにし、1 を超える (Bloom で光る) のはレンズとレーザーだけにする。
 * 壁や床は画面上で数値の印象より明るく見える (Solar Gate / Milky Way の実測) ため、かなり暗めにしてある。
 */
export interface LiveStagePalette {
  beamA: THREE.Color;
  beamB: THREE.Color;
  laser: THREE.Color;
  haze: THREE.Color;
  wall: THREE.Color;
  wallGlow: THREE.Color;
  floor: THREE.Color;
  fixture: THREE.Color;
}

const c = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);

const PALETTES: Record<string, () => LiveStagePalette> = {
  // 既定 = 青と桃色のムービングライトに緑のレーザー
  default: () => ({
    beamA: c(0.2, 0.42, 1.0),
    beamB: c(1.0, 0.2, 0.62),
    laser: c(0.25, 1.0, 0.4),
    haze: c(0.3, 0.32, 0.42),
    wall: c(0.0012, 0.0012, 0.0025),
    wallGlow: c(0.05, 0.03, 0.09),
    floor: c(0.0015, 0.0015, 0.0025),
    fixture: c(0.004, 0.004, 0.0053),
  }),
  gold: () => ({
    beamA: c(1.0, 0.62, 0.25),
    beamB: c(1.0, 0.85, 0.6),
    laser: c(1.0, 0.72, 0.2),
    haze: c(0.42, 0.33, 0.22),
    wall: c(0.004, 0.0025, 0.0015),
    wallGlow: c(0.09, 0.05, 0.015),
    floor: c(0.0025, 0.0018, 0.001),
    fixture: c(0.0053, 0.0043, 0.0033),
  }),
  ice: () => ({
    beamA: c(0.45, 0.78, 1.0),
    beamB: c(0.85, 0.95, 1.0),
    laser: c(0.3, 0.9, 1.0),
    haze: c(0.28, 0.36, 0.45),
    wall: c(0.0015, 0.0025, 0.005),
    wallGlow: c(0.02, 0.05, 0.09),
    floor: c(0.001, 0.0018, 0.003),
    fixture: c(0.0033, 0.0043, 0.006),
  }),
  neon: () => ({
    beamA: c(1.0, 0.2, 0.8),
    beamB: c(0.2, 0.85, 1.0),
    laser: c(0.55, 1.0, 0.2),
    haze: c(0.4, 0.25, 0.45),
    wall: c(0.004, 0.0015, 0.005),
    wallGlow: c(0.09, 0.02, 0.1),
    floor: c(0.0025, 0.001, 0.003),
    fixture: c(0.0053, 0.0033, 0.006),
  }),
  mono: () => ({
    beamA: c(0.9, 0.9, 0.9),
    beamB: c(0.7, 0.72, 0.78),
    laser: c(1.0, 1.0, 1.0),
    haze: c(0.34, 0.34, 0.36),
    wall: c(0.003, 0.003, 0.0035),
    wallGlow: c(0.05, 0.05, 0.055),
    floor: c(0.0018, 0.0018, 0.002),
    fixture: c(0.0047, 0.0047, 0.005),
  }),
};

/** 未知のテーマ名は既定の配色にする。 */
export function liveStagePalette(theme: string): LiveStagePalette {
  return (PALETTES[theme] ?? PALETTES.default!)();
}
