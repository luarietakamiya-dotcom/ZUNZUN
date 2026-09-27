/**
 * ブラウザの SubtleCrypto (Web Crypto API) を使った SHA-256 ハッシュ。
 * Project JSON の audio.sha256 (読み込み直した音源が同じファイルかどうかの照合用) に使う。
 * 外部には一切送信しない、ローカル完結の処理。
 *
 * decode.ts / player.ts と同様、ブラウザ API に依存するため Vitest (jsdom) の対象外とし、
 * 動作確認は Playwright (E2E) または手動確認で行う。
 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
