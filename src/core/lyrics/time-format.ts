/** 歌詞の時刻の表示 (m:ss.cc) と、手入力された時刻の読み取り。 */

/** 秒を「分:秒.1/100 秒」の文字列にする (例: 83.456 → "1:23.46")。負の値や NaN は "--:--.--"。 */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--:--.--';
  const cs = Math.round(sec * 100);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/**
 * 手入力された時刻を秒にする。受け付ける形: "83.5" / "1:23.45" / "1:23" / "0:01:23.4" (時:分:秒)。
 * 全角の数字・コロン・ピリオドも受け付ける。読めなければ null。
 */
export function parseTimeInput(text: string): number | null {
  const s = String(text ?? '')
    .trim()
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ':')
    .replace(/[．。]/g, '.');
  if (!s) return null;
  const m = s.match(/^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  // 区切りが 2 つなら 時:分:秒、1 つなら 分:秒
  const [, a, b, secs] = m;
  const hours = a != null && b != null ? +a : 0;
  const mins = b != null ? +b : a != null ? +a : 0;
  if (a != null && b != null && mins >= 60) return null;
  const sec = parseFloat(secs!);
  if ((a != null || b != null) && sec >= 60) return null;
  const total = hours * 3600 + mins * 60 + sec;
  return Number.isFinite(total) ? total : null;
}
