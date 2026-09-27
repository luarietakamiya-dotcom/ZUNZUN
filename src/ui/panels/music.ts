import { panelSkeleton } from './panel-helpers';

export function renderMusicPanel(): HTMLElement {
  return panelSkeleton(
    'Music',
    '音源を読み込みます。読み込んだ音は外部には送信されません。',
    'Step 2 (AudioEngine) でここに音源読み込み・波形・再生コントロールが入ります。',
  );
}
