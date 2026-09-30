import speakerAlleyUrl from '../assets/library/speaker-alley.webp';
import speakerRackUrl from '../assets/library/speaker-rack.webp';
import stageLightsUrl from '../assets/library/stage-lights.webp';
import type { Text2 } from './i18n';

/**
 * 用意された背景 (アプリと一緒に配る画像。docs/ARCHITECTURE.md「用意された背景」)。
 * ファイルは src/assets/library/ にあり、同じサーバーから読むだけ (外部には送らない)。
 * Project JSON には、ほかの背景と同じく中身を入れず、ref = `library:<id>` と sha256 だけを保存する。
 * 開き直したときは、ref と sha256 がこの一覧と合えば自動で読み込む (選び直さなくてよい)。
 * 画像はユーザーが用意したもの (2026-09-30「3 枚をリポジトリに入れて」)。
 */

export interface LibraryItem {
  id: string;
  kind: 'background';
  name: Text2;
  /** 読み込む URL (Vite が組み立てる) */
  url: string;
  /** ファイルの sha256 (library.test.ts でファイルと突き合わせる) */
  sha256: string;
  /** ファイル名 (保存・書き出しの表示用) */
  fileName: string;
}

export const LIBRARY: readonly LibraryItem[] = [
  {
    id: 'stage-lights',
    kind: 'background',
    name: { ja: 'ライブステージ (照明とスモーク)', en: 'Live stage (lights and haze)' },
    url: stageLightsUrl,
    sha256: 'a90e66284c8adcef120f0ee56ca3176e347f30aa403b1949e26293ca415845de',
    fileName: 'stage-lights.webp',
  },
  {
    id: 'speaker-rack',
    kind: 'background',
    name: { ja: 'スピーカーと機材ラック', en: 'Speakers and gear rack' },
    url: speakerRackUrl,
    sha256: '9795679e34d5d55f2dd6c0359579766ca6a433d78103414f7344727d24c77c46',
    fileName: 'speaker-rack.webp',
  },
  {
    id: 'speaker-alley',
    kind: 'background',
    name: { ja: 'スピーカーの通路', en: 'Speaker alley' },
    url: speakerAlleyUrl,
    sha256: 'ad9c1037ef639757fc1ce36235efed8526bfbccb5f4821e48f26fb9f4c739b4c',
    fileName: 'speaker-alley.webp',
  },
];

const PREFIX = 'library:';

export const libraryRef = (item: LibraryItem): string => `${PREFIX}${item.id}`;

/** ref と sha256 が一覧のどれかと合えば、その項目 (合わなければ null。中身が違うものを勝手に読まない) */
export function findLibraryItem(ref: string | undefined, sha256?: string): LibraryItem | null {
  if (!ref || !ref.startsWith(PREFIX)) return null;
  const item = LIBRARY.find((it) => libraryRef(it) === ref);
  if (!item) return null;
  if (sha256 !== undefined && sha256 !== item.sha256) return null;
  return item;
}

/** 用意された画像を File として読む (同じサーバーから) */
export async function fetchLibraryFile(item: LibraryItem, fetchFn: typeof fetch = fetch): Promise<File> {
  const res = await fetchFn(item.url);
  if (!res.ok) throw new Error(`${item.fileName}: HTTP ${res.status}`);
  return new File([await res.arrayBuffer()], item.fileName, { type: 'image/webp' });
}
