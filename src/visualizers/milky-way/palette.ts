import * as THREE from 'three';

/**
 * Milky Way の配色 (共通パラメータ Color Theme に対応)。値は線形色空間。
 * 画面上では暗い色が数値の印象より明るく見える (Solar Gate の実測で確認済み) ため、空や水はかなり暗めにしてある。
 */
export interface MilkyWayPalette {
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  airglow: THREE.Color;
  galaxyCore: THREE.Color;
  galaxyArm: THREE.Color;
  starWarm: THREE.Color;
  starCool: THREE.Color;
  meteor: THREE.Color;
  water: THREE.Color;
  mountainFar: THREE.Color;
  mountainNear: THREE.Color;
}

const c = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);

const PALETTES: Record<string, () => MilkyWayPalette> = {
  // 既定 = 澄んだ山あいの夜。天の川の中心はわずかに暖色、腕は青白い
  default: () => ({
    skyTop: c(0.0015, 0.002, 0.006),
    skyHorizon: c(0.006, 0.01, 0.022),
    airglow: c(0.02, 0.045, 0.06),
    galaxyCore: c(1.0, 0.6, 0.32),
    galaxyArm: c(0.42, 0.56, 1.0),
    starWarm: c(1.0, 0.85, 0.7),
    starCool: c(0.75, 0.85, 1.0),
    meteor: c(0.85, 0.95, 1.0),
    water: c(0.001, 0.002, 0.004),
    mountainFar: c(0.004, 0.006, 0.012),
    mountainNear: c(0.0008, 0.001, 0.002),
  }),
  gold: () => ({
    skyTop: c(0.002, 0.0015, 0.003),
    skyHorizon: c(0.012, 0.008, 0.006),
    airglow: c(0.06, 0.035, 0.012),
    galaxyCore: c(1.0, 0.75, 0.4),
    galaxyArm: c(0.9, 0.65, 0.45),
    starWarm: c(1.0, 0.82, 0.55),
    starCool: c(1.0, 0.95, 0.85),
    meteor: c(1.0, 0.85, 0.55),
    water: c(0.002, 0.0015, 0.001),
    mountainFar: c(0.008, 0.005, 0.004),
    mountainNear: c(0.0012, 0.0008, 0.0006),
  }),
  ice: () => ({
    skyTop: c(0.001, 0.002, 0.007),
    skyHorizon: c(0.004, 0.012, 0.028),
    airglow: c(0.01, 0.05, 0.07),
    galaxyCore: c(0.7, 0.85, 1.0),
    galaxyArm: c(0.35, 0.6, 1.0),
    starWarm: c(0.85, 0.92, 1.0),
    starCool: c(0.6, 0.8, 1.0),
    meteor: c(0.6, 0.9, 1.0),
    water: c(0.0008, 0.002, 0.005),
    mountainFar: c(0.003, 0.007, 0.015),
    mountainNear: c(0.0006, 0.001, 0.0025),
  }),
  neon: () => ({
    skyTop: c(0.003, 0.001, 0.007),
    skyHorizon: c(0.014, 0.004, 0.024),
    airglow: c(0.05, 0.01, 0.07),
    galaxyCore: c(1.0, 0.45, 0.85),
    galaxyArm: c(0.35, 0.75, 1.0),
    starWarm: c(1.0, 0.7, 0.95),
    starCool: c(0.6, 0.9, 1.0),
    meteor: c(1.0, 0.55, 0.95),
    water: c(0.0015, 0.0008, 0.004),
    mountainFar: c(0.007, 0.003, 0.012),
    mountainNear: c(0.0012, 0.0006, 0.002),
  }),
  mono: () => ({
    skyTop: c(0.0015, 0.0015, 0.002),
    skyHorizon: c(0.009, 0.009, 0.011),
    airglow: c(0.035, 0.035, 0.04),
    galaxyCore: c(0.9, 0.9, 0.9),
    galaxyArm: c(0.7, 0.72, 0.78),
    starWarm: c(1.0, 1.0, 1.0),
    starCool: c(0.85, 0.88, 0.95),
    meteor: c(1.0, 1.0, 1.0),
    water: c(0.0015, 0.0015, 0.002),
    mountainFar: c(0.006, 0.006, 0.007),
    mountainNear: c(0.001, 0.001, 0.0012),
  }),
};

/** 未知のテーマ名は既定の配色にする。 */
export function milkyWayPalette(theme: string): MilkyWayPalette {
  return (PALETTES[theme] ?? PALETTES.default!)();
}
