import { describe, expect, it } from 'vitest';
import { breaksInsideWord, installSplitLinesPatch, splitLinesKeepWords } from './split-lines';

describe('歌詞の折り返しで英単語の途中を切らない', () => {
  it('英単語の途中で切れているかを見分ける', () => {
    expect(breaksInsideWord('Midnight 光の向こうへ', 'Midni\nght\n光の向こうへ')).toBe(true);
    expect(breaksInsideWord('Midnight 光の向こうへ', 'Midnight\n光の向こうへ')).toBe(false);
    expect(breaksInsideWord('And the silence', 'And the\nsilence')).toBe(false);
    expect(breaksInsideWord('赤いライトが鼓動を撃った', '赤い\nライトが鼓動を\n撃った')).toBe(false);
    expect(breaksInsideWord('跳ねろ RAB!T 夢じゃ', '跳ねろ RAB!\nT 夢じゃ')).toBe(true);
  });
  it('混ざった行は、英単語を切らずに折り返す', () => {
    for (const [t, m] of [['Midnight 光の向こうへ', 5], ['走れ Rabbit 世界の端まで', 5], ['跳ねろ RAB!T 夢じゃ遅すぎる', 6], ['Ready or not 声を上げろ', 5]] as const) {
      const r = splitLinesKeepWords(t, m);
      expect(breaksInsideWord(t, r)).toBe(false);
      expect(r.replace(/\n/g, '').replace(/\s/g, '')).toBe(t.replace(/\s/g, ''));
    }
  });
  it('J.splitLines を一度だけ包み、途中で切れたときだけ切り直す', () => {
    const calls: string[] = [];
    const J = { splitLines: (t: string, _m: number) => { calls.push(t); return t === 'Midnight 光の向こうへ' ? 'Midni\nght\n光の向こうへ' : `${t.slice(0, 2)}\n${t.slice(2)}`; } };
    installSplitLinesPatch(J);
    installSplitLinesPatch(J);
    expect(breaksInsideWord('Midnight 光の向こうへ', J.splitLines('Midnight 光の向こうへ', 5))).toBe(false);
    expect(J.splitLines('赤いライト', 3)).toBe('赤い\nライト'); // 日本語だけの行は JIZURA のまま
    expect(calls).toEqual(['Midnight 光の向こうへ', '赤いライト']);
  });
});
