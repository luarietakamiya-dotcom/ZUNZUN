import { afterEach, describe, expect, it } from 'vitest';
import { buildProjectFile } from './project/serialize';
import { sanitizeProject } from './project/validate';
import { store } from './store';

/** スライドショーの入れ方 (追加・区切りの指定・外す)。jsdom の File には arrayBuffer() が無いので、足す */
const png = (name: string, body: string): File => {
  const bytes = new Uint8Array([137, 80, 78, 71, ...Array.from(body).map((c) => c.charCodeAt(0))]);
  const f = new File([bytes], name, { type: 'image/png' });
  Object.defineProperty(f, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer.slice(0)) });
  return f;
};
const kinds = (): (string | undefined)[] => store.background!.slides!.items.map((it) => it.kind);
const names = (): string[] => store.background!.slides!.items.map((it) => it.ref);

afterEach(() => store.removeBackground());

describe('store.setBackgroundSlides', () => {
  it('置き換え: ファイル名の順に並べ、区切りの指定を覚える。指定のない 1 枚だけなら 1 枚の背景', async () => {
    await store.setBackgroundSlides([{ file: png('b.png', 'b'), kind: 'chorus' }, { file: png('a.png', 'a') }, { file: png('c.png', 'c'), kind: 'intro' }]);
    expect(names()).toEqual(['a.png', 'b.png', 'c.png']);
    expect(kinds()).toEqual([undefined, 'chorus', 'intro']);
    expect(store.slideFiles.every((f) => f != null)).toBe(true);
    await store.setBackgroundSlides([png('only.png', 'o')]);
    expect(store.background?.slides).toBeNull();
    expect(store.background?.ref).toBe('only.png');
  });

  it('区切りの指定がある 1 枚は、1 枚だけのスライドショーとして残す', async () => {
    await store.setBackgroundSlides([{ file: png('x.png', 'x'), kind: 'outro' }]);
    expect(names()).toEqual(['x.png']);
    expect(kinds()).toEqual(['outro']);
  });

  it('足す: 今のスライドショーの後ろに足す。同じ画像は 2 度足さず、区切りの指定だけ上書きする', async () => {
    await store.setBackgroundSlides([{ file: png('a.png', 'a'), kind: 'intro' }, png('b.png', 'b')]);
    const r = await store.setBackgroundSlides([{ file: png('copy-of-a.png', 'a'), kind: 'chorus' }, { file: png('z.png', 'z'), kind: 'outro' }], { add: true });
    expect(r.count).toBe(3);
    expect(names()).toEqual(['a.png', 'b.png', 'z.png']);
    expect(kinds()).toEqual(['chorus', undefined, 'outro']);
    expect(store.slideFiles).toHaveLength(3);
  });

  it('足す: 1 枚の背景から始めても、その 1 枚を含めてスライドショーにする。背景が無くてもよい', async () => {
    await store.setBackgroundFile(png('first.png', 'f'), 'image');
    await store.setBackgroundSlides([{ file: png('s.png', 's'), kind: 'chorus' }], { add: true });
    expect(names()).toEqual(['first.png', 's.png']);
    expect(kinds()).toEqual([undefined, 'chorus']);
    store.removeBackground();
    await store.setBackgroundSlides([{ file: png('n.png', 'n'), kind: 'intro' }], { add: true });
    expect(names()).toEqual(['n.png']);
  });

  it('画像でないファイルだけなら断り、飛ばした数を返す', async () => {
    await expect(store.setBackgroundSlides([new File(['x'], 'a.txt', { type: 'text/plain' })], { add: true })).rejects.toThrow();
    const r = await store.setBackgroundSlides([png('a.png', 'a'), png('b.png', 'b'), new File(['x'], 'a.txt', { type: 'text/plain' })]);
    expect(r).toEqual({ count: 2, skipped: 1 });
  });
});

describe('区切りの変更・外す・保存', () => {
  it('setSlideKind: 指定する・null で名前に任せる。removeSlide: 外す (全部外すと背景なし)', async () => {
    await store.setBackgroundSlides([png('a.png', 'a'), png('b.png', 'b'), png('c.png', 'c')]);
    store.setSlideKind(1, 'bridge');
    expect(kinds()).toEqual([undefined, 'bridge', undefined]);
    store.setSlideKind(1, null);
    expect(kinds()).toEqual([undefined, undefined, undefined]);
    store.setSlideKind(9, 'intro'); // 範囲外は何もしない
    store.setSlideKind(0, 'intro');
    store.removeSlide(1);
    expect(names()).toEqual(['a.png', 'c.png']);
    expect(kinds()).toEqual(['intro', undefined]);
    expect(store.slideFiles).toHaveLength(2);
    store.removeSlide(0);
    store.removeSlide(0);
    expect(store.background).toBeNull();
  });

  it('保存 → 読み込みで区切りの指定が残る (ファイルは外れて、同じ画像を選び直すと当たる)', async () => {
    await store.setBackgroundSlides([{ file: png('a.png', 'a'), kind: 'intro' }, { file: png('b.png', 'b'), kind: 'chorus' }]);
    const project = sanitizeProject(JSON.parse(JSON.stringify(buildProjectFile(store))));
    store.removeBackground();
    store.applyProject(project);
    expect(kinds()).toEqual(['intro', 'chorus']);
    expect(store.slideFiles.every((f) => f == null)).toBe(true);
    const r = await store.restoreSlides([png('b.png', 'b'), png('a.png', 'a')]);
    expect(r).toEqual({ matched: 2, total: 2 });
    expect(kinds()).toEqual(['intro', 'chorus']);
  });
});
