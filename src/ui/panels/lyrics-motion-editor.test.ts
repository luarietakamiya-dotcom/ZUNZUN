import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../core/store';
import { defaultLyrics, defaultProject, type LyricsMotion } from '../../core/types';
import type { JizuraApi, LyricMotion } from '../../core/lyrics/jizura-adapter';
import { previewMotionProvider } from '../../core/lyrics/motion-provider';
import { previewMotionNow } from './motion-apply';
import { createMotionEditor } from './lyrics-motion-editor';

vi.mock('./motion-apply', () => ({ previewMotionNow: vi.fn() }));

const snapshot = [{ utext: '一行目', layout: 'center', enter: 'cut', exit: 'cut', hold: 'still', treat: 'none', cam: 'push', params: {}, decor: [], inDur: 0.3, outDur: 0.3, scheme: 0, seed: 7 }];
const J = {
  defaultProject: () => ({ timing: {}, enabled: {} }),
  order: (g: string) => g === 'layout' ? ['center', 'curtain'] : g === 'enter' ? ['cut', 'type'] : [],
  registry: () => ({ center: { name: '中央' }, curtain: { name: '幕' }, cut: { name: 'カット' }, type: { name: 'タイプ' } }),
  lineSnapshot: vi.fn(() => snapshot),
} as unknown as JizuraApi;

beforeEach(() => {
  const lyrics = defaultLyrics();
  lyrics.text = '一行目\n二行目';
  store.setLyrics(lyrics);
  vi.spyOn(store.audio, 'isLoaded', 'get').mockReturnValue(true);
  vi.spyOn(previewMotionProvider, 'isBuilding', 'get').mockReturnValue(false);
  vi.spyOn(previewMotionProvider, 'hasPendingTiming', 'get').mockReturnValue(false);
  vi.mocked(previewMotionNow).mockReturnValue({ plan: { lines: [{ text: '一行目', seed: 7 }] } } as unknown as LyricMotion);
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  store.applyProject(defaultProject());
});

function setup() {
  const update = (patch: Partial<LyricsMotion>) => {
    const lyrics = store.lyrics!;
    store.setLyrics({ ...lyrics, motion: { ...lyrics.motion, ...patch } });
    editor.refresh();
  };
  const editor = createMotionEditor(update);
  editor.setJizura(J);
  document.body.append(editor.element);
  return editor;
}

describe('個別編集の操作', () => {
  it('演出を外しても一覧を開いたまま保持し、表示を毎フレーム作り直さない', () => {
    const editor = setup();
    const details = editor.element.querySelector<HTMLDetailsElement>('[data-group="effects"]')!;
    details.open = true;
    const input = editor.element.querySelector<HTMLInputElement>('[data-effect-key="type"]')!;
    input.checked = false;
    input.dispatchEvent(new Event('change'));
    expect(store.lyrics!.motion.effects?.enter?.type).toBe(false);
    expect(editor.element.querySelector<HTMLDetailsElement>('[data-group="effects"]')!.open).toBe(true);
    const select = editor.element.querySelector('[data-motion-editor="line"]');
    editor.refresh();
    expect(editor.element.querySelector('[data-motion-editor="line"]')).toBe(select);
    expect(editor.element.querySelector('[data-effect-key="curtain"]')).toBeNull();
  });

  it('選んだ行だけを変更し、固定・解除・リセットできる', () => {
    const editor = setup();
    const select = editor.element.querySelector<HTMLSelectElement>('[data-line-effect="enter"]')!;
    select.value = 'type';
    select.dispatchEvent(new Event('change'));
    expect(store.lyrics!.motion.lines).toEqual({ '0': { text: '一行目', enter: 'type' } });
    editor.element.querySelector<HTMLButtonElement>('[data-motion-editor="lock"]')!.click();
    expect(store.lyrics!.motion.lines!['0']).toMatchObject({ lock: true, lockedSeed: 7, lockedCuts: snapshot });
    expect(editor.element.querySelector<HTMLSelectElement>('[data-line-effect="enter"]')!.disabled).toBe(true);
    editor.element.querySelector<HTMLButtonElement>('[data-motion-editor="lock"]')!.click();
    expect(store.lyrics!.motion.lines!['0']!.lock).toBeUndefined();
    const reset = [...editor.element.querySelectorAll('button')].find((b) => b.textContent === 'この行の指定をリセット')!;
    reset.click();
    expect(store.lyrics!.motion.lines).toEqual({});
  });

  it('作り直し中の古い見本を固定しない', () => {
    const editor = setup();
    // 押した直後に新しい設定の構築が始まった状況も、click側で再確認する
    vi.mocked(previewMotionNow).mockImplementation(() => {
      vi.spyOn(previewMotionProvider, 'isBuilding', 'get').mockReturnValue(true);
      return { plan: { lines: [{ text: '一行目' }] } } as unknown as LyricMotion;
    });
    editor.element.querySelector<HTMLButtonElement>('[data-motion-editor="lock"]')!.click();
    expect(store.lyrics!.motion.lines).toBeUndefined();
    expect(editor.element.textContent).toContain('準備と時刻の反映');
  });

  it('歌詞がない画面でも、繰り返しrefreshでDOMを作り直さない', () => {
    store.setLyrics(null);
    const editor = setup();
    const first = editor.element.firstChild;
    editor.refresh();
    editor.refresh();
    expect(editor.element.firstChild).toBe(first);
  });
});
