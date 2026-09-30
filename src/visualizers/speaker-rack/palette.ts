import * as THREE from 'three';

/**
 * Speaker Rack の配色 (共通パラメータ Color Theme に対応)。値は線形色空間。
 * 機材は暗い金属。光るのは LED・メーター・真空管・足もとの灯りだけ (1 を超える値は Bloom で光る)。
 */
export interface SpeakerRackPalette {
  /** LED が点いたときの色 (下の段) と、上の段 (強いとき) */
  led: THREE.Color;
  ledHot: THREE.Color;
  /** メーターの文字盤 (後ろから照らされた紙の色) */
  meterFace: THREE.Color;
  /** 真空管のフィラメント */
  filament: THREE.Color;
  /** 足もとの灯り・照明の色 */
  accent: THREE.Color;
  /** 機材の金属・箱 */
  metal: THREE.Color;
  cabinet: THREE.Color;
  cone: THREE.Color;
  /** 背景 (奥の暗がり) */
  background: THREE.Color;
}

const c = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);

const PALETTES: Record<string, () => SpeakerRackPalette> = {
  // 既定 = 琥珀色の LED と暖かい灯り (参考画像のラック)
  default: () => ({
    led: c(1.6, 0.62, 0.12),
    ledHot: c(1.8, 0.16, 0.08),
    meterFace: c(0.95, 0.72, 0.38),
    filament: c(2.2, 0.9, 0.28),
    accent: c(1.0, 0.5, 0.16),
    metal: c(0.05, 0.05, 0.055),
    cabinet: c(0.018, 0.018, 0.02),
    cone: c(0.03, 0.03, 0.032),
    background: c(0.004, 0.004, 0.006),
  }),
  gold: () => ({
    led: c(1.7, 1.1, 0.3),
    ledHot: c(1.8, 0.4, 0.1),
    meterFace: c(1.0, 0.85, 0.5),
    filament: c(2.2, 1.2, 0.4),
    accent: c(1.0, 0.72, 0.3),
    metal: c(0.07, 0.06, 0.045),
    cabinet: c(0.025, 0.02, 0.015),
    cone: c(0.04, 0.035, 0.028),
    background: c(0.006, 0.005, 0.003),
  }),
  ice: () => ({
    led: c(0.3, 1.1, 1.8),
    ledHot: c(1.6, 0.3, 0.6),
    meterFace: c(0.6, 0.85, 1.0),
    filament: c(0.6, 1.2, 2.2),
    accent: c(0.3, 0.7, 1.0),
    metal: c(0.045, 0.05, 0.06),
    cabinet: c(0.015, 0.018, 0.024),
    cone: c(0.028, 0.032, 0.04),
    background: c(0.003, 0.004, 0.008),
  }),
  neon: () => ({
    led: c(1.6, 0.2, 1.4),
    ledHot: c(0.3, 1.6, 0.6),
    meterFace: c(0.9, 0.6, 1.0),
    filament: c(1.8, 0.4, 2.0),
    accent: c(0.9, 0.2, 1.0),
    metal: c(0.05, 0.045, 0.06),
    cabinet: c(0.02, 0.015, 0.025),
    cone: c(0.035, 0.028, 0.04),
    background: c(0.005, 0.003, 0.008),
  }),
};

export function speakerRackPalette(name: string): SpeakerRackPalette {
  return (PALETTES[name] ?? PALETTES.default!)();
}
