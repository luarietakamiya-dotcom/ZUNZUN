import { describe, expect, it } from 'vitest';
import { decoTextKind, hideDecoText, installDecoTextPatch } from './deco-text';
import { sanitizeProject } from '../project/validate';
import { defaultLyrics, defaultProject } from '../types';

describe('飾りの数字・時刻を消す（本家 JIZURA と同じ判定）', () => {
  it('数字だけ・時刻だけの文字を見分ける。日本語や長い英語は飾りとみなさない', () => {
    for (const t of ['2.4', '0.0', 'No.01', '#03', '128', '03 / 12', '120 BPM']) expect(decoTextKind(t)).toBe('no');
    for (const t of ['00:12.34', 'REC 1:05', '1:05']) expect(decoTextKind(t)).toBe('time');
    for (const t of ['', 'interlude', '— interlude —', '3つの影', 'Track 1 of the night sky', null]) expect(decoTextKind(t)).toBeNull();
  });
  it('設定ごとに消す。そのカットの歌詞に含まれる文字は消さない', () => {
    const env = (hideNo: boolean, hideTime: boolean, lineText = '') => ({ fx: { hideNo, hideTime }, cut: { lineText } });
    expect(hideDecoText(env(false, false), '2.4')).toBe(false);
    expect(hideDecoText(env(true, false), '2.4')).toBe(true);
    expect(hideDecoText(env(true, false), '00:12.34')).toBe(false);
    expect(hideDecoText(env(false, true), '00:12.34')).toBe(true);
    expect(hideDecoText(env(true, true, 'Ready 3 2 1'), '3')).toBe(false);
    expect(hideDecoText(env(true, true), 'ラリルレラ')).toBe(false);
    expect(hideDecoText({}, '2.4')).toBe(false);
  });
  it('J.drawItem を一度だけ包み、消す文字は描かない', () => {
    const drawn: string[] = [];
    const J = { drawItem: (_e: Record<string, unknown>, it: Record<string, unknown>) => { drawn.push(String(it.text)); return {}; } };
    installDecoTextPatch(J);
    installDecoTextPatch(J);
    const env = { fx: { hideNo: true }, cut: { lineText: '夜を越えて' } };
    expect(J.drawItem(env, { text: '2.4' })).toBeNull();
    J.drawItem(env, { text: '夜を越えて' });
    J.drawItem({ fx: {} }, { text: '2.4' });
    expect(drawn).toEqual(['夜を越えて', '2.4']);
  });
  it('プロジェクトに保存でき、真偽値でない値は捨てる', () => {
    const withFlags = (hideNo: unknown, hideTime: unknown) => {
      const lyrics = defaultLyrics();
      return JSON.parse(JSON.stringify({ ...defaultProject(), lyrics: { ...lyrics, text: 'a', motion: { ...lyrics.motion, hideNo, hideTime } } }));
    };
    const ok = sanitizeProject(withFlags(true, false)).lyrics?.motion;
    expect([ok?.hideNo, ok?.hideTime]).toEqual([true, false]);
    const bad = sanitizeProject(withFlags('yes', 1)).lyrics?.motion;
    expect([bad?.hideNo, bad?.hideTime]).toEqual([undefined, undefined]);
  });
});
