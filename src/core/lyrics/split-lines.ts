/**
 * 歌詞の折り返し（JIZURA の J.splitLines）で、英単語の途中では切らない（2026-11-08 姫「歌詞が 2 行に分かれる時、きりがいいとこで
 * 2 行にならず、途中でなるから読みづらい」）。
 * 英字だけの行は JIZURA 0.10 が単語の間で切るようになった。日本語と英字が混ざった行（「Midnight 光の向こうへ」）は、文字数だけで
 * 切る規則のままで「Midni / ght」になることがある。そういう行は同じ規則（なるべく均等・ひらがなの後ろ・句読点や空白の後ろ）で、
 * 英字を含むかたまり（RAB!T、won’t など。空白か日本語で区切られた範囲）の中を候補から外し、英語と日本語の境目を優先して切り直す。
 * 日本語だけの行・英字だけの行は JIZURA の結果のまま。同梱ファイルは変えず、J.splitLines を包む（installSplitLinesPatch）。
 */

const LATIN = /[A-Za-zÀ-ɏ]/;
const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
const SPACE = /\s/;
const isHira = (c: string): boolean => /[ぁ-ゟ]/.test(c);
const isSmallKana = (c: string): boolean => 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ'.includes(c);
const isPunct = (c: string): boolean => /[、。，．,.!?！？…‥・「」『』（）()【】〈〉《》〔〕［］[\]'"“”‘’ー〜～:：;；\-—―]/.test(c);
const isBreakChar = (c: string): boolean => SPACE.test(c) || CJK.test(c);

/** k の前で切ると、英字を含むかたまり（空白・日本語で区切られた範囲）の途中になるか */
function insideLatinToken(arr: readonly string[], k: number): boolean {
  const a = arr[k - 1], b = arr[k];
  if (a === undefined || b === undefined || isBreakChar(a) || isBreakChar(b)) return false;
  let i = k - 1, j = k;
  while (i > 0 && !isBreakChar(arr[i - 1]!)) i--;
  while (j < arr.length - 1 && !isBreakChar(arr[j + 1]!)) j++;
  return LATIN.test(arr.slice(i, j + 1).join(''));
}

/** 折り返した結果が、英字を含むかたまりの途中で切れているか */
export function breaksInsideWord(text: string, wrapped: string): boolean {
  if (!wrapped.includes('\n')) return false;
  const arr = [...text], parts = wrapped.split('\n');
  // 折り返しの位置を元の文の位置に戻す（JIZURA は各行の両端の空白を除くだけで、文字は変えない）
  let pos = 0;
  for (let i = 0; i < parts.length - 1; i++) {
    while (pos < arr.length && SPACE.test(arr[pos]!)) pos++;
    pos += [...parts[i]!.trim()].length;
    if (pos > 0 && pos < arr.length && insideLatinToken(arr, pos)) return true;
  }
  return false;
}

/** JIZURA と同じ規則で、英字を含むかたまりの中では切らず、英語と日本語の境目を優先して折り返す */
export function splitLinesKeepWords(text: string, maxPer: number): string {
  const arr = [...text];
  if (arr.length <= maxPer) return text;
  const nLines = Math.ceil(arr.length / maxPer);
  const per = arr.length / nLines;
  const out: string[] = [];
  let start = 0;
  for (let l = 1; l < nLines; l++) {
    const target = Math.round(per * l);
    let best = -1, bestScore = -Infinity;
    // JIZURA は目標の ±3 文字から選ぶ。境目を拾えるよう 1 行の長さの 45% までは見る。候補が無ければさらに広げる
    for (let w = Math.max(3, Math.round(per * 0.45)); best < 0 && w <= arr.length; w += 3) {
      for (let k = Math.max(start + 1, target - w); k <= Math.min(arr.length - 1, target + w); k++) {
        if (insideLatinToken(arr, k)) continue;
        const a = arr[k - 1]!, b = arr[k]!;
        let s = 3 - Math.abs(k - target);
        if (isHira(a) && !isHira(b)) s += 3;
        if (isPunct(a) || SPACE.test(a)) s += 5;
        if (isSmallKana(b) || 'ーっ、。'.includes(b)) s -= 6;
        // 英語と日本語の境目（「Ready or not / 声を上げろ」）を優先する
        const prev = arr.slice(start, k).join('').trim(), next = arr.slice(k).join('').trim();
        const pa = [...prev].pop(), nb = [...next][0];
        if (pa && nb && ((LATIN.test(pa) && CJK.test(nb)) || (CJK.test(pa) && LATIN.test(nb)))) s += 5;
        if (s > bestScore) { bestScore = s; best = k; }
      }
    }
    if (best < 0) break;
    out.push(arr.slice(start, best).join('').trim());
    start = best;
  }
  out.push(arr.slice(start).join('').trim());
  return out.filter(Boolean).join('\n');
}

/** J.splitLines を包む。英字と日本語が混ざった行か、英字のかたまりの途中で切れたときだけ切り直す。一度だけ行う */
export function installSplitLinesPatch(J: { splitLines?: (text: string, maxPer: number) => string; __zunzunSplitPatched?: boolean }): void {
  if (J.__zunzunSplitPatched || typeof J.splitLines !== 'function') return;
  J.__zunzunSplitPatched = true;
  const orig = J.splitLines.bind(J);
  J.splitLines = (text, maxPer) => {
    const r = orig(text, maxPer);
    if (typeof text !== 'string' || typeof r !== 'string' || !r.includes('\n')) return r;
    const mixed = LATIN.test(text) && CJK.test(text);
    return mixed || breaksInsideWord(text, r) ? splitLinesKeepWords(text, maxPer) : r;
  };
}
