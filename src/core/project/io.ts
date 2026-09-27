import type { ProjectFile } from '../types';

const FILE_EXTENSION = '.zunzun.json';

/**
 * File System Access API (showSaveFilePicker) が使えるブラウザ向けの、ごく小さな構造的型。
 * lib.dom.d.ts には含まれていない実験的 API なので、ここで必要な形だけを自前で宣言する
 * (@types の追加や tsconfig の lib 拡張を避けるため)。
 */
interface SaveFileWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface SaveFileHandle {
  createWritable(): Promise<SaveFileWritable>;
}
type ShowSaveFilePicker = (opts: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<SaveFileHandle>;

function withExtension(name: string): string {
  return name.endsWith(FILE_EXTENSION) ? name : `${name}${FILE_EXTENSION}`;
}

/**
 * プロジェクトを JSON ファイルとして保存する。
 * showSaveFilePicker が使えるブラウザ (Chrome/Edge) では保存先を選べる。
 * 使えない場合は通常のダウンロードにフォールバックする。
 * ブラウザ API に依存するため decode.ts/player.ts/hash.ts と同様 Vitest の対象外。
 */
export async function saveProjectToFile(project: ProjectFile, suggestedName = 'project'): Promise<void> {
  const json = JSON.stringify(project, null, 2);
  const fileName = withExtension(suggestedName);

  const w = window as unknown as { showSaveFilePicker?: ShowSaveFilePicker };
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'ZUNZUN Project', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // ユーザーがキャンセルした
      // showSaveFilePicker が失敗した場合は下のダウンロード方式にフォールバックする
    }
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** File からプロジェクト JSON (未検証) を読み込む。検証は sanitizeProject() を別途呼ぶこと。 */
export async function readProjectFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text) as unknown;
}
