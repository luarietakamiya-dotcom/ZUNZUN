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

/** アイコンで切り替える主な比率 (押すと、その比率の標準のサイズにする)。ほかの比率・サイズはプルダウンから */
const SWITCH_RATIOS: { ratio: string; w: number; h: number; id: string }[] = [
  { ratio: '16:9', w: 16, h: 9, id: '1920x1080' },
  { ratio: '9:16', w: 9, h: 16, id: '1080x1920' },
  { ratio: '1:1', w: 1, h: 1, id: '1080x1080' },
  { ratio: '2:3', w: 2, h: 3, id: '1080x1620' },
  { ratio: '3:2', w: 3, h: 2, id: '1620x1080' },
];

/**
 * 画面の大きさの切り替え (2026-10-04 UI を正式版に合わせる。段階 2): 比率の形をした 5 つのアイコンボタン + プルダウン (ほかの比率・サイズ)。
 * 選択中のアイコンは光る。同じ比率の別サイズ (1280×720 など) のときも、その比率が光る。
 * すでにその比率のとき、アイコンを押しても大きさは変えない (1280×720 のまま)。持ち主は今までどおり store.exportSettings
 */
export function createSizeSwitcher(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'size-switch';
  root.setAttribute('role', 'group');
  const buttons = new Map<string, HTMLButtonElement>();
  for (const r of SWITCH_RATIOS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'size-ratio';
    b.dataset.sizeRatio = r.ratio;
    // アイコン: 長い辺が 18px の、その比率の四角
    const k = 18 / Math.max(r.w, r.h);
    const icon = document.createElement('span');
    icon.className = 'size-ratio-icon';
    icon.style.width = `${Math.round(r.w * k)}px`;
    icon.style.height = `${Math.round(r.h * k)}px`;
    const label = document.createElement('span');
    label.className = 'size-ratio-label';
    label.textContent = r.ratio;
    b.append(icon, label);
    b.addEventListener('click', () => {
      const { width, height } = store.exportSettings;
      if (Math.abs(width / height - r.w / r.h) / (r.w / r.h) < 0.01) return; // すでにその比率
      const p = EXPORT_SIZE_PRESETS.find((s) => s.id === r.id);
      if (p) store.setExportSettings({ width: p.width, height: p.height });
    });
    buttons.set(r.ratio, b);
    root.appendChild(b);
  }
  const applyTexts = (): void => {
    root.setAttribute('aria-label', tr('画面の大きさ', 'Screen size'));
    for (const r of SWITCH_RATIOS) {
      const p = EXPORT_SIZE_PRESETS.find((s) => s.id === r.id);
      const b = buttons.get(r.ratio)!;
      b.title = p ? t2(p.label) : r.ratio;
      b.setAttribute('aria-label', p ? t2(p.label) : r.ratio);
    }
  };
  const refresh = (): void => {
    const { width, height } = store.exportSettings;
    const cur = width / height;
    for (const r of SWITCH_RATIOS) buttons.get(r.ratio)!.setAttribute('aria-pressed', String(Math.abs(cur - r.w / r.h) / (r.w / r.h) < 0.01));
  };
  applyTexts();
  refresh();
  root.appendChild(createSizeSelect());
  let mounted = false;
  const unsubscribe = store.subscribe(() => {
    if (!root.isConnected) {
      // 載ったあとに外れたら (PC 表示とスマホ表示の切り替えで枠組みを作り直したら) 片づける
      if (mounted) {
        unsubscribe();
        offLang();
      }
      return;
    }
    mounted = true;
    refresh();
  });
  const offLang = onLangChange(applyTexts);
  return root;
}
