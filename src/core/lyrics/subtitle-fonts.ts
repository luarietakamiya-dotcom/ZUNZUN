/**
 * シンプル字幕 (simple-subtitle.ts) の書体。既定は Google Fonts から読み込む書体 (どの PC でも同じ見た目になる)。
 * この PC に入っている書体も選べる ('local:<書体名>'。ほかの PC では別の書体になる)。2026-11-25 姫「Google フォント。しかし
 * パソコンに入ってるのも選べるようにする」。外へ出る通信は書体の取得だけ (docs/ARCHITECTURE.md の技術選定と同じ)。
 */

export interface SubtitleFont {
  key: string;
  /** CSS の書体名 */
  family: string;
  label: { ja: string; en: string };
  /** Google Fonts の css2 の family= の値 */
  css: string;
  /** 太字があるか (無い書体は太字の指定でも 400 で描く) */
  hasBold: boolean;
}

export const SUBTITLE_FONTS: readonly SubtitleFont[] = [
  { key: 'noto-sans', family: 'Noto Sans JP', label: { ja: 'ゴシック (Noto Sans JP)', en: 'Gothic (Noto Sans JP)' }, css: 'Noto+Sans+JP:wght@400;700', hasBold: true },
  { key: 'noto-serif', family: 'Noto Serif JP', label: { ja: '明朝 (Noto Serif JP)', en: 'Mincho (Noto Serif JP)' }, css: 'Noto+Serif+JP:wght@400;700', hasBold: true },
  { key: 'zen-kaku', family: 'Zen Kaku Gothic New', label: { ja: 'すっきりゴシック (Zen Kaku Gothic New)', en: 'Clean gothic (Zen Kaku Gothic New)' }, css: 'Zen+Kaku+Gothic+New:wght@400;700', hasBold: true },
  { key: 'rounded', family: 'M PLUS Rounded 1c', label: { ja: '丸ゴシック (M PLUS Rounded 1c)', en: 'Rounded (M PLUS Rounded 1c)' }, css: 'M+PLUS+Rounded+1c:wght@400;700', hasBold: true },
  { key: 'shippori', family: 'Shippori Mincho', label: { ja: 'しっぽり明朝 (Shippori Mincho)', en: 'Shippori Mincho' }, css: 'Shippori+Mincho:wght@400;700', hasBold: true },
  { key: 'dela', family: 'Dela Gothic One', label: { ja: '極太 (Dela Gothic One)', en: 'Extra bold (Dela Gothic One)' }, css: 'Dela+Gothic+One', hasBold: false },
  { key: 'brush', family: 'Yuji Syuku', label: { ja: '筆 (Yuji Syuku)', en: 'Brush (Yuji Syuku)' }, css: 'Yuji+Syuku', hasBold: false },
];

export const isSubtitleFontKey = (key: string): boolean => SUBTITLE_FONTS.some((f) => f.key === key);

/** 'local:<書体名>' の書体名 (この PC の書体でなければ null) */
export const localFontName = (font: string): string | null => (font.startsWith('local:') ? font.slice(6) : null);

/** 描くときの CSS の font の書体名の部分 (見つからない文字は sans-serif で描く) */
export function subtitleFontFamily(font: string): string {
  const local = localFontName(font);
  const family = local ?? (SUBTITLE_FONTS.find((f) => f.key === font) ?? SUBTITLE_FONTS[0]!).family;
  return `"${family.replace(/["\\]/g, '')}", sans-serif`;
}

/** 太字で描くか (太字の無い Google の書体は 400) */
export function subtitleWeight(font: string, bold: boolean): 400 | 700 {
  if (!bold) return 400;
  const g = SUBTITLE_FONTS.find((f) => f.key === font);
  return g && !g.hasBold ? 400 : 700;
}

const linked = new Set<string>();
const FONT_TIMEOUT_MS = 6000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 書体を使える状態にする (Google の書体は読み込む。この PC の書体は何もしない)。文字の形が届くまで待つが、
 * 6 秒で諦めて先へ進む (届かなければ代わりの書体で描く)。テスト (document.fonts が無い) では何もしない
 */
export async function ensureSubtitleFont(font: string, bold: boolean, text: string): Promise<void> {
  // 書体の読み込みを確かめられない環境 (テストの jsdom など) では待たない
  const fonts = typeof document === 'undefined' ? undefined : (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts?.load) return;
  const g = SUBTITLE_FONTS.find((f) => f.key === font);
  if (g && !linked.has(g.key)) {
    linked.add(g.key);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${g.css}&display=swap`;
    const loaded = new Promise<void>((r) => { link.onload = () => r(); link.onerror = () => r(); });
    document.head.appendChild(link);
    await Promise.race([loaded, sleep(FONT_TIMEOUT_MS)]);
  }
  const spec = `${subtitleWeight(font, bold)} 40px ${subtitleFontFamily(font)}`;
  await Promise.race([fonts.load(spec, text.slice(0, 2000) || 'あA').catch(() => undefined), sleep(FONT_TIMEOUT_MS)]);
}

/**
 * この PC に入っている書体の名前の一覧 (Chrome / Edge の Local Font Access。初回はブラウザが許可を聞く)。
 * 使えないブラウザや、許可されなかったときは null (画面では書体名を手で入れてもらう)
 */
export async function listLocalFonts(): Promise<string[] | null> {
  const q = (globalThis as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  if (typeof q !== 'function') return null;
  try {
    const all = await q();
    return [...new Set(all.map((f) => f.family))].sort((a, b) => a.localeCompare(b, 'ja'));
  } catch {
    return null;
  }
}
