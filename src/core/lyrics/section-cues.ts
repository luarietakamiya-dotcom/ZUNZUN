import type { Section } from './sections';

/** 区間の境目どうしの最小の間隔 (秒)。短すぎる区切りは、ビジュアライザーの切り替えが忙しくなるので間引く */
const MIN_GAP_SEC = 6;

/**
 * 歌詞の見出し ([サビ] など) の区切りから、ビジュアライザーの区間の境目 (秒) を作る。区切りが 2 つ未満なら null
 * (= 音の変化から自動で見つけた境目を使う)。最初の区切りの頭 (0 秒付近) は境目にしない。
 */
export function sectionCuesFrom(sections: readonly Section[]): number[] | null {
  if (sections.length < 2) return null;
  const out: number[] = [];
  for (const s of sections) {
    if (!Number.isFinite(s.start) || s.start < 1) continue;
    if (out.length === 0 || s.start - out[out.length - 1]! >= MIN_GAP_SEC) out.push(s.start);
  }
  return out.length > 0 ? out : null;
}
