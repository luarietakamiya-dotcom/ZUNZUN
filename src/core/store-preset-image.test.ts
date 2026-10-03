import { afterEach, describe, expect, it } from 'vitest';
import { buildProjectFile } from './project/serialize';
import { store } from './store';

/** プリセットに渡す画像 (store.presetImage)。ファイルはメモリだけ、Project JSON には ref + sha256 だけ */

/** jsdom の File には arrayBuffer() が無いので、同じ中身を返すものを足す */
const png = (name: string, body = 'x'): File => {
  const bytes = new Uint8Array([137, 80, 78, 71, ...Array.from(body).map((c) => c.charCodeAt(0))]);
  const f = new File([bytes], name, { type: 'image/png' });
  Object.defineProperty(f, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer.slice(0)) });
  return f;
};

afterEach(() => store.removePresetImage());

describe('store.presetImage', () => {
  it('選ぶと ref + sha256 が入り、保存には ref + sha256 だけが出る。外すと空に戻る', async () => {
    expect(store.presetImage).toBeNull();
    await store.setPresetImageFile(png('moon.png'));
    expect(store.presetImage?.ref).toBe('moon.png');
    expect(store.presetImage?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(store.presetImageFile?.name).toBe('moon.png');
    expect(Object.keys(buildProjectFile(store).visualizer.image!).sort()).toEqual(['ref', 'sha256']);
    store.removePresetImage();
    expect(store.presetImage).toBeNull();
    expect(store.presetImageFile).toBeNull();
  });

  it('画像でないファイルは断る', async () => {
    await expect(store.setPresetImageFile(new File(['hello'], 'a.txt', { type: 'text/plain' }))).rejects.toThrow();
    expect(store.presetImage).toBeNull();
  });

  it('プロジェクトを開くとファイルは外れ (ref だけ残る)、同じ画像を選び直すと当たる。違う画像は当たらない', async () => {
    await store.setPresetImageFile(png('moon.png', 'a'));
    const project = JSON.parse(JSON.stringify(buildProjectFile(store)));
    store.removePresetImage();
    store.applyProject(project);
    expect(store.presetImage?.ref).toBe('moon.png');
    expect(store.presetImageFile).toBeNull();
    expect(await store.restorePresetImage(png('other.png', 'b'))).toBe(false);
    expect(store.presetImageFile).toBeNull();
    expect(await store.restorePresetImage(png('copy-of-moon.png', 'a'))).toBe(true);
    expect(store.presetImageFile?.name).toBe('copy-of-moon.png');
  });
});
