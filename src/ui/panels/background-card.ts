import { store } from '../../core/store';
import type { BackgroundSettings } from '../../core/types';

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

const BLEND_LABELS: Record<BackgroundSettings['blend'], string> = {
  screen: 'スクリーン (黒は透けて、光だけが背景に乗る。おすすめ)',
  add: '加算 (スクリーンより明るく、白飛びしやすい)',
  over: 'そのまま上に (濃さで背景を透かす。濃さ 1 なら背景は見えない)',
};

const SLIDERS: { key: 'dim' | 'blur' | 'visualizerOpacity'; label: string }[] = [
  { key: 'dim', label: '背景の暗さ (上げるとビジュアライザーが見やすい)' },
  { key: 'blur', label: '背景のぼかし' },
  { key: 'visualizerOpacity', label: 'ビジュアライザーの濃さ' },
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
    h('h3', 'lyrics-h3', '背景 (一枚絵・動画)'),
    h(
      'p',
      'lyrics-help',
      'ビジュアライザーの奥に一枚絵か動画 (MP4 (H.264) / WebM) を敷きます。ビジュアライザーは背景の上に重ねて描きます (スクリーンなら、黒い部分は透けて光だけが乗ります)。' +
        '背景には Bloom がかかりません。動画の音は使いません。動画は曲と同じ時刻から流れ、曲より短ければくり返すか最後の絵で止めます。見た目は Visualizer タブで確かめてください。',
    ),
  );
  const fileRow = h('div', 'row-gap lyrics-row-wrap');
  const input = h('input');
  input.type = 'file';
  input.accept = ACCEPT;
  const removeBtn = h('button', 'tab-button', '背景を外す');
  removeBtn.type = 'button';
  fileRow.append(h('span', 'param-label', '画像・動画を選ぶ:'), input, removeBtn);
  const status = h('div', 'param-label');
  const body = h('div', 'background-body');
  root.append(fileRow, status, body);

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    status.textContent = `「${file.name}」を読み込んでいます…`;
    store
      .setBackgroundFile(file, kindOf(file))
      .then(() => render())
      .catch((err: unknown) => {
        status.textContent = `読み込めませんでした: ${err instanceof Error ? err.message : String(err)}`;
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
    if (!bg) {
      status.textContent = '背景はありません。';
      return;
    }
    status.textContent = file
      ? `「${bg.ref}」`
      : `このプロジェクトは背景「${bg.ref}」を使う設定です。同じファイルを選び直してください (選び直すまでは背景なしで描きます)。`;
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
    for (const [v, label] of [['cover', '画面いっぱい (はみ出しは切る)'], ['contain', '全体を収める (余りは黒)']] as const) {
      const o = h('option', '', label);
      o.value = v;
      fit.appendChild(o);
    }
    fit.value = bg.fit;
    fit.addEventListener('change', () => store.updateBackground({ fit: fit.value as BackgroundSettings['fit'] }));
    const blend = h('select', 'select');
    for (const [v, label] of Object.entries(BLEND_LABELS)) {
      const o = h('option', '', label);
      o.value = v;
      blend.appendChild(o);
    }
    blend.value = bg.blend;
    blend.addEventListener('change', () => store.updateBackground({ blend: blend.value as BackgroundSettings['blend'] }));
    const selRow = (label: string, el: HTMLElement): HTMLElement => {
      const r = h('label', 'param-row');
      r.append(h('span', 'param-label', label), el);
      return r;
    };
    grid.append(selRow('収め方', fit), selRow('ビジュアライザーの重ね方', blend));
    if (bg.kind === 'video') {
      const loop = h('input');
      loop.type = 'checkbox';
      loop.checked = bg.loop;
      loop.addEventListener('change', () => store.updateBackground({ loop: loop.checked }));
      const r = h('label', 'row-gap param-label');
      r.append(loop, '曲より短いときはくり返す (オフなら最後の絵で止める)');
      grid.appendChild(r);
    }
    // ぼかしは画像だけ (動画を毎フレームぼかすのは重いので、今は付けていない)
    for (const def of SLIDERS.filter((d) => d.key !== 'blur' || bg.kind === 'image')) {
      const r = h('label', 'param-row');
      const label = h('span', 'param-label');
      const range = h('input');
      range.type = 'range';
      range.min = '0';
      range.max = '1';
      range.step = '0.01';
      range.value = String(bg[def.key]);
      const show = (v: number): void => {
        label.textContent = `${def.label}: ${v.toFixed(2)}`;
      };
      show(bg[def.key]);
      range.addEventListener('input', () => {
        const v = parseFloat(range.value);
        store.updateBackground({ [def.key]: v });
        show(v);
      });
      r.append(label, range);
      grid.appendChild(r);
    }
    body.appendChild(grid);
  }

  render();
  return root;
}
