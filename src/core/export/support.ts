/**
 * 書き出しに必要なブラウザの機能があるか (2026-10-04 公開前の整備)。MP4 の書き出しは WebCodecs (VideoEncoder / AudioEncoder) が前提で、
 * 古いブラウザ・一部の Firefox / Safari などには無い。無いまま書き出しを始めると途中で分かりにくいエラーになるので、
 * 書き出しの画面で先に案内して、開始ボタンを押せなくする。
 */
export interface ExportSupport {
  ok: boolean;
  /** 足りない機能の名前 (ok のときは空) */
  missing: string[];
}

export function checkExportSupport(env: { VideoEncoder?: unknown; AudioEncoder?: unknown } = globalThis as never): ExportSupport {
  const missing: string[] = [];
  if (typeof env.VideoEncoder === 'undefined') missing.push('VideoEncoder');
  if (typeof env.AudioEncoder === 'undefined') missing.push('AudioEncoder');
  return { ok: missing.length === 0, missing };
}
