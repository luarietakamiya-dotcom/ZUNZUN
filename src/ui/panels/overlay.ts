import { panelSkeleton } from './panel-helpers';

export function renderOverlayPanel(): HTMLElement {
  return panelSkeleton(
    'Overlay',
    'ビジュアライザーの上にPNG/WebP/JPGを重ねます。',
    'Step 6 (Overlay Manager) で position/scale/rotation/opacity/layer order/glow/float/beat 反応がここに入ります。',
  );
}
