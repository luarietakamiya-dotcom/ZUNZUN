import type { LyricMotion } from '../../core/lyrics/jizura-adapter';
import { previewMotionProvider } from '../../core/lyrics/motion-provider';
import { backgroundPaletteNow } from '../../core/render/palette';
import { store } from '../../core/store';
import { tr } from '../../core/i18n';

/**
 * 今のプロジェクトの状態で、プレビュー用の歌詞の動きをもらう (曲が無ければ null)。
 * どのタブからも毎フレーム呼んでよい (同じ設定なら作り直さない)。歌詞タブも呼ぶので、時刻を変えたら「反映」ボタンが出る
 */
export function previewMotionNow(opts: { build?: boolean } = {}): LyricMotion | null {
  if (!store.audio.isLoaded) return null;
  return previewMotionProvider.get(
    {
    lyrics: store.lyrics,
    analysis: store.audio.analysis,
    projectSeed: store.seed,
    width: store.exportSettings.width,
    height: store.exportSettings.height,
    fps: store.exportSettings.fps,
    rhythm: store.rhythm,
    palette: backgroundPaletteNow(store.background, store.backgroundFile),
    },
    opts,
  );
}

/**
 * 「時刻の変更を歌詞の動きに反映」のお知らせとボタン (Lyrics タブのタイムラインの下と、Visualizer タブ)。
 * 時刻だけを変えたときは、歌詞の動きを自動では作り直さない (作り直しの間は画面が少し止まるため。core/lyrics/motion-provider.ts)。
 * update() を毎フレーム呼ぶと、反映を待っている間だけ出る。
 */
export function createMotionApplyNotice(): { element: HTMLElement; update(): void } {
  const element = document.createElement('div');
  element.className = 'row-gap lyrics-row-wrap motion-apply';
  element.dataset.lyrics = 'motion-apply';
  element.hidden = true;
  const text = document.createElement('span');
  text.className = 'param-label';
  text.textContent = tr(
    '歌詞の時刻を変えました。歌詞の動き (見本・ビジュアライザーの上) は、まだ前の時刻のままです。',
    'Lyric timing changed. The lyric motion (preview / over the visuals) still uses the previous timing.',
  );
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tab-button';
  btn.dataset.lyrics = 'motion-apply-button';
  btn.textContent = tr('反映', 'Apply');
  btn.title = tr('歌詞の動きを今の時刻で作り直します (少しのあいだ画面が止まります)', 'Rebuilds the lyric motion with the current timing (the screen pauses briefly)');
  // 押したらすぐ作り直す (歌詞タブは自分では作り直さないので、ここで頼む)
  btn.addEventListener('click', () => {
    previewMotionProvider.apply();
    previewMotionNow();
  });
  element.append(text, btn);
  return {
    element,
    update(): void {
      const show = previewMotionProvider.hasPendingTiming;
      if (element.hidden === show) element.hidden = !show;
    },
  };
}
