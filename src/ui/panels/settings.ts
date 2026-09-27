import { panelSkeleton } from './panel-helpers';

export function renderSettingsPanel(): HTMLElement {
  return panelSkeleton(
    'Settings',
    'プロジェクトの保存/読み込みと、アプリ全体の設定です。',
    'Step 5 (Project JSON) で Save/Load、素材の再リンクなどがここに入ります。',
  );
}
