import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../core/store';
import { defaultComposition, defaultMediaLayer, defaultProject } from '../../core/types';
import { exportController } from '../../core/export';
import { renderExportPanel } from './export';

beforeEach(() => {
  vi.useFakeTimers();
  store.applyProject(defaultProject());
  vi.spyOn(store.audio, 'isLoaded', 'get').mockReturnValue(true);
  vi.spyOn(store.audio, 'audioBuffer', 'get').mockReturnValue({} as AudioBuffer);
  vi.stubGlobal('VideoEncoder', class {});
  vi.stubGlobal('AudioEncoder', class {});
});

afterEach(() => {
  document.body.replaceChildren();
  store.applyProject(defaultProject());
  exportController.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function setup(hidden = false) {
  const project = defaultProject();
  project.media = [defaultMediaLayer('actor', 'character.png', 'b'.repeat(64), 'image')];
  if (hidden) project.composition = { ...defaultComposition(), hidden: ['media:actor'] };
  store.applyProject(project);
  const panel = renderExportPanel();
  document.body.append(panel);
  const start = [...panel.querySelectorAll('button')].find((b) => b.textContent?.includes('書き出しを始める'))!;
  const check = panel.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  return { panel, start, check };
}

describe('未復元の素材の書き出し確認', () => {
  it('不足素材の名前と数を表示し、明示的な確認まで開始を止める', () => {
    const { panel, start, check } = setup();
    expect(panel.textContent).toContain('素材が 1 個');
    expect(panel.textContent).toContain('character.png');
    expect(start.disabled).toBe(true);
    expect(check.checked).toBe(false);
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    expect(start.disabled).toBe(false);
    check.checked = false;
    check.dispatchEvent(new Event('change'));
    expect(start.disabled).toBe(true);
  });

  it('素材を選び直すと開始でき、確認欄を隠す', () => {
    const { start, check } = setup();
    store.relinkMedia('actor', new File(['image'], 'character.png'));
    expect(start.disabled).toBe(false);
    expect(check.parentElement?.style.display).toBe('none');
  });

  it('不足素材が変わると以前の続行確認を破棄する', () => {
    const { start, check } = setup();
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    const project = defaultProject();
    project.media = [defaultMediaLayer('other', 'other.png', 'c'.repeat(64), 'image')];
    store.applyProject(project);
    expect(check.checked).toBe(false);
    expect(start.disabled).toBe(true);
  });

  it('意図的に非表示にした素材は書き出しを止めない', () => {
    const { panel, start, check } = setup(true);
    expect(start.disabled).toBe(false);
    expect(panel.textContent).not.toContain('素材が 1 個');
    expect(check.parentElement?.style.display).toBe('none');
  });
});
