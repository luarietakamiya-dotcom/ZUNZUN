/**
 * 画面の表記の言語 (日本語 / English)。ユーザー要望 2026-09-30:「メニューの表記を英語と日本語切り替えられるように」
 * 「誰が見てもわかりやすく、光の強さとか説明をかねて」。
 * - 文言はその場で tr('日本語', 'English') と書く (キーの一覧を別に持たない。どちらの文も、使う場所で読める)
 * - 選んだ言語はこのブラウザに覚えさせる (Project JSON には入れない)。既定は日本語
 * - 切り替えると、シェルがヘッダーと今のタブを作り直す (パネルは作るときに tr を呼ぶ)
 */

export type Lang = 'ja' | 'en';

const STORAGE_KEY = 'zunzun.lang';

function load(): Lang {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return v === 'en' ? 'en' : 'ja';
  } catch {
    return 'ja';
  }
}

let current: Lang = load();
const listeners = new Set<(l: Lang) => void>();

export function lang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, l);
  } catch {
    // 覚えられなくても、今のページの間は切り替わる
  }
  for (const fn of listeners) fn(l);
}

/** 言語が変わったら呼ばれる。戻り値で解除 */
export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 今の言語の文を返す */
export function tr(ja: string, en: string): string {
  return current === 'en' ? en : ja;
}

/** 日本語と英語の組 (設定の一覧などに使う) */
export interface Text2 {
  ja: string;
  en: string;
}

export const t2 = (t: Text2): string => tr(t.ja, t.en);
