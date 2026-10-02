/**
 * PC 表示とスマホ表示のどちらにするか (2026-10-02 ユーザー「今のはそのままに、機能をそのまま使えるスマホ用メニューつくれば？」)。
 * - 'auto' (既定): 画面の幅が MOBILE_MAX_WIDTH 以下ならスマホ表示
 * - 'pc' / 'mobile': 手で選んだ表示 (このブラウザに覚える)
 * - アドレスの ?mobile / ?pc でも選べる (applyUrl)
 * PC 表示の画面 (shell.ts) は今までどおり。スマホ表示 (mobile-shell.ts) は同じパネルを、下のメニューから呼び出す。
 */

export type LayoutPref = 'auto' | 'pc' | 'mobile';
export type LayoutMode = 'pc' | 'mobile';

export const MOBILE_MAX_WIDTH = 760;
const KEY = 'zunzun.layout';
const query = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

let pref: LayoutPref = readPref();
applyUrl();

/**
 * アドレスの最後の ?mobile / ?pc で表示を選ぶ (スマホ用のアドレス。ブックマークやホーム画面に置けるように。
 * 2026-10-02 ユーザー「自動ではなくても、スマホ用インデックスでもいいよ」)。選んだ表示はこのブラウザに覚える
 */
function applyUrl(): void {
  if (typeof location === 'undefined') return;
  const q = new URLSearchParams(location.search);
  const want: LayoutPref | null = q.has('mobile') ? 'mobile' : q.has('pc') ? 'pc' : null;
  if (!want) return;
  pref = want;
  try {
    localStorage.setItem(KEY, want);
  } catch {
    // 覚えられなくても、今の画面では使う
  }
}
const listeners = new Set<() => void>();

function readPref(): LayoutPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'pc' || v === 'mobile' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** 画面の幅が狭いか (スマホの大きさか) */
export function isNarrowScreen(): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}

export function layoutPref(): LayoutPref {
  return pref;
}

/** 今の表示 */
export function layoutMode(): LayoutMode {
  if (pref !== 'auto') return pref;
  return isNarrowScreen() ? 'mobile' : 'pc';
}

/**
 * 表示を手で選ぶ。画面の幅から自動で決まる表示と同じなら 'auto' に戻す
 * (狭い画面で「PC 表示」を選んだあと、広い画面で開いたときに困らないように)
 */
export function setLayout(mode: LayoutMode): void {
  const before = layoutMode();
  pref = mode === (isNarrowScreen() ? 'mobile' : 'pc') ? 'auto' : mode;
  try {
    if (pref === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // 覚えられなくても、今の画面では切り替える
  }
  if (layoutMode() !== before) for (const fn of listeners) fn();
}

/** 表示が変わったとき (手で選んだとき・画面の幅が境目をまたいだとき) に呼ぶ */
export function onLayoutChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof matchMedia === 'function') {
  let last = layoutMode();
  matchMedia(query).addEventListener('change', () => {
    const now = layoutMode();
    if (now === last) return;
    last = now;
    for (const fn of listeners) fn();
  });
  onLayoutChange(() => (last = layoutMode()));
}
