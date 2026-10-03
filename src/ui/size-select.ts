import { EXPORT_SIZE_PRESETS } from '../core/export/plan';
import { onLangChange, t2, tr } from '../core/i18n';
import { store } from '../core/store';

/**
 * ヘッダーに置く「画面の大きさ」のプルダウン (2026-10-03 ユーザー「書き出しで選ぶんじゃなく、上のメニューで今どれなのかわかるように、
 * プルダウンメニューで表示しよう」)。選ぶと、プレビューの縦横比・ビジュアライザー・歌詞の組み方・書き出しの大きさが全部これに揃う
 * (書き出しの設定 = store.exportSettings の width / height が唯一の持ち主)。
 * ほかの場所 (読み込んだプロジェクトなど) で大きさが変わったら表示も追従する。画面から外れたら購読をやめる。
 */

/** 「16:9 · 1920×1080」のような短い表示 (一覧の文言から比率を取り出す) */
export function sizeOptionText(preset: { label: { ja: string }; width: number; height: number }): string {
  const ratio = /(\d+:\d+)/.exec(preset.label.ja)?.[1];
  return `${ratio ?? ''}${ratio ? ' · ' : ''}${preset.width}×${preset.height}`;
}

export function createSizeSelect(): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'select size-select';
  select.dataset.shell = 'size';

  const fill = (): void => {
    const { width, height } = store.exportSettings;
    select.replaceChildren();
    for (const p of EXPORT_SIZE_PRESETS) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = sizeOptionText(p);
      opt.title = t2(p.label);
      select.appendChild(opt);
    }
    const current = EXPORT_SIZE_PRESETS.find((p) => p.width === width && p.height === height);
    if (!current) {
      // 一覧に無い大きさ (プロジェクトから読み込んだもの) も、そのまま選べるように見せる
      const opt = document.createElement('option');
      opt.value = 'custom';
      opt.textContent = `${width}×${height}`;
      select.appendChild(opt);
    }
    select.value = current?.id ?? 'custom';
  };
  const applyTexts = (): void => {
    select.title = tr('画面の大きさ (縦横比)。プレビューも書き出しもこの大きさになります', 'Screen size (aspect ratio). The preview and the export both use it');
    select.setAttribute('aria-label', tr('画面の大きさ', 'Screen size'));
  };
  fill();
  applyTexts();

  select.addEventListener('change', () => {
    const p = EXPORT_SIZE_PRESETS.find((s) => s.id === select.value);
    if (p) store.setExportSettings({ width: p.width, height: p.height });
  });

  let mounted = false;
  const sync = (): void => {
    if (!select.isConnected) {
      // 載ったあとに外れたら (PC 表示とスマホ表示の切り替えで枠組みを作り直したら) 片づける
      if (mounted) {
        unsubscribe();
        offLang();
      }
      return;
    }
    mounted = true;
    const { width, height } = store.exportSettings;
    const id = EXPORT_SIZE_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? 'custom';
    if (select.value !== id || (id === 'custom') !== (select.querySelector('option[value="custom"]') != null)) fill();
  };
  const unsubscribe = store.subscribe(sync);
  const offLang = onLangChange(applyTexts);
  return select;
}
