import { afterEach, expect, it, vi } from 'vitest';
import { layerOf } from './layer';
afterEach(() => vi.restoreAllMocks());
it('同じ層を再利用し、設計寸法・解像度上限が違う層は混ぜない', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ save() {}, scale() {} } as unknown as CanvasRenderingContext2D);
  const paint = vi.fn(), key = 'dimension-test';
  const first = layerOf(key, 1920, 1080, paint);
  expect(first?.width).toBe(1280);
  expect(layerOf(key, 1920, 1080, paint)).toBe(first);
  expect(paint).toHaveBeenCalledTimes(1);
  expect(layerOf(key, 1080, 1920, paint)).not.toBe(first);
  expect(layerOf(key, 1920, 1080, paint, 640)?.width).toBe(640);
  expect(paint).toHaveBeenCalledTimes(3);
});
it('描画失敗をキャッシュせず、24層を超えると古い層を再作成する', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ save() {}, scale() {} } as unknown as CanvasRenderingContext2D);
  expect(layerOf('failed-test', 20, 20, () => { throw Error('paint failed'); })).toBeNull();
  expect(layerOf('failed-test', 20, 20, () => {})).not.toBeNull();
  const paint = vi.fn(), first = layerOf('eviction-test', 20, 20, paint);
  for (let i = 0; i < 24; i++) layerOf(`eviction-fill-${i}`, 20, 20, () => {});
  expect(layerOf('eviction-test', 20, 20, paint)).not.toBe(first);
  expect(paint).toHaveBeenCalledTimes(2);
});
