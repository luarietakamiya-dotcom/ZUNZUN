import { describe, expect, it } from 'vitest';
import { extractPalette, hexToHsl, paletteToScheme } from './palette';

/** 色の割合を指定して画素を作る */
function pixels(parts: [string, number][]): Uint8ClampedArray {
  const total = parts.reduce((a, [, n]) => a + n, 0);
  const out = new Uint8ClampedArray(total * 4);
  let k = 0;
  for (const [c, count] of parts) {
    const n = parseInt(c.slice(1), 16);
    for (let j = 0; j < count; j++, k++) out.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], k * 4);
  }
  return out;
}

const hueDeg = (c: string): number => hexToHsl(c)[0] * 360;

describe('extractPalette', () => {
  it('夕焼け (紺・橙・白っぽい光): 暗い色は紺寄り、明るい色は白っぽく、差し色は橙と紺の色相', () => {
    const p = extractPalette(pixels([['#101830', 400], ['#d06a30', 300], ['#f4e8d0', 100], ['#3050a0', 200]]));
    expect(hexToHsl(p.dark)[2]).toBeLessThan(0.2);
    expect(hexToHsl(p.light)[2]).toBeGreaterThan(0.8);
    // 橙 (約 22°) がいちばん目立ち、2 番目は青 (約 220°)
    expect(hueDeg(p.accent)).toBeGreaterThan(10);
    expect(hueDeg(p.accent)).toBeLessThan(35);
    expect(hueDeg(p.accent2)).toBeGreaterThan(200);
    expect(hueDeg(p.accent2)).toBeLessThan(240);
  });

  it('色みの無い (白黒の) 背景でも差し色を作る。画素が無くても壊れない', () => {
    const p = extractPalette(pixels([['#000000', 300], ['#808080', 300], ['#ffffff', 300]]));
    expect(p.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(p.accent2).toMatch(/^#[0-9a-f]{6}$/);
    expect(extractPalette(new Uint8ClampedArray(0)).light).toMatch(/^#/);
  });
});

describe('paletteToScheme', () => {
  it('文字はほぼ白 (明るさ 0.9 以上) で、差し色は元の色相のまま明るくする', () => {
    const s = paletteToScheme({ dark: '#101830', light: '#f4e8d0', accent: '#d06a30', accent2: '#3050a0' });
    expect(hexToHsl(s.fg)[2]).toBeGreaterThan(0.88);
    expect(hexToHsl(s.accent)[2]).toBeCloseTo(0.72, 1);
    expect(Math.abs(hueDeg(s.accent) - hueDeg('#d06a30'))).toBeLessThan(4);
    expect(hexToHsl(s.bg)[2]).toBeLessThan(0.1);
  });
});
