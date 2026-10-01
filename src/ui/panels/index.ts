import { renderMusicPanel } from './music';
import { renderVisualizerPanel } from './visualizer';
import { renderLyricsPanel } from './lyrics';
import { renderOverlayPanel } from './overlay';
import { renderSettingsPanel } from './settings';
import { renderExportPanel } from './export';
import { renderHelpPanel } from './help';
import type { Text2 } from '../../core/i18n';

export type PanelId = 'music' | 'visualizer' | 'lyrics' | 'overlay' | 'settings' | 'export' | 'help';

export interface PanelDef {
  label: Text2;
  /** タブにマウスを乗せたときの説明 */
  hint: Text2;
  render(): HTMLElement;
}

/** docs/ARCHITECTURE.md の UI 節にある 6 パネルと、「使い方」(2026-10-01)。 */
export const PANELS: Record<PanelId, PanelDef> = {
  music: { label: { ja: '音楽', en: 'Music' }, hint: { ja: '曲を読み込んで、テンポや音の強さを調べます', en: 'Load a song and analyze its tempo and loudness' }, render: renderMusicPanel },
  visualizer: {
    label: { ja: 'ビジュアライザー', en: 'Visualizer' },
    hint: { ja: '音に合わせて動く映像を選んで、光や動きを調整します', en: 'Pick the music-reactive visuals and tune light and motion' },
    render: renderVisualizerPanel,
  },
  lyrics: { label: { ja: '歌詞', en: 'Lyrics' }, hint: { ja: '歌詞を入れてタイミングを合わせ、歌詞の動きを選びます', en: 'Enter lyrics, sync their timing and choose how they move' }, render: renderLyricsPanel },
  overlay: {
    label: { ja: '背景と素材', en: 'Overlay' },
    hint: { ja: '背景の写真・動画や、ロゴなどの画像を重ねます', en: 'Add a background photo/video and overlay images such as logos' },
    render: renderOverlayPanel,
  },
  settings: { label: { ja: '設定', en: 'Settings' }, hint: { ja: 'プロジェクトの保存・読み込みなど', en: 'Save and load projects and more' }, render: renderSettingsPanel },
  export: { label: { ja: '書き出し', en: 'Export' }, hint: { ja: '動画ファイルに書き出します', en: 'Render to a video file' }, render: renderExportPanel },
  help: { label: { ja: '使い方', en: 'Help' }, hint: { ja: 'かんたんな使い方と、くわしい使い方 (画像付き)', en: 'Quick start and detailed guide (with pictures)' }, render: renderHelpPanel },
};
