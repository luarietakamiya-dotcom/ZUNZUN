import { t2, tr, type Text2 } from '../../core/i18n';
import { store } from '../../core/store';
import type { ChromaKey, MediaLayer } from '../../core/types';
import { sliderRow } from './panel-helpers';

/**
 * 「背景と素材」タブの「素材」欄: 画像・動画を足して、位置・大きさ・回転・濃さ・重ね方・クロマキー (グリーンバックを透かす) を決める。
 * 重なる順番は上の「レイヤー」で変える。見た目は「ビジュアライザー」タブで確かめる。
 * 透かす色は、サムネイルの上を押すとその場所の色を拾う (スポイト)。
 */

const ACCEPT = 'image/png,image/webp,image/jpeg,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v';

function kindOf(file: File): MediaLayer['kind'] {
  return file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name) ? 'video' : 'image';
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** サムネイル用の URL (素材ごとに 1 つ。タブを切り替えても作り直さない) */
const thumbs = new Map<string, { file: File; url: string }>();
function thumbUrl(id: string, file: File): string {
  const t = thumbs.get(id);
  if (t?.file === file) return t.url;
  if (t) URL.revokeObjectURL(t.url);
  const url = URL.createObjectURL(file);
  thumbs.set(id, { file, url });
  return url;
}

const TRANSFORM: { key: 'x' | 'y' | 'scale' | 'rotation' | 'opacity'; label: Text2; help: Text2; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
  { key: 'x', label: { ja: '横の位置', en: 'X' }, help: { ja: '0 = 左の端、1 = 右の端', en: '0 = left edge, 1 = right edge' }, min: -0.5, max: 1.5, step: 0.01, fmt: (v) => v.toFixed(2) },
  { key: 'y', label: { ja: '縦の位置', en: 'Y' }, help: { ja: '0 = 下の端、1 = 上の端', en: '0 = bottom edge, 1 = top edge' }, min: -0.5, max: 1.5, step: 0.01, fmt: (v) => v.toFixed(2) },
  { key: 'scale', label: { ja: '大きさ', en: 'Scale' }, help: { ja: '画面の高さに対する大きさ。1 = 画面の高さと同じ', en: 'Height relative to the screen. 1 = full height' }, min: 0.05, max: 3, step: 0.01, fmt: (v) => v.toFixed(2) },
  { key: 'rotation', label: { ja: '回転', en: 'Rotation' }, help: { ja: 'プラス = 反時計回り', en: 'Positive = counter-clockwise' }, min: -180, max: 180, step: 1, fmt: (v) => `${Math.round(v)}°` },
  { key: 'opacity', label: { ja: '濃さ', en: 'Opacity' }, help: { ja: '0 = 見えない、1 = くっきり', en: '0 = invisible, 1 = fully visible' }, min: 0, max: 1, step: 0.01, fmt: (v) => v.toFixed(2) },
];

const CHROMA: { key: 'tolerance' | 'softness' | 'spill'; label: Text2; help: Text2 }[] = [
  { key: 'tolerance', label: { ja: '透かす範囲', en: 'Tolerance' }, help: { ja: '上げるほど、選んだ色に少し似た色まで透けます。人や物まで透けたら下げてください', en: 'Higher also removes colors that are only similar. Lower it if the subject disappears' } },
  { key: 'softness', label: { ja: '境目のぼかし', en: 'Softness' }, help: { ja: '透ける所と残る所の境目を、なめらかにします', en: 'Smooths the edge between removed and kept areas' } },
  { key: 'spill', label: { ja: '緑のにじみ取り', en: 'Spill removal' }, help: { ja: '人や物の縁に残る、背景の色 (緑など) のにじみを消します', en: 'Removes the background color (e.g. green) bleeding onto edges' } },
];

const BLENDS: { value: MediaLayer['blend']; label: Text2 }[] = [
  { value: 'normal', label: { ja: 'そのまま上に', en: 'Normal' } },
  { value: 'screen', label: { ja: 'スクリーン (黒い部分は透けて、明るい所だけ乗る)', en: 'Screen (black is see-through, only bright parts show)' } },
  { value: 'add', label: { ja: '加算 (光のように明るく足す)', en: 'Add (brightens like light)' } },
];

/** サムネイル (画像・動画) の押した場所の色 (#rrggbb) */
function pickColor(el: HTMLImageElement | HTMLVideoElement, ev: MouseEvent): string | null {
  const rect = el.getBoundingClientRect();
  const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const hgt = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!w || !hgt || rect.width <= 0 || rect.height <= 0) return null;
  // object-fit: contain で表示しているので、余白を除いた絵の範囲から座標を出す
  const k = Math.min(rect.width / w, rect.height / hgt);
  const ox = (rect.width - w * k) / 2;
  const oy = (rect.height - hgt * k) / 2;
  const px = Math.floor((ev.clientX - rect.left - ox) / k);
  const py = Math.floor((ev.clientY - rect.top - oy) / k);
  if (px < 0 || py < 0 || px >= w || py >= hgt) return null;
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const g = c.getContext('2d');
  if (!g) return null;
  g.drawImage(el, px, py, 1, 1, 0, 0, 1, 1);
  const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
  return '#' + [r, gg, b].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('');
}

export function createMediaCard(onChange: () => void): HTMLElement {
  const root = h('div', 'background-card media-card');
  root.append(
    h('h3', 'lyrics-h3', tr('素材 (画像・動画、グリーンバックも)', 'Media (images / videos, green screen too)')),
    h(
      'p',
      'lyrics-help',
      tr(
        '画像や動画を好きな位置に置けます。グリーンバックの素材は「色を透かす」をオンにして、サムネイルの緑の所を押すと、その色が透けます。透明な部分がある PNG は、そのまま透けます。重なる順番は上の「レイヤー」で変えられます。',
        'Place images or videos anywhere. For green-screen footage, turn on "Remove a color" and click the green area of the thumbnail to make it transparent. PNGs with transparency are see-through as-is. Change the stacking order in "Layers" above.',
      ),
    ),
  );
  const addRow = h('div', 'row-gap lyrics-row-wrap');
  const input = h('input');
  input.type = 'file';
  input.accept = ACCEPT;
  const status = h('div', 'param-label');
  addRow.append(h('span', 'param-label', tr('素材を足す:', 'Add media:')), input);
  const list = h('div', 'media-list');
  root.append(addRow, status, list);

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    status.textContent = tr(`「${file.name}」を読み込んでいます…`, `Loading "${file.name}"…`);
    store
      .addMedia(file, kindOf(file))
      .then(() => {
        status.textContent = '';
        render();
        onChange();
      })
      .catch((err: unknown) => {
        status.textContent = `${tr('読み込めませんでした', 'Could not load')}: ${err instanceof Error ? err.message : String(err)}`;
      });
  });

  const render = (): void => {
    list.textContent = '';
    if (store.media.length === 0) {
      list.appendChild(h('div', 'placeholder-card', tr('素材はまだありません。', 'No media yet.')));
      return;
    }
    for (const m of store.media) list.appendChild(renderItem(m));
  };

  const renderItem = (m: MediaLayer): HTMLElement => {
    const item = h('div', 'overlay-item media-item');
    item.dataset.media = m.id;
    const head = h('div', 'overlay-item-header');
    const file = store.getMediaFile(m.id);
    const setChroma = (patch: Partial<ChromaKey>): void => {
      const cur = store.media.find((x) => x.id === m.id);
      if (cur) store.updateMedia(m.id, { chroma: { ...cur.chroma, ...patch } });
    };
    let colorInput: HTMLInputElement | null = null;
    if (file) {
      const thumb = m.kind === 'video' ? h('video', 'media-thumb') : h('img', 'media-thumb');
      if (thumb instanceof HTMLVideoElement) {
        thumb.src = thumbUrl(m.id, file);
        thumb.muted = true;
        thumb.controls = true;
        thumb.preload = 'metadata';
      } else {
        thumb.src = thumbUrl(m.id, file);
        thumb.alt = m.ref;
      }
      thumb.title = tr('押した場所の色を「透かす色」にします', 'Click to use that color as the color to remove');
      thumb.addEventListener('click', (ev: Event) => {
        const c = pickColor(thumb, ev as MouseEvent);
        if (!c) return;
        setChroma({ color: c, enabled: true });
        render();
      });
      head.appendChild(thumb);
    } else {
      const miss = h('div', 'overlay-thumb overlay-thumb-missing', '?');
      head.appendChild(miss);
    }
    head.appendChild(h('span', 'overlay-name', m.ref));
    item.appendChild(head);
    if (!file) {
      const relink = h('div', 'placeholder-card', tr(`プロジェクトで使っている「${m.ref}」がまだ読み込まれていません。同じファイルを選び直してください。`, `"${m.ref}" used by the project is not loaded yet. Please pick the same file again.`));
      const re = h('input');
      re.type = 'file';
      re.accept = ACCEPT;
      re.addEventListener('change', () => {
        const f = re.files?.[0];
        if (!f) return;
        store.relinkMedia(m.id, f);
        render();
        onChange();
      });
      relink.appendChild(re);
      item.appendChild(relink);
    }
    const grid = h('div', 'param-grid');
    for (const def of TRANSFORM) {
      const { row, input: r, setLabel } = sliderRow(def.label, def.help, def.min, def.max, def.step);
      r.value = String(m[def.key]);
      setLabel(def.fmt(m[def.key]));
      r.dataset.media = def.key;
      r.addEventListener('input', () => {
        const v = parseFloat(r.value);
        store.updateMedia(m.id, { [def.key]: v });
        setLabel(def.fmt(v));
      });
      grid.appendChild(row);
    }
    const blend = h('select', 'select');
    for (const b of BLENDS) {
      const o = h('option', '', t2(b.label));
      o.value = b.value;
      blend.appendChild(o);
    }
    blend.value = m.blend;
    blend.addEventListener('change', () => store.updateMedia(m.id, { blend: blend.value as MediaLayer['blend'] }));
    const blendRow = h('label', 'param-row');
    blendRow.append(h('span', 'param-label', tr('重ね方', 'Blend')), blend);
    grid.appendChild(blendRow);
    if (m.kind === 'video') {
      const loop = h('input');
      loop.type = 'checkbox';
      loop.checked = m.loop;
      loop.addEventListener('change', () => store.updateMedia(m.id, { loop: loop.checked }));
      const r = h('label', 'row-gap param-label');
      r.append(loop, tr('曲より短いときはくり返す (オフなら最後の絵で止める)', 'Loop when shorter than the song (off = hold the last frame)'));
      grid.appendChild(r);
    }
    item.appendChild(grid);

    // クロマキー
    const chromaBox = h('div', 'media-chroma');
    const on = h('input');
    on.type = 'checkbox';
    on.checked = m.chroma.enabled;
    on.dataset.media = 'chroma';
    on.addEventListener('change', () => setChroma({ enabled: on.checked }));
    const onRow = h('label', 'row-gap param-label');
    onRow.append(on, tr('色を透かす (グリーンバック・ブルーバック)', 'Remove a color (green / blue screen)'));
    colorInput = h('input');
    colorInput.type = 'color';
    colorInput.value = m.chroma.color;
    colorInput.title = tr('透かす色', 'Color to remove');
    const ci = colorInput;
    ci.addEventListener('input', () => setChroma({ color: ci.value }));
    const colorRow = h('label', 'row-gap param-label');
    colorRow.append(h('span', '', tr('透かす色:', 'Color:')), ci, h('span', 'param-help', tr('サムネイルを押しても選べます', 'or click the thumbnail')));
    const cgrid = h('div', 'param-grid');
    for (const def of CHROMA) {
      const { row, input: r, setLabel } = sliderRow(def.label, def.help, 0, 1, 0.01);
      r.value = String(m.chroma[def.key]);
      setLabel(m.chroma[def.key].toFixed(2));
      r.addEventListener('input', () => {
        const v = parseFloat(r.value);
        setChroma({ [def.key]: v });
        setLabel(v.toFixed(2));
      });
      cgrid.appendChild(row);
    }
    chromaBox.append(onRow, colorRow, cgrid);
    item.appendChild(chromaBox);

    const remove = h('button', 'tab-button', tr('この素材を外す', 'Remove this media'));
    remove.type = 'button';
    remove.addEventListener('click', () => {
      const t = thumbs.get(m.id);
      if (t) URL.revokeObjectURL(t.url);
      thumbs.delete(m.id);
      store.removeMedia(m.id);
      render();
      onChange();
    });
    item.appendChild(remove);
    return item;
  };

  render();
  return root;
}
