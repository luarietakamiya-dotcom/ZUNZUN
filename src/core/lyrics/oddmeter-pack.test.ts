import { describe, expect, it, vi } from 'vitest';
import { buildRhythmGrid } from '../rhythm';
import { barPunchAmount, buildOddMeterStyle, groupPulseAmount, ODD_METER_SET, ODD_METER_STYLE_KEY, registerOddMeterPack, type PackApi } from './oddmeter-pack';

// 7/8 (2+2+3)、1 小節 1.75 秒: まとまりの頭は 1, 1.5, 2 (小節の頭 1, 2.75, 4.5)
const grid = buildRhythmGrid({ bars: [1, 2.75, 4.5], meters: [{ bar: 0, pattern: '2+2+3' }] });

describe('変拍子パックの演出の量', () => {
  it('まとまりの脈動: 小節の頭がいちばん強く、長いまとまりの頭は短いものより強い。減衰して 0 になり、小節の外は 0', () => {
    const head = groupPulseAmount(grid, 1);
    const short = groupPulseAmount(grid, 1.5); // 2 のまとまり
    const long = groupPulseAmount(grid, 2); // 3 のまとまり
    expect(head).toBeCloseTo(1);
    expect(long).toBeGreaterThan(short);
    expect(head).toBeGreaterThan(long);
    expect(groupPulseAmount(grid, 1.1)).toBeLessThan(head);
    expect(groupPulseAmount(grid, 1.45)).toBe(0);
    expect(groupPulseAmount(grid, 0.5)).toBe(0);
    expect(groupPulseAmount(grid, 99)).toBe(0);
    expect(Number.isNaN(groupPulseAmount(grid, NaN))).toBe(false);
  });

  it('小節の頭で寄る: 小節の頭で最大、傾きは小節ごとに左右交互', () => {
    expect(barPunchAmount(grid, 1).s).toBeCloseTo(1);
    expect(barPunchAmount(grid, 1.5).s).toBeLessThan(0.1);
    expect(Math.sign(barPunchAmount(grid, 1).rot)).toBe(-Math.sign(barPunchAmount(grid, 2.75).rot));
    expect(barPunchAmount(grid, 0)).toEqual({ s: 0, rot: 0 });
  });
});

describe('変拍子用スタイルと登録', () => {
  const noir = { name: 'ノワール', bias: { layout: { vcols: 2 } }, decor: { rings: 0.8 }, schemes: [] };

  it('元のスタイルを複製し、装飾とカメラの重みを足す (元は書き換えない)', () => {
    const st = buildOddMeterStyle(noir);
    expect(st.name).toContain('変拍子');
    expect(st.decor).toEqual({ rings: 0.8, zzMeterBar: 24 });
    expect((st.bias as Record<string, unknown>).layout).toEqual({ vcols: 2 });
    expect(((st.bias as Record<string, Record<string, number>>).cam)!.zzBarPunch).toBeGreaterThan(1);
    expect(noir.decor).toEqual({ rings: 0.8 });
  });

  it('3 つの演出を部品セットに入れて登録し、スタイルを足す。2 回目は何もしない', () => {
    const register = vi.fn();
    const J = { register, STYLES: { noir } } as unknown as PackApi;
    registerOddMeterPack(J);
    registerOddMeterPack(J);
    expect(register.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['hold', 'zzGroupPulse'],
      ['decor', 'zzMeterBar'],
      ['cam', 'zzBarPunch'],
    ]);
    for (const c of register.mock.calls) expect(c[2].set).toBe(ODD_METER_SET);
    expect(J.STYLES[ODD_METER_STYLE_KEY]!.name).toContain('変拍子');
  });
});
