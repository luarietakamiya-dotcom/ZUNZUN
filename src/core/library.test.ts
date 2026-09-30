import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchLibraryFile, findLibraryItem, LIBRARY, libraryRef } from './library';

const fileOf = (name: string): Buffer => readFileSync(resolve(process.cwd(), 'src/assets/library', name));

describe('用意された背景 (library)', () => {
  it('一覧の sha256 がファイルの中身と合う (ファイルを差し替えたら一覧も直す)', () => {
    expect(LIBRARY.length).toBe(3);
    for (const item of LIBRARY) {
      const buf = fileOf(item.fileName);
      expect(createHash('sha256').update(buf).digest('hex'), item.id).toBe(item.sha256);
      // WebP (RIFF....WEBP)
      expect(buf.subarray(0, 4).toString('latin1')).toBe('RIFF');
      expect(buf.subarray(8, 12).toString('latin1')).toBe('WEBP');
    }
    expect(new Set(LIBRARY.map((it) => it.id)).size).toBe(LIBRARY.length);
  });

  it('ref と sha256 が合うときだけ見つかる (中身が違うものは勝手に読まない)', () => {
    const item = LIBRARY[1]!;
    expect(libraryRef(item)).toBe(`library:${item.id}`);
    expect(findLibraryItem(libraryRef(item), item.sha256)).toBe(item);
    expect(findLibraryItem(libraryRef(item))).toBe(item);
    expect(findLibraryItem(libraryRef(item), 'f'.repeat(64))).toBeNull();
    expect(findLibraryItem('library:nothing', item.sha256)).toBeNull();
    expect(findLibraryItem(item.fileName, item.sha256)).toBeNull();
    expect(findLibraryItem(undefined)).toBeNull();
  });

  it('読むと File になり、読めなければエラー', async () => {
    const item = LIBRARY[0]!;
    const ok = (async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;
    const file = await fetchLibraryFile(item, ok);
    expect(file.name).toBe(item.fileName);
    expect(file.type).toBe('image/webp');
    expect(file.size).toBe(3);
    const ng = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchLibraryFile(item, ng)).rejects.toThrow('404');
  });
});
