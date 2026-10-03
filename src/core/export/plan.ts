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
  { id: '1080x1350', label: { ja: '1080×1350 (縦長 4:5・SNS の投稿)', en: '1080×1350 (portrait 4:5, social posts)' }, width: 1080, height: 1350 },
  { id: '1080x1440', label: { ja: '1080×1440 (縦長 3:4)', en: '1080×1440 (portrait 3:4)' }, width: 1080, height: 1440 },
  { id: '1440x1080', label: { ja: '1440×1080 (横長 4:3)', en: '1440×1080 (landscape 4:3)' }, width: 1440, height: 1080 },
  { id: '2560x1080', label: { ja: '2560×1080 (横長 21:9・ワイド)', en: '2560×1080 (landscape 21:9, ultrawide)' }, width: 2560, height: 1080 },
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

/**
 * 書き出した動画のファイルの大きさの目安 (MB)。書き出しは、動画のデータを最後までブラウザのメモリに置く (BufferTarget) ので、
 * 長い曲・高画質・スマホのときの注意書きに使う。**目安**: H.264 の高画質で 1080p・30fps が約 10Mbps、画素数と fps に比例、
 * 画質で 0.5 倍 (軽め) / 1 倍 / 1.8 倍 (最高)。実際は絵の細かさで大きく変わるので、少し大きめに見積もる (音は約 0.13MB/秒を足す)。
 */
export function estimateExportMB(width: number, height: number, fps: number, durationSec: number, quality: ExportSettings['quality']): number {
  if (!(width > 0) || !(height > 0) || !(fps > 0) || !(durationSec > 0)) return 0;
  const q = quality === 'draft' ? 0.5 : quality === 'max' ? 1.8 : 1;
  const mbps = 10 * ((width * height) / (1920 * 1080)) * (fps / 30) * q;
  return (mbps / 8) * durationSec + 0.13 * durationSec;
}

/** 注意を出す大きさ (MB)。スマホのブラウザは、これを超えるとメモリ不足で止まりやすい (目安) */
export const EXPORT_WARN_MB_MOBILE = 300;
export const EXPORT_WARN_MB = 1500;

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
