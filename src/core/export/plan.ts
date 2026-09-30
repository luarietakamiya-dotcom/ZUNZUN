import type { Text2 } from '../i18n';
import type { ExportSettings } from '../types';

/**
 * 書き出しの「計画」部分 (フレーム数・時刻・サイズ・ファイル名) を決める純粋関数群。
 * Mediabunny / WebCodecs / Three.js に依存しないので Vitest で検証できる。
 */

/** 書き出しサイズの選択肢 (Export パネルのプルダウン)。H.264 は幅・高さとも偶数である必要がある。 */
export const EXPORT_SIZE_PRESETS: readonly { id: string; label: Text2; width: number; height: number }[] = [
  { id: '1920x1080', label: { ja: '1920×1080 (横長 16:9・フル HD)', en: '1920×1080 (landscape 16:9, Full HD)' }, width: 1920, height: 1080 },
  { id: '1280x720', label: { ja: '1280×720 (横長 16:9・HD・軽め)', en: '1280×720 (landscape 16:9, HD, lighter)' }, width: 1280, height: 720 },
  { id: '1080x1920', label: { ja: '1080×1920 (縦長 9:16・ショート動画)', en: '1080×1920 (portrait 9:16, shorts)' }, width: 1080, height: 1920 },
  { id: '1080x1080', label: { ja: '1080×1080 (正方形 1:1)', en: '1080×1080 (square 1:1)' }, width: 1080, height: 1080 },
];

export const EXPORT_FPS_OPTIONS: readonly number[] = [30, 60];

/** H.264 (4:2:0) は奇数サイズを受け付けないため、2 以上の偶数に丸める。 */
export function evenDimension(n: number): number {
  if (!Number.isFinite(n)) return 2;
  return Math.max(2, Math.round(n / 2) * 2);
}

/** 曲の長さ (秒) を fps で割ったフレーム数。最後の端数フレームも含める (最低 1 フレーム)。 */
export function totalFrameCount(durationSec: number, fps: number): number {
  if (!(durationSec > 0) || !(fps > 0)) return 1;
  // 浮動小数点誤差で 1 フレーム余計に増えないよう、ごく小さい値を引いてから切り上げる
  return Math.max(1, Math.ceil(durationSec * fps - 1e-6));
}

/** i 番目のフレームの時刻 (秒)。プレビューと同じ AudioTimeline をこの時刻で引く。 */
export function frameTimestamp(index: number, fps: number): number {
  return index / fps;
}

/** ExportSettings.quality を Mediabunny の品質レベル名に対応させる。 */
export function qualityLevel(q: ExportSettings['quality']): 'medium' | 'high' | 'very-high' {
  switch (q) {
    case 'draft':
      return 'medium';
    case 'max':
      return 'very-high';
    default:
      return 'high';
  }
}

/** 「曲名_プリセット.mp4」形式の保存名。ファイル名に使えない文字は _ に置き換える。 */
export function suggestExportFileName(audioFileName: string, presetId: string, ext = 'mp4'): string {
  const base = audioFileName.replace(/\.[^./\\]+$/, '') || 'zunzun';
  const safe = `${base}_${presetId || 'visualizer'}`.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `${safe || 'zunzun'}.${ext}`;
}

/** 経過時間と進捗から残り時間 (ミリ秒) を見積もる。まだ見積もれないときは null。 */
export function estimateRemainingMs(elapsedMs: number, done: number, total: number): number | null {
  if (done <= 0 || total <= 0 || elapsedMs <= 0) return null;
  const remaining = Math.max(0, total - done);
  return (elapsedMs / done) * remaining;
}
