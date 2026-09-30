import { afterEach, describe, expect, it } from 'vitest';
import { lang, onLangChange, setLang, tr } from './i18n';

describe('表記の言語 (日本語 / English)', () => {
  afterEach(() => setLang('ja'));

  it('既定は日本語。切り替えると tr が英語を返し、選んだ言語をこのブラウザに覚える', () => {
    expect(lang()).toBe('ja');
    expect(tr('光の強さ', 'Glow')).toBe('光の強さ');
    const seen: string[] = [];
    const off = onLangChange((l) => seen.push(l));
    setLang('en');
    expect(tr('光の強さ', 'Glow')).toBe('Glow');
    expect(localStorage.getItem('zunzun.lang')).toBe('en');
    setLang('en'); // 同じ言語なら知らせない
    off();
    setLang('ja');
    expect(seen).toEqual(['en']);
    expect(localStorage.getItem('zunzun.lang')).toBe('ja');
  });
});
