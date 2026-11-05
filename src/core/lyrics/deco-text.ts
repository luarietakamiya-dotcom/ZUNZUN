/**
 * 飾りの数字・時刻を消す（2026-11-05 姫「JIZURA の歌詞と歌詞の間のカウントダウンを消す項目を作る」「JIZURA にはこの機能ある」）。
 * 本家 JIZURA v0.10.0 で入った「飾りの数字を消す / 飾りの時刻を消す」（#32、src/03_text.js の J.decoTextKind / J.hideDecoText。MIT）を、
 * 同梱の 0.9.0 に後から足す。同梱ファイルは変えず、J.drawItem を包む（installDecoTextPatch）。判定は本家と同じ。
 *  - 数字: 構図・装飾・HUD が添える「No.01」「#03」「128」、行の間のカウントダウン「2.4」など、数字だけの飾りの文字
 *  - 時刻: 「00:12.34」「REC 1:05」のような時刻の飾りの文字
 * そのカットの歌詞に含まれる文字は歌詞なので残す。設定は plan.fx の hideNo / hideTime（本家と同じ名前）。
 */

const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;

/** 飾りの文字の種類: 'time' = 時刻、'no' = 数字、null = どちらでもない（本家 J.decoTextKind と同じ） */
export function decoTextKind(text: unknown): 'time' | 'no' | null {
  const t = String(text ?? '').trim();
  if (!t || !/\d/.test(t) || CJK.test(t)) return null;
  if (/\d{1,2}[:：]\d{2}/.test(t) && /^[A-Za-z]{0,4}[\s.#]*[\d:：.;'"\s/\-–—+]+[A-Za-z]{0,3}$/.test(t)) return 'time';
  if ((t.match(/[A-Za-z]/g) ?? []).length <= 5 && /^[A-Za-z#№.\s\d/\-–—+×x%:,'°]+$/.test(t)) return 'no';
  return null;
}

interface DecoEnv {
  fx?: { hideNo?: unknown; hideTime?: unknown } | null;
  cut?: { lineText?: unknown; text?: unknown } | null;
}

/** この文字を描かないか（本家 J.hideDecoText と同じ） */
export function hideDecoText(env: DecoEnv, text: unknown): boolean {
  const fx = env.fx ?? {};
  if (!fx.hideNo && !fx.hideTime) return false;
  const k = decoTextKind(text);
  if (!k || !(k === 'no' ? fx.hideNo : fx.hideTime)) return false;
  const lyr = env.cut ? String(env.cut.lineText || env.cut.text || '') : '';
  return !lyr.includes(String(text).trim());
}

/** J.drawItem を包んで、消す設定の飾りの文字を描かないようにする。一度だけ行う */
export function installDecoTextPatch(J: { drawItem: (env: Record<string, unknown>, item: Record<string, unknown>) => unknown; __zunzunDecoTextPatched?: boolean }): void {
  if (J.__zunzunDecoTextPatched || typeof J.drawItem !== 'function') return;
  J.__zunzunDecoTextPatched = true;
  const orig = J.drawItem.bind(J);
  J.drawItem = (env, item) => (item && hideDecoText(env as DecoEnv, item.text) ? null : orig(env, item));
}
