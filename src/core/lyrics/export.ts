import type { LyricsView } from './view';

/** 書き出す行: 歌詞のある行だけ（間奏は字幕にも LRC にも出さない）。時刻は画面と同じ view の値 */
interface ExportRow { start: number; end: number; text: string }

function rowsOf(view: LyricsView): ExportRow[] {
  const rows: ExportRow[] = [];
  view.parsed.lines.forEach((line, i) => {
    if (line.interlude || !line.text.trim()) return;
    const start = view.times.starts[i] ?? NaN, end = view.times.ends[i] ?? NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    rows.push({ start: Math.max(0, start), end: Math.max(start, end), text: line.manual?.length ? line.manual.join('\n') : line.text });
  });
  return rows;
}

const pad = (n: number, k: number): string => String(n).padStart(k, '0');

/** 00:01:02,345（ミリ秒に丸めたあとで繰り上げる） */
export function srtTime(t: number): string {
  const ms = Math.round(Math.max(0, t) * 1000);
  return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms / 60000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`;
}

/** [01:02.34]（百分の一秒に丸めたあとで繰り上げる） */
export function lrcTime(t: number): string {
  const cs = Math.round(Math.max(0, t) * 100);
  return `[${pad(Math.floor(cs / 6000), 2)}:${pad(Math.floor(cs / 100) % 60, 2)}.${pad(cs % 100, 2)}]`;
}

/** SRT にする。手で決めた改行（/ の区切り）は字幕の中の改行になる。区切りの見出し（[サビ] など）と間奏は出ない */
export function lyricsToSrt(view: LyricsView): string {
  return rowsOf(view).map((r, i) => `${i + 1}\n${srtTime(r.start)} --> ${srtTime(r.end)}\n${r.text}\n`).join('\n');
}

/** LRC にする（開始時刻のみ。終了は次の行の開始で決まる）。字幕の中の改行は 1 行にまとめて「/」でつなぐ */
export function lyricsToLrc(view: LyricsView): string {
  return rowsOf(view).map((r) => `${lrcTime(r.start)}${r.text.replace(/\n/g, '/')}`).join('\n');
}
