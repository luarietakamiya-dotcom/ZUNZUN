import logoUrl from '../assets/brand/logo.png';

/** アプリの名前 (2026-10-04 に ZUNZUN3 から VisualSync へ。リポジトリ名・公開 URL・内部の名前・保存ファイルの拡張子 .zunzun.json は変えない) */
export const APP_NAME = 'VisualSync';

/**
 * ヘッダーのロゴ (h1)。文字のロゴ画像 (背景を透明にしたもの)。暗い背景で濃い紫・青の文字が沈まないよう、
 * CSS (.brand-logo) でわずかな光と明るさを足す。読み上げ・画像が出ないときのために、名前も持たせる
 */
export function createBrandLogo(): HTMLHeadingElement {
  const h1 = document.createElement('h1');
  h1.className = 'brand';
  const img = document.createElement('img');
  img.className = 'brand-logo';
  img.src = logoUrl;
  img.alt = APP_NAME;
  img.decoding = 'async';
  img.draggable = false;
  h1.appendChild(img);
  return h1;
}
