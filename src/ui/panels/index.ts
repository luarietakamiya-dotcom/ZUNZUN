import { renderMusicPanel } from './music';
import { renderVisualizerPanel } from './visualizer';
import { renderLyricsPanel } from './lyrics';
import { renderOverlayPanel } from './overlay';
import { renderSettingsPanel } from './settings';
import { renderExportPanel } from './export';

export type PanelId = 'music' | 'visualizer' | 'lyrics' | 'overlay' | 'settings' | 'export';

export interface PanelDef {
  label: string;
  render(): HTMLElement;
}

/** docs/ARCHITECTURE.md の UI 節にある 6 パネル。 */
export const PANELS: Record<PanelId, PanelDef> = {
  music: { label: 'Music', render: renderMusicPanel },
  visualizer: { label: 'Visualizer', render: renderVisualizerPanel },
  lyrics: { label: 'Lyrics', render: renderLyricsPanel },
  overlay: { label: 'Overlay', render: renderOverlayPanel },
  settings: { label: 'Settings', render: renderSettingsPanel },
  export: { label: 'Export', render: renderExportPanel },
};
