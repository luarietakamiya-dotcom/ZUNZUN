import { panelSkeleton } from './panel-helpers';

export function renderExportPanel(): HTMLElement {
  return panelSkeleton(
    'Export',
    '映像として書き出します。',
    'Step 7 (Export基盤) で WebCodecs + Mediabunny による MP4 書き出しがここに入ります。',
  );
}
