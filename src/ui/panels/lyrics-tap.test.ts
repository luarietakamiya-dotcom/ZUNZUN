import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '../../core/store';
import { defaultLyrics, defaultProject } from '../../core/types';
import { renderLyricsPanel } from './lyrics';

vi.mock('./lyrics-timeline', () => ({ LyricsTimeline: class {
  element = document.createElement('div');
  setData() {} setSelection() {} draw() {} reveal() {} dispose() {}
} }));
vi.mock('./lyrics-rhythm', () => ({ createRhythmEditor: () => ({
  element: document.createElement('div'), isTapping: false, refresh() {}, tick() {}, dispose() {},
  handleKey: () => false, moveBar() {}, grid: () => null, barHeads: () => [],
}) }));
vi.mock('./motion-apply', () => ({
  previewMotionNow: () => null,
  createMotionApplyNotice: () => ({ element: document.createElement('div'), update() {} }),
}));
let playing = false;
let time = 0;
let frame: FrameRequestCallback;
beforeEach(() => {
  playing = false; time = 0;
  const lyrics = defaultLyrics();
  lyrics.text = '第一行\n第二行\n第三行';
  lyrics.timing.lineTimes = { '0': 5, '1': 10, '2': 15 };
  store.setLyrics(lyrics);
  vi.spyOn(store.audio, 'isLoaded', 'get').mockReturnValue(true);
  vi.spyOn(store.audio, 'isPlaying', 'get').mockImplementation(() => playing);
  vi.spyOn(store.audio, 'duration', 'get').mockReturnValue(30);
  vi.spyOn(store.audio, 'heardTime', 'get').mockImplementation(() => time);
  vi.spyOn(store.audio, 'currentTime', 'get').mockImplementation(() => time);
  vi.spyOn(store.audio, 'play').mockImplementation(() => { playing = true; });
  vi.spyOn(store.audio, 'pause').mockImplementation(() => { playing = false; });
  vi.spyOn(store.audio, 'seek').mockImplementation((t) => { time = t; });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
});
afterEach(() => {
  document.body.replaceChildren(); frame(0);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); store.applyProject(defaultProject());
});
function setup() { const root = renderLyricsPanel(); document.body.append(root); return root; }
function button(root: HTMLElement, text: string) {
  return [...root.querySelectorAll('button')].find(b => b.textContent?.startsWith(text))!;
}
function tap(root: HTMLElement, t: number) {
  time = t;
  root.querySelector('.lyrics-tap-button')!.dispatchEvent(new MouseEvent('click', { detail: 1 }));
}
it('中止は曲も止め、時刻を残し、次の行から再開する', () => {
  const root = setup(); button(root, '1 行目からタップ').click();
  tap(root, 5.2); button(root, 'タップを中止して停止').click();
  expect(playing).toBe(false);
  expect(store.lyrics!.timing.lineTimes).toEqual({ '0': 5.2, '1': 10, '2': 15 });
  expect(root.querySelector<HTMLElement>('.lyrics-tap-active')!.hidden).toBe(true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  expect(store.lyrics!.timing.lineTimes['1']).toBe(10);
  button(root, '続き (').click();
  expect(playing).toBe(true); expect(time).toBe(7.5);
  tap(root, 10.3);
  expect(store.lyrics!.timing.lineTimes).toEqual({ '0': 5.2, '1': 10.3, '2': 15 });
});
it('前の行を選んでやり直しても開始前に記録を消さない', () => {
  const root = setup();
  const select = root.querySelector<HTMLSelectElement>('select[aria-label="やり直す行"]')!;
  select.value = '1'; select.dispatchEvent(new Event('change'));
  button(root, '選んだ 2 行目からやり直す').click();
  expect(time).toBe(7.5);
  expect(store.lyrics!.timing.lineTimes).toEqual({ '0': 5, '1': 10, '2': 15 });
  tap(root, 10.2);
  expect(store.lyrics!.timing.lineTimes).toEqual({ '0': 5, '1': 10.2, '2': 15 });
});
it('曲の一時停止と自然停止でもタップを終了し、停止中は記録しない', () => {
  const root = setup(); button(root, '1 行目からタップ').click();
  playing = false; tap(root, 2); frame(0);
  expect(store.lyrics!.timing.lineTimes['0']).toBe(5);
  expect(root.querySelector<HTMLElement>('.lyrics-tap-active')!.hidden).toBe(true);
  button(root, '続き (').click(); frame(0);
  button(root, '一時停止').click();
  expect(playing).toBe(false);
  expect(root.querySelector<HTMLElement>('.lyrics-tap-active')!.hidden).toBe(true);
});
