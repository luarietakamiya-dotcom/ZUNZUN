/**
 * 拍子の書き方 (拍のまとまり) の読み取り。docs/ARCHITECTURE.md「変拍子（リズム）の方針」。
 * - "2+2+3" → [2, 2, 3]: 1 小節を 7 等分して、2・2・3 のまとまりにする (7/8 のよくある分け方)
 * - "4" → [1, 1, 1, 1]: 数字 1 つは「その数に等分」(4/4 なら 4、5 拍子なら 5)
 * 全角の数字・＋・空白も受け付ける。まとまりは 1〜16、合計は 32 まで。
 */

export const MAX_GROUP = 16;
export const MAX_UNITS = 32;

export function parseGrouping(text: string): number[] | null {
  const s = String(text ?? '')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[＋]/g, '+')
    .replace(/\s+/g, '');
  if (!/^\d{1,2}(\+\d{1,2})*$/.test(s)) return null;
  const parts = s.split('+').map(Number);
  const groups = parts.length === 1 ? Array.from({ length: parts[0]! }, () => 1) : parts;
  if (groups.length === 0 || groups.some((g) => g < 1 || g > MAX_GROUP)) return null;
  const units = groups.reduce((a, b) => a + b, 0);
  if (units > MAX_UNITS) return null;
  return groups;
}

/** 表示用: [2, 2, 3] → "2+2+3"、[1, 1, 1, 1] → "4" */
export function formatGrouping(groups: readonly number[]): string {
  return groups.every((g) => g === 1) ? String(groups.length) : groups.join('+');
}
