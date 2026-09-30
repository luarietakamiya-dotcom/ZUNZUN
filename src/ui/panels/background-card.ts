import { store } from '../../core/store';
import type { BackgroundSettings } from '../../core/types';
import { t2, tr, type Text2 } from '../../core/i18n';
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

const BLEND_LABELS: Record<BackgroundSettings['blend'], Text2> = {
  screen: { ja: 'スクリーン (黒い部分は透けて、光だけが背景に乗る。おすすめ)', en: 'Screen (black becomes see-through, only light is added. Recommended)' },
  add: { ja: '加算 (スクリーンより明るい。真っ白になりやすい)', en: 'Add (brighter than Screen, blows out to white easily)' },
  over: { ja: 'そのまま上に (「ビジュアライザーの濃さ」で透かす。1 なら背景は見えない)', en: 'Normal (see through by "Visualizer opacity". At 1 the background is hidden)' },
};

const SLIDERS: { key: 'dim' | 'blur' | 'visualizerOpacity'; label: Text2; help: Text2 }[] = [
  { key: 'dim', label: { ja: '背景の暗さ', en: 'Background dim' }, help: { ja: '上げるほど背景が暗くなり、ビジュアライザーが見やすくなります', en: 'Darkens the background so the visuals stand out' } },
  { key: 'blur', label: { ja: '背景のぼかし', en: 'Background blur' }, help: { ja: '背景をぼかして、手前を目立たせます', en: 'Blurs the background so the foreground stands out' } },
  { key: 'visualizerOpacity', label: { ja: 'ビジュアライザーの濃さ', en: 'Visualizer opacity' }, help: { ja: '0 = ビジュアライザーを消す、1 = そのまま', en: '0 = hide the visuals, 1 = full strength' } },
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
        'ビジュアライザーの奥に写真か動画 (MP4 (H.264) / WebM) を敷きます。ビジュアライザーは背景の上に重ねて描きます (スクリーンなら、黒い部分は透けて光だけが乗ります)。背景には光のにじみはかかりません。動画の音は使いません。動画は曲と同じ時刻から流れ、曲より短ければくり返すか最後の絵で止めます。見た目は「ビジュアライザー」タブで確かめてください。',
        'Place a photo or video (MP4 (H.264) / WebM) behind the visuals. The visuals are drawn on top (with Screen, black is see-through and only light is added). The background gets no glow. Video sound is not used. The video plays from the same time as the song; if shorter it loops or holds the last frame. Check the result in the Visualizer tab.',
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
  const status = h('div', 'param-label');
  const body = h('div', 'background-body');
  root.append(fileRow, status, body);

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
    if (!bg) {
      status.textContent = tr('背景はありません。', 'No background.');
      return;
    }
    status.textContent = file
      ? tr(`「${bg.ref}」`, `"${bg.ref}"`)
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
    const blend = h('select', 'select');
    for (const [v, label] of Object.entries(BLEND_LABELS)) {
      const o = h('option', '', t2(label));
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
    grid.append(selRow(tr('収め方', 'Fit'), fit), selRow(tr('ビジュアライザーの重ね方', 'How the visuals are layered'), blend));
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
