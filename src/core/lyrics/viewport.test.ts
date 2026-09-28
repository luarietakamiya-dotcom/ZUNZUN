import { describe, expect, it } from 'vitest';
import { MAX_PX_PER_SEC, Viewport } from './viewport';

function vp(): Viewport {
  const v = new Viewport();
  v.width = 1000;
  v.duration = 100;
  v.pxPerSec = 100;
  v.start = 10;
  return v;
}

describe('Viewport', () => {
  it('x と時刻を相互に変換する', () => {
    const v = vp();
    expect(v.timeToX(12)).toBe(200);
    expect(v.xToTime(200)).toBe(12);
    expect(v.end).toBe(20);
  });

  it('ポインタの位置の時刻を動かさずに拡大・縮小する', () => {
    const v = vp();
    v.zoomAt(300, 2);
    expect(v.pxPerSec).toBe(200);
    expect(v.xToTime(300)).toBeCloseTo(13);
  });

  it('曲全体より小さく・上限より大きくはしない。左端は 0 〜 (長さ − 表示幅)', () => {
    const v = vp();
    v.zoomAt(0, 0.001);
    expect(v.pxPerSec).toBe(10);
    expect(v.start).toBe(0);
    v.zoomAt(500, 1e6);
    expect(v.pxPerSec).toBe(MAX_PX_PER_SEC);
    v.scrollBy(1e9);
    expect(v.end).toBeCloseTo(100);
    v.scrollBy(-1e9);
    expect(v.start).toBe(0);
  });

  it('reveal: 画面の外の時刻が入るように左端を動かす', () => {
    const v = vp();
    v.reveal(15);
    expect(v.start).toBe(10);
    v.reveal(40);
    expect(v.start).toBeCloseTo(39);
    expect(v.timeToX(40)).toBeCloseTo(100);
  });
});
