import { panelSkeleton } from './panel-helpers';

export function renderVisualizerPanel(): HTMLElement {
  return panelSkeleton(
    'Visualizer',
    '完成済みの世界観プリセットをサムネイルから選びます。',
    'Step 3 (Visualizer Registry/Host) でプリセット一覧と共通パラメータ (Intensity/Sensitivity/Bass/Mid/High/Glow/Motion/Color Theme/Camera Motion) がここに入ります。',
  );
}
