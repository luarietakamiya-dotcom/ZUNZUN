import * as THREE from 'three';

/**
 * Solar Gate の配色 (共通パラメータ Color Theme に対応)。
 * 値は線形色空間。1 を超える成分は Bloom (HalfFloat のレンダーターゲット) で光として拾われる。
 * 暗い色は画面上では数値の印象より明るく見える (headless Chromium で実測して調整した) ため、空の色はかなり暗めにしてある。
 */
export interface SolarGatePalette {
  ring: THREE.Color;
  rays: THREE.Color;
  particles: THREE.Color;
  pillar: THREE.Color;
  portal: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  glow: THREE.Color;
  floor: THREE.Color;
}

const c = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);

const PALETTES: Record<string, () => SolarGatePalette> = {
  // 既定 = 黄金の日輪
  default: () => ({
    ring: c(1.0, 0.7, 0.32),
    rays: c(1.0, 0.55, 0.2),
    particles: c(1.0, 0.72, 0.38),
    pillar: c(1.0, 0.78, 0.5),
    portal: c(1.0, 0.5, 0.18),
    skyTop: c(0.004, 0.005, 0.012),
    skyHorizon: c(0.028, 0.012, 0.007),
    glow: c(0.9, 0.38, 0.12),
    floor: c(0.006, 0.006, 0.01),
  }),
  gold: () => ({
    ring: c(1.0, 0.82, 0.45),
    rays: c(1.0, 0.72, 0.3),
    particles: c(1.0, 0.85, 0.5),
    pillar: c(1.0, 0.9, 0.62),
    portal: c(1.0, 0.68, 0.25),
    skyTop: c(0.006, 0.005, 0.004),
    skyHorizon: c(0.033, 0.022, 0.008),
    glow: c(1.0, 0.6, 0.2),
    floor: c(0.008, 0.007, 0.005),
  }),
  ice: () => ({
    ring: c(0.6, 0.85, 1.0),
    rays: c(0.42, 0.72, 1.0),
    particles: c(0.7, 0.9, 1.0),
    pillar: c(0.75, 0.9, 1.0),
    portal: c(0.3, 0.6, 1.0),
    skyTop: c(0.002, 0.005, 0.014),
    skyHorizon: c(0.007, 0.019, 0.039),
    glow: c(0.25, 0.55, 1.0),
    floor: c(0.004, 0.006, 0.012),
  }),
  neon: () => ({
    ring: c(1.0, 0.3, 0.85),
    rays: c(0.35, 0.85, 1.0),
    particles: c(1.0, 0.5, 0.95),
    pillar: c(0.6, 0.5, 1.0),
    portal: c(0.8, 0.2, 1.0),
    skyTop: c(0.006, 0.002, 0.014),
    skyHorizon: c(0.025, 0.007, 0.033),
    glow: c(0.75, 0.2, 1.0),
    floor: c(0.007, 0.004, 0.012),
  }),
  mono: () => ({
    ring: c(1.0, 1.0, 1.0),
    rays: c(0.85, 0.87, 0.92),
    particles: c(0.95, 0.95, 1.0),
    pillar: c(1.0, 1.0, 1.0),
    portal: c(0.7, 0.72, 0.78),
    skyTop: c(0.004, 0.004, 0.005),
    skyHorizon: c(0.017, 0.017, 0.019),
    glow: c(0.6, 0.62, 0.7),
    floor: c(0.006, 0.006, 0.007),
  }),
};

/** 未知のテーマ名は既定の配色にする。 */
export function solarGatePalette(theme: string): SolarGatePalette {
  return (PALETTES[theme] ?? PALETTES.default!)();
}
