import { sectionKindOf, type SectionKind } from '../lyrics/sections';

/**
 * スライドショーの画像の入れ方 (2026-10-03 ユーザー要望「ドラッグ&ドロップで」「サビ用・イントロ用の場所を用意して、
 * ファイル名に関係なく」「フォルダの下にイントロ用フォルダがあったらイントロに使う」)。計算だけ (DOM を使わない)。
 */

/** 画像 1 枚と、その画像を使う区切り (無ければ、ファイル名の言葉で決める) */
export interface SlideEntry {
  file: File;
  kind?: SectionKind;
}

/** 区切りごとの入れ場所の並び (曲の順) */
export const SLIDE_ZONES: readonly SectionKind[] = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'interlude', 'outro'];

/**
 * フォルダの名前の並び (浅い → 深い) から、画像を使う区切りを決める。いちばん深いフォルダから見て、
 * 区切りの言葉 (イントロ・サビ・Chorus など) があるフォルダの種類。どれも無ければ undefined。
 * 「その他」(other) は種類として使わない (指定なしと同じ)
 */
export function folderKindOf(dirs: readonly string[]): SectionKind | undefined {
  for (let i = dirs.length - 1; i >= 0; i--) {
    const k = sectionKindOf(dirs[i]!);
    if (k && k !== 'other') return k;
  }
  return undefined;
}

/** ブラウザがフォルダ選択で付ける、ファイルの場所 (例: "写真/イントロ/a.png") */
function relativeDirs(file: File): string[] {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
  const parts = rel.split('/').filter(Boolean);
  return parts.slice(0, -1);
}

/** 選んだファイル (フォルダ選択なら webkitRelativePath つき) を、フォルダ名から区切りを決めた入れ方にする */
export function entriesFromFiles(files: readonly File[]): SlideEntry[] {
  return files.map((file) => {
    const kind = folderKindOf(relativeDirs(file));
    return kind ? { file, kind } : { file };
  });
}

/** ファイルの場所 (ドラッグ&ドロップで読んだフォルダの中身) つきの入れ方にする */
export function entriesFromPaths(items: readonly { file: File; dirs: readonly string[] }[]): SlideEntry[] {
  return items.map(({ file, dirs }) => {
    const kind = folderKindOf(dirs);
    return kind ? { file, kind } : { file };
  });
}

/** 区切りごとの入れ場所へ入れたファイルは、場所で決まる (フォルダ名より場所を優先) */
export function entriesForZone(files: readonly File[], kind: SectionKind): SlideEntry[] {
  return files.map((file) => ({ file, kind }));
}
