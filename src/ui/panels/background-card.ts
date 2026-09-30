import { store } from '../../core/store';
import type { BackgroundSettings } from '../../core/types';
import { t2, tr, type Text2 } from '../../core/i18n';
import { findLibraryItem, LIBRARY, libraryRef } from '../../core/library';
import { sliderRow } from './panel-helpers';

/**
 * Overlay タブの「背景」欄。一枚絵か動画を選び、収め方・暗さ・ぼかし (画像だけ)・ビジュアライザーの重ね方と濃さ・
 * 動画のくり返しを決める。見た目は Visualizer タブで確かめる (Overlay タブにはライブプレビューが無い)。
 * 動画の音は使わない。プレビューは曲の位置に合わせて流すだけで、書き出しは各フレームの時刻ちょうどの絵を使う。
 * 設定は store (Project JSON の background)、元のファイルは store にメモリだけで持つ (Project JSON には ref/sha256 だけ)。
 */

const ACCEPT = 'image/png,image/webp,image/jpeg,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v';

/** ファイルの種類から、画像か動画かを決める */
function kindOf(file: File): 'image' | 'video' {
  return file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name) ? 'video' : 'image';
}

const SLIDERS: { key: 'dim' | 'blur'; label: Text2; help: Text2 }[] = [
  { key: 'dim', label: { ja: '背景の暗さ', en: 'Background dim' }, help: { ja: '上げるほど背景が暗くなり、ビジュアライザーが見やすくなります', en: 'Darkens the background so the visuals stand out' } },
  { key: 'blur', label: { ja: '背景のぼかし', en: 'Background blur' }, help: { ja: '背景をぼかして、手前を目立たせます', en: 'Blurs the background so the foreground stands out' } },
];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** サムネイル用の URL (ファイルごとに 1 つ。タブを切り替えても作り直さない) */
let thumb: { file: File; url: string } | null = null;
function thumbUrl(file: File): string {
  if (thumb?.file !== file) {
    if (thumb) URL.revokeObjectURL(thumb.url);
    thumb = { file, url: URL.createObjectURL(file) };
  }
  return thumb.url;
}

export function createBackgroundCard(): HTMLElement {
  const root = h('div', 'background-card');
  root.append(
    h('h3', 'lyrics-h3', tr('背景 (写真・動画)', 'Background (photo / video)')),
    h(
      'p',
      'lyrics-help',
      tr(
        '写真か動画 (MP4 (H.264) / WebM) を背景に敷きます。重なる順番とビジュアライザーの重ね方は、上の「レイヤー」で変えられます (スクリーンなら、ビジュアライザーの黒い部分は透けて光だけが乗ります)。背景には光のにじみはかかりません。動画の音は使いません。動画は曲と同じ時刻から流れ、曲より短ければくり返すか最後の絵で止めます。見た目は「ビジュアライザー」タブで確かめてください。',
        'Place a photo or video (MP4 (H.264) / WebM) as the background. Change the stacking order and how the visuals are layered in "Layers" above (with Screen, the visuals\' black is see-through and only light is added). The background gets no glow. Video sound is not used. The video plays from the same time as the song; if shorter it loops or holds the last frame. Check the result in the Visualizer tab.',
      ),
    ),
  );
  const fileRow = h('div', 'row-gap lyrics-row-wrap');
  const input = h('input');
  input.type = 'file';
  input.accept = ACCEPT;
  const removeBtn = h('button', 'tab-button', tr('背景を外す', 'Remove background'));
  removeBtn.type = 'button';
  fileRow.append(h('span', 'param-label', tr('写真・動画を選ぶ:', 'Choose a photo / video:')), input, removeBtn);
  // 用意された背景 (core/library.ts)。押すとすぐ背景になる
  const libRow = h('div', 'library-row');
  const libButtons: HTMLButtonElement[] = [];
  for (const item of LIBRARY) {
    const b = h('button', 'library-thumb');
    b.type = 'button';
    b.dataset.library = item.id;
    const img = h('img');
    img.src = item.url;
    img.alt = t2(item.name);
    img.loading = 'lazy';
    b.append(img, h('span', '', t2(item.name)));
    b.addEventListener('click', () => {
      status.textContent = tr(`「${t2(item.name)}」を読み込んでいます…`, `Loading "${t2(item.name)}"…`);
      store
        .setBackgroundFromLibrary(item.id)
        .then(() => render())
        .catch((err: unknown) => {
          status.textContent = `${tr('読み込めませんでした', 'Could not load')}: ${err instanceof Error ? err.message : String(err)}`;
        });
    });
    libButtons.push(b);
    libRow.appendChild(b);
  }
  const status = h('div', 'param-label');
  const body = h('div', 'background-body');
  root.append(fileRow, h('span', 'param-label', tr('用意された背景から選ぶ:', 'Or pick a built-in background:')), libRow, status, body);

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    status.textContent = tr(`「${file.name}」を読み込んでいます…`, `Loading "${file.name}"…`);
    store
      .setBackgroundFile(file, kindOf(file))
      .then(() => render())
      .catch((err: unknown) => {
        status.textContent = `${tr('読み込めませんでした', 'Could not load')}: ${err instanceof Error ? err.message : String(err)}`;
      })
      .finally(() => {
        input.value = '';
      });
  });
  removeBtn.addEventListener('click', () => {
    store.removeBackground();
    render();
  });

  function render(): void {
    const bg = store.background;
    const file = store.backgroundFile;
    body.textContent = '';
    removeBtn.disabled = bg == null;
    const lib = bg ? findLibraryItem(bg.ref, bg.sha256) : null;
    for (const b of libButtons) b.setAttribute('aria-pressed', String(lib != null && bg?.ref === libraryRef(lib) && b.dataset.library === lib.id));
    if (!bg) {
      status.textContent = tr('背景はありません。', 'No background.');
      return;
    }
    if (lib && !file) {
      // プロジェクトを開いた直後: 用意された背景は自動で読み込む
      status.textContent = tr(`「${t2(lib.name)}」を読み込んでいます…`, `Loading "${t2(lib.name)}"…`);
      store
        .restoreLibraryBackground()
        .then(() => {
          if (root.isConnected && store.backgroundFile) render();
        })
        .catch((err: unknown) => {
          status.textContent = `${tr('読み込めませんでした', 'Could not load')}: ${err instanceof Error ? err.message : String(err)}`;
        });
      return;
    }
    const shownName = lib ? t2(lib.name) : bg.ref;
    status.textContent = file
      ? tr(`「${shownName}」`, `"${shownName}"`)
      : tr(`このプロジェクトは背景に「${bg.ref}」を使います。同じファイルを選び直してください (選び直すまでは背景なしで描きます)。`, `This project uses "${bg.ref}" as its background. Please pick the same file again (until then no background is drawn).`);
    if (file) {
      if (bg.kind === 'video') {
        const v = h('video', 'background-thumb');
        v.src = thumbUrl(file);
        v.muted = true;
        v.controls = true;
        v.preload = 'metadata';
        body.appendChild(v);
      } else {
        const img = h('img', 'background-thumb');
        img.src = thumbUrl(file);
        img.alt = bg.ref;
        body.appendChild(img);
      }
    }
    const grid = h('div', 'param-grid');
    // 収め方・重ね方
    const fit = h('select', 'select');
    for (const [v, label] of [['cover', tr('画面いっぱい (はみ出した部分は切る)', 'Fill the screen (crop the overflow)')], ['contain', tr('全体を収める (余りは黒)', 'Fit inside (black bars)')]] as const) {
      const o = h('option', '', label);
      o.value = v;
      fit.appendChild(o);
    }
    fit.value = bg.fit;
    fit.addEventListener('change', () => store.updateBackground({ fit: fit.value as BackgroundSettings['fit'] }));
    const selRow = (label: string, el: HTMLElement): HTMLElement => {
      const r = h('label', 'param-row');
      r.append(h('span', 'param-label', label), el);
      return r;
    };
    grid.append(selRow(tr('収め方', 'Fit'), fit));
    if (bg.kind === 'video') {
      const loop = h('input');
      loop.type = 'checkbox';
      loop.checked = bg.loop;
      loop.addEventListener('change', () => store.updateBackground({ loop: loop.checked }));
      const r = h('label', 'row-gap param-label');
      r.append(loop, tr('曲より短いときはくり返す (オフなら最後の絵で止める)', 'Loop when shorter than the song (off = hold the last frame)'));
      grid.appendChild(r);
    }
    // ぼかしは画像だけ (動画を毎フレームぼかすのは重いので、今は付けていない)
    for (const def of SLIDERS.filter((d) => d.key !== 'blur' || bg.kind === 'image')) {
      const { row: r, input: range, setLabel } = sliderRow(def.label, def.help, 0, 1, 0.01);
      range.value = String(bg[def.key]);
      setLabel(bg[def.key].toFixed(2));
      range.addEventListener('input', () => {
        const v = parseFloat(range.value);
        store.updateBackground({ [def.key]: v });
        setLabel(v.toFixed(2));
      });
      grid.appendChild(r);
    }
    body.appendChild(grid);
  }

  render();
  return root;
}
