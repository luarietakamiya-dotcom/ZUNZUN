/**
 * ドラッグ&ドロップで落とされたものから、ファイルを取り出す。フォルダなら中のファイルも、場所 (フォルダ名の並び) つきで読む
 * (2026-10-03 スライドショーの入れ方。フォルダの下の「イントロ」などのフォルダ名で区切りを決めるため)。
 * フォルダを読めないブラウザや、ファイルだけが落とされたときは、普通のファイルの一覧 (場所なし) にする。
 */

export interface DroppedFile {
  file: File;
  /** フォルダ名の並び (浅い → 深い)。落としたフォルダ自身の名前から始まる。ファイルだけを落としたときは空 */
  dirs: string[];
}

/** 1 つのフォルダから読むファイルの数の上限 (深すぎる・多すぎるフォルダで固まらないように) */
const MAX_FILES = 2000;

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(ok: (f: File) => void, err: (e: unknown) => void): void;
  createReader?(): { readEntries(ok: (entries: FsEntry[]) => void, err: (e: unknown) => void): void };
}

const readFile = (e: FsEntry): Promise<File | null> => new Promise((res) => (e.file ? e.file(res, () => res(null)) : res(null)));

/** フォルダの中身を全部読む (readEntries は 100 件ずつしか返さないので、空になるまで繰り返す) */
async function readAll(dir: FsEntry): Promise<FsEntry[]> {
  const reader = dir.createReader?.();
  if (!reader) return [];
  const out: FsEntry[] = [];
  for (;;) {
    const batch = await new Promise<FsEntry[]>((res) => reader.readEntries(res, () => res([])));
    if (batch.length === 0) break;
    out.push(...batch);
  }
  return out;
}

async function walk(entry: FsEntry, dirs: string[], out: DroppedFile[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  if (entry.isFile) {
    const file = await readFile(entry);
    if (file) out.push({ file, dirs });
  } else if (entry.isDirectory) {
    for (const child of await readAll(entry)) await walk(child, [...dirs, entry.name], out);
  }
}

/** 落とされたもの (DataTransfer) のファイルを、場所つきで取り出す。drop イベントの中 (同期) で呼ぶこと (あとでは entry が取れない) */
export function readDropped(dt: DataTransfer | null): Promise<DroppedFile[]> {
  if (!dt) return Promise.resolve([]);
  const plain = [...dt.files];
  // entry は drop イベントの間にだけ取れるので、先に全部取り出しておく
  const entries: FsEntry[] = [];
  for (const item of [...dt.items]) {
    if (item.kind !== 'file') continue;
    const e = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
    if (e) entries.push(e);
  }
  const hasDir = entries.some((e) => e.isDirectory);
  // フォルダが無ければ、ふつうのファイルの一覧で十分 (entry が取れない環境でも動く)
  if (!hasDir) return Promise.resolve(plain.map((file) => ({ file, dirs: [] })));
  return (async () => {
    const out: DroppedFile[] = [];
    for (const e of entries) await walk(e, [], out);
    return out;
  })();
}
