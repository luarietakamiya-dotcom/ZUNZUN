import { describe, expect, it } from 'vitest';
import { entriesForZone, entriesFromFiles, entriesFromPaths, folderKindOf, SLIDE_ZONES } from './slide-input';

/** フォルダ選択で付く場所 (webkitRelativePath) つきのファイル */
const picked = (path: string): File => {
  const f = new File(['x'], path.split('/').pop()!, { type: 'image/png' });
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
};

describe('folderKindOf (フォルダ名 → 区切り)', () => {
  it('日本語・英語のフォルダ名から区切りを決める。いちばん深いフォルダを優先', () => {
    expect(folderKindOf(['写真', 'イントロ'])).toBe('intro');
    expect(folderKindOf(['photos', 'Chorus'])).toBe('chorus');
    expect(folderKindOf(['サビ', 'イントロ'])).toBe('intro');
    expect(folderKindOf(['イントロ', '2024'])).toBe('intro');
    expect(folderKindOf(['アウトロ'])).toBe('outro');
    expect(folderKindOf(['間奏用'])).toBe('interlude');
  });
  it('言葉が無ければ undefined (指定なし)', () => {
    expect(folderKindOf([])).toBeUndefined();
    expect(folderKindOf(['写真', '旅行'])).toBeUndefined();
  });
  it('入れ場所は 7 つ (曲の順)', () => {
    expect(SLIDE_ZONES).toEqual(['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'interlude', 'outro']);
  });
});

describe('入れ方', () => {
  it('フォルダ選択: 下のフォルダの名前で決まり、直下のファイルは指定なし', () => {
    const files = [picked('素材/イントロ/a.png'), picked('素材/サビ/b.png'), picked('素材/c.png'), picked('素材/その他/d.png')];
    const e = entriesFromFiles(files);
    expect(e.map((x) => x.kind)).toEqual(['intro', 'chorus', undefined, undefined]);
    expect(e.map((x) => x.file)).toEqual(files);
  });
  it('フォルダ選択でない普通のファイル (場所なし) は指定なし', () => {
    const f = new File(['x'], 'sabi.png', { type: 'image/png' });
    expect(entriesFromFiles([f])).toEqual([{ file: f }]);
  });
  it('ドラッグ&ドロップで読んだフォルダの中身 (場所つき) も同じ', () => {
    const a = new File(['x'], 'a.png');
    const b = new File(['x'], 'b.png');
    expect(entriesFromPaths([{ file: a, dirs: ['写真', 'アウトロ'] }, { file: b, dirs: ['写真'] }]).map((x) => x.kind)).toEqual(['outro', undefined]);
  });
  it('区切りごとの入れ場所へ入れたファイルは、その場所で決まる (フォルダ名・ファイル名に関係なく)', () => {
    const f = picked('素材/イントロ/サビ.png');
    expect(entriesForZone([f], 'outro')).toEqual([{ file: f, kind: 'outro' }]);
  });
});
