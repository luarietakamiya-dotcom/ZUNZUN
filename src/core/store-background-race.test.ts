import { afterEach, describe, expect, it } from 'vitest';
import { store } from './store';
import { defaultBackground, defaultProject } from './types';
import { LIBRARY } from './library';

function pendingFile(name: string) {
  let resolve!: (value: ArrayBuffer) => void;
  const bytes = new Promise<ArrayBuffer>((done) => { resolve = done; });
  const file = new File(['image'], name, { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => bytes });
  return { file, finish: () => resolve(new Uint8Array([1, 2, 3]).buffer) };
}

afterEach(() => {
  store.applyProject(defaultProject());
  store.fetchFn = (input, init) => fetch(input, init);
});

describe('背景の非同期読み込みの取り消し', () => {
  it('外した背景を遅い読み込みが復活させない', async () => {
    const pending = pendingFile('old.png');
    const loading = store.setBackgroundFile(pending.file, 'image');
    store.removeBackground();
    pending.finish();
    await loading;
    expect(store.background).toBeNull();
    expect(store.backgroundFile).toBeNull();
  });

  it('後から選んだ背景を先の読み込みが上書きしない', async () => {
    const old = pendingFile('old.png');
    const loading = store.setBackgroundFile(old.file, 'image');
    const next = pendingFile('next.png');
    const replacement = store.setBackgroundFile(next.file, 'image');
    next.finish();
    await replacement;
    old.finish();
    await loading;
    expect(store.background?.ref).toBe('next.png');
    expect(store.backgroundFile).toBe(next.file);
  });

  it('プロジェクトを開くと以前の読み込みを破棄する', async () => {
    const pending = pendingFile('old.png');
    const loading = store.setBackgroundFile(pending.file, 'image');
    const project = defaultProject();
    project.background = defaultBackground('project.png', 'a'.repeat(64), 'image');
    store.applyProject(project);
    pending.finish();
    await loading;
    expect(store.background?.ref).toBe('project.png');
    expect(store.backgroundFile).toBeNull();
  });

  it('内蔵背景の取得待ちでも取り消しを反映する', async () => {
    let finish!: (response: Response) => void;
    store.fetchFn = () => new Promise<Response>((done) => { finish = done; });
    const loading = store.setBackgroundFromLibrary(LIBRARY[0]!.id);
    store.removeBackground();
    finish(new Response(new Uint8Array([1, 2, 3])));
    await loading;
    expect(store.background).toBeNull();
  });
});
