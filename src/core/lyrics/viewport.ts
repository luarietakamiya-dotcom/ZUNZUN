/**
 * タイムラインの表示範囲 (横方向) の計算。x (CSS px) と時刻 (秒) の変換、ポインタ位置を中心にした拡大縮小、スクロール。
 * UI 非依存なので Vitest で確かめられる。
 */

export const MAX_PX_PER_SEC = 1200;

export class Viewport {
  /** 画面の左端の時刻 (秒) */
  start = 0;
  /** 1 秒あたりの px */
  pxPerSec = 100;
  /** 表示の幅 (CSS px) */
  width = 800;
  /** 曲の長さ (秒) */
  duration = 0;

  get end(): number {
    return this.start + this.width / this.pxPerSec;
  }

  /** 曲全体が入る倍率 (これより小さくはしない) */
  get minPxPerSec(): number {
    return this.duration > 0 ? Math.min(MAX_PX_PER_SEC, this.width / this.duration) : 1;
  }

  timeToX(t: number): number {
    return (t - this.start) * this.pxPerSec;
  }

  xToTime(x: number): number {
    return this.start + x / this.pxPerSec;
  }

  /** 幅・曲の長さが変わったあとに、倍率と左端を有効な範囲へ戻す */
  clamp(): void {
    this.pxPerSec = Math.min(MAX_PX_PER_SEC, Math.max(this.minPxPerSec, this.pxPerSec));
    const maxStart = Math.max(0, this.duration - this.width / this.pxPerSec);
    this.start = Math.min(maxStart, Math.max(0, this.start));
  }

  /** x の位置にある時刻を動かさずに、倍率を factor 倍にする */
  zoomAt(x: number, factor: number): void {
    const t = this.xToTime(x);
    this.pxPerSec *= factor;
    this.clamp();
    this.start = t - x / this.pxPerSec;
    this.clamp();
  }

  scrollBy(px: number): void {
    this.start += px / this.pxPerSec;
    this.clamp();
  }

  /** t が画面に入るようにする (margin は左右の余白の割合) */
  reveal(t: number, margin = 0.1): void {
    const span = this.width / this.pxPerSec;
    if (t < this.start + span * margin || t > this.end - span * margin) {
      this.start = t - span * margin;
      this.clamp();
    }
  }
}
