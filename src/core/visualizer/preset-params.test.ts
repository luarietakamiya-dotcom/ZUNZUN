import { describe, expect, it } from 'vitest';
import type { PresetControl } from '../types';
import { resolvePresetParams, sanitizePresetParamsMap } from './preset-params';

const controls: PresetControl[] = [
  { type: 'range', key: 'height', label: { ja: '高さ', en: 'Height' }, help: { ja: '', en: '' }, min: 0, max: 10, step: 0.1, default: 2 },
  {
    type: 'select',
    key: 'camera',
    label: { ja: 'カメラ', en: 'Camera' },
    help: { ja: '', en: '' },
    options: [
      { value: 'back', label: { ja: '後ろ', en: 'Back' } },
      { value: 'front', label: { ja: '最前列', en: 'Front' } },
    ],
    default: 'back',
  },
];

describe('プリセットだけの設定', () => {
  it('保存が無ければ既定。範囲の外は収め、選べない値・知らない名前は捨てる', () => {
    expect(resolvePresetParams(controls, undefined)).toEqual({ height: 2, camera: 'back' });
    expect(resolvePresetParams(controls, { height: 99, camera: 'front', evil: 1 })).toEqual({ height: 10, camera: 'front' });
    expect(resolvePresetParams(controls, { height: 'x', camera: 'nope' })).toEqual({ height: 2, camera: 'back' });
    expect(resolvePresetParams(undefined, { a: 1 })).toEqual({});
  });

  it('Project JSON からは { プリセットの id: { 名前: 数か文字 } } の形だけを残す', () => {
    expect(sanitizePresetParamsMap({ 'live-stage': { camera: 'front', height: 3, bad: { x: 1 }, nan: NaN }, 'Bad Id': { a: 1 }, other: 5 })).toEqual({ 'live-stage': { camera: 'front', height: 3 } });
    expect(sanitizePresetParamsMap(null)).toEqual({});
    expect(sanitizePresetParamsMap([1])).toEqual({});
  });
});
