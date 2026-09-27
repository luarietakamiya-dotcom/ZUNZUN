import { panelSkeleton } from './panel-helpers';

export function renderLyricsPanel(): HTMLElement {
  return panelSkeleton(
    'Lyrics',
    '歌詞と歌詞モーションはMVPの範囲外です。',
    'MVP後、半自動タップ同期 + タイムライン調整の機能をここに追加します (docs/ARCHITECTURE.md の「歌詞同期の方針」を参照)。',
  );
}
