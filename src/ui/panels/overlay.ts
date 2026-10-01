import { store } from '../../core/store';
import { createBackgroundCard } from './background-card';
import { createLayersCard } from './layers-card';
import { createMediaCard } from './media-card';
import type { OverlayLayer } from '../../core/types';
import { tr, type Text2 } from '../../core/i18n';
import { sliderRow } from './panel-helpers';
import { createLivePreview } from './live-preview';

const IMAGE_ACCEPT = 'image/png,image/webp,image/jpeg';

type NumericKey = 'x' | 'y' | 'scale' | 'opacity' | 'glow' | 'float' | 'beat';

const SLIDERS: { key: NumericKey; label: Text2; help: Text2; min: number; max: number; step: number }[] = [
  { key: 'x', label: { ja: '横の位置', en: 'X' }, help: { ja: '0 = 左の端、1 = 右の端', en: '0 = left edge, 1 = right edge' }, min: -0.5, max: 1.5, step: 0.01 },
  { key: 'y', label: { ja: '縦の位置', en: 'Y' }, help: { ja: '0 = 下の端、1 = 上の端', en: '0 = bottom edge, 1 = top edge' }, min: -0.5, max: 1.5, step: 0.01 },
  { key: 'scale', label: { ja: '大きさ', en: 'Scale' }, help: { ja: '画面の高さに対する大きさ。1 = 画面の高さと同じ', en: 'Size relative to the screen height. 1 = full height' }, min: 0.02, max: 1.5, step: 0.01 },
  { key: 'opacity', label: { ja: '濃さ', en: 'Opacity' }, help: { ja: '0 = 見えない、1 = くっきり', en: '0 = invisible, 1 = fully visible' }, min: 0, max: 1, step: 0.01 },
  { key: 'glow', label: { ja: '光の強さ', en: 'Glow' }, help: { ja: '画像のまわりがふんわり光る量', en: 'Soft halo around the image' }, min: 0, max: 1, step: 0.01 },
  { key: 'float', label: { ja: 'ふわふわ', en: 'Float' }, help: { ja: 'ゆっくり上下に浮かぶ量', en: 'How much it gently bobs up and down' }, min: 0, max: 1, step: 0.01 },
  { key: 'beat', label: { ja: '拍で弾む', en: 'Beat' }, help: { ja: '曲の拍に合わせて一瞬大きくなる量', en: 'How much it pulses bigger on each beat' }, min: 0, max: 1, step: 0.01 },
];

/**
 * 「背景と素材」タブ: レイヤーの順番・背景・素材 (グリーンバックも)・手前に重ねる画像。
 * 右 (狭い画面では上) に映像のプレビューを固定で置き、つまみを動かしながら見た目を確かめられる
 * (2026-10-01 「グリーンバックの素材をプレビューを見ながら調整したい」。ui/panels/live-preview.ts)。
 */
export function renderOverlayPanel(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel';

  const h2 = document.createElement('h2');
  h2.textContent = tr('背景と素材', 'Overlay');
  el.appendChild(h2);

  const p = document.createElement('p');
  p.textContent = tr(
    '画面に重なるもの (レイヤー) の順番、背景の写真・動画、好きな位置に置く素材 (画像・動画、グリーンバックも)、手前に重ねる画像 (ロゴなど) を設定します。重ねたものには、ビジュアライザーの光のにじみはかかりません。プレビューは、下へ動かしても見えたままです (再生すると動きます)。',
    'Set the stacking order of layers, the background photo/video, freely placed media (images/videos, green screen too) and overlay images (logos etc.). These are not affected by the visualizer glow. The preview stays in view while you scroll (press play to see it move).',
  );
  el.appendChild(p);

  // 左 (狭い画面では下) が設定、右 (上) が固定のプレビュー
  const split = document.createElement('div');
  split.className = 'overlay-split';
  const controlsCol = document.createElement('div');
  controlsCol.className = 'overlay-controls';
  const previewCol = document.createElement('div');
  previewCol.className = 'overlay-preview';
  previewCol.dataset.overlay = 'preview';
  previewCol.appendChild(createLivePreview().element);
  split.append(controlsCol, previewCol);
  el.appendChild(split);
  // ここから下の欄は設定の列に入れる
  const body = controlsCol;

  // 背景の一枚絵 (ビジュアライザーの奥)。オーバーレイ (前面) とは別の欄
  // レイヤーの順番 (手前が上)、背景の一枚絵・動画、素材 (素材を足したり外したりしたらレイヤーの一覧も作り直す)
  const layersHost = document.createElement('div');
  const renderLayers = (): void => layersHost.replaceChildren(createLayersCard());
  renderLayers();
  body.appendChild(layersHost);
  body.appendChild(createBackgroundCard());
  body.appendChild(createMediaCard(renderLayers));

  const addRow = document.createElement('div');
  addRow.className = 'row-gap';
  const addLabel = document.createElement('span');
  addLabel.className = 'param-label';
  addLabel.textContent = tr('手前に重ねる画像を追加:', 'Add an overlay image:');
  const addInput = document.createElement('input');
  addInput.type = 'file';
  addInput.accept = IMAGE_ACCEPT;
  addRow.appendChild(addLabel);
  addRow.appendChild(addInput);
  body.appendChild(addRow);

  const errorBox = document.createElement('div');
  errorBox.className = 'placeholder-card';
  errorBox.style.display = 'none';
  body.appendChild(errorBox);

  const list = document.createElement('div');
  list.className = 'overlay-list';
  body.appendChild(list);

  // id -> objectURL。サムネイル表示用。個別削除時は revoke するが、タブ切り替えでパネルごと
  // 破棄されるときは他パネル同様に明示的な unmount フックが無いため revoke しない
  // (ブロブ URL はページを離れれば解放されるので、実害の小さいトレードオフとして許容する)。
  const thumbUrls = new Map<string, string>();

  function makeSliderRow(layer: OverlayLayer, def: (typeof SLIDERS)[number]): HTMLElement {
    const { row, input, setLabel } = sliderRow(def.label, def.help, def.min, def.max, def.step);
    input.value = String(layer[def.key]);
    setLabel(layer[def.key].toFixed(2));
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      store.setOverlayField(layer.id, def.key, v);
      setLabel(v.toFixed(2));
    });
    return row;
  }

  function makeRotationRow(layer: OverlayLayer): HTMLElement {
    const { row, input, setLabel } = sliderRow({ ja: '回転', en: 'Rotation' }, { ja: 'プラス = 反時計回り', en: 'Positive = counter-clockwise' }, -180, 180, 1);
    const initialDeg = (layer.rotation * 180) / Math.PI;
    input.value = String(initialDeg);
    setLabel(`${initialDeg.toFixed(0)}°`);
    input.addEventListener('input', () => {
      const deg = parseFloat(input.value);
      store.setOverlayField(layer.id, 'rotation', (deg * Math.PI) / 180);
      setLabel(`${deg.toFixed(0)}°`);
    });
    return row;
  }

  function renderLayerRow(layer: OverlayLayer): HTMLElement {
    const row = document.createElement('div');
    row.className = 'overlay-item';

    const header = document.createElement('div');
    header.className = 'overlay-item-header';

    const file = store.getOverlayFile(layer.id);
    if (file) {
      let url = thumbUrls.get(layer.id);
      if (!url) {
        url = URL.createObjectURL(file);
        thumbUrls.set(layer.id, url);
      }
      const img = document.createElement('img');
      img.className = 'overlay-thumb';
      img.src = url;
      img.alt = layer.ref;
      header.appendChild(img);
    } else {
      const missing = document.createElement('div');
      missing.className = 'overlay-thumb overlay-thumb-missing';
      missing.textContent = '?';
      header.appendChild(missing);
    }

    const nameLabel = document.createElement('span');
    nameLabel.className = 'overlay-name';
    nameLabel.textContent = layer.ref;
    header.appendChild(nameLabel);
    row.appendChild(header);

    if (!file) {
      const relinkWrap = document.createElement('div');
      relinkWrap.className = 'placeholder-card';
      relinkWrap.textContent = tr(`プロジェクトで使っている「${layer.ref}」がまだ読み込まれていません。同じファイルを選び直してください。`, `"${layer.ref}" used by the project is not loaded yet. Please pick the same file again.`);
      const relinkInput = document.createElement('input');
      relinkInput.type = 'file';
      relinkInput.accept = IMAGE_ACCEPT;
      relinkInput.addEventListener('change', () => {
        const picked = relinkInput.files?.[0];
        if (!picked) return;
        store.relinkOverlayImage(layer.id, picked);
        refresh();
      });
      relinkWrap.appendChild(relinkInput);
      row.appendChild(relinkWrap);
    }

    const grid = document.createElement('div');
    grid.className = 'param-grid';
    for (const def of SLIDERS) grid.appendChild(makeSliderRow(layer, def));
    grid.appendChild(makeRotationRow(layer));
    row.appendChild(grid);

    const controls = document.createElement('div');
    controls.className = 'row-gap';

    const frontBtn = document.createElement('button');
    frontBtn.type = 'button';
    frontBtn.className = 'tab-button';
    frontBtn.textContent = tr('手前へ', 'Bring forward');
    frontBtn.addEventListener('click', () => {
      store.reorderOverlay(layer.id, 'up');
      refresh();
    });

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'tab-button';
    backBtn.textContent = tr('奥へ', 'Send backward');
    backBtn.addEventListener('click', () => {
      store.reorderOverlay(layer.id, 'down');
      refresh();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'tab-button';
    removeBtn.textContent = tr('削除', 'Remove');
    removeBtn.addEventListener('click', () => {
      const url = thumbUrls.get(layer.id);
      if (url) {
        URL.revokeObjectURL(url);
        thumbUrls.delete(layer.id);
      }
      store.removeOverlay(layer.id);
      refresh();
    });

    controls.appendChild(frontBtn);
    controls.appendChild(backBtn);
    controls.appendChild(removeBtn);
    row.appendChild(controls);

    return row;
  }

  const refresh = (): void => {
    list.innerHTML = '';
    const layers = [...store.overlays].sort((a, b) => b.z - a.z); // 前面から順に並べる
    if (layers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'placeholder-card';
      empty.textContent = tr('重ねる画像はまだありません。上の「手前に重ねる画像を追加」から選んでください。', 'No overlay images yet. Add one with "Add an overlay image" above.');
      list.appendChild(empty);
      return;
    }
    for (const layer of layers) list.appendChild(renderLayerRow(layer));
  };

  addInput.addEventListener('change', () => {
    const file = addInput.files?.[0];
    addInput.value = '';
    if (!file) return;
    errorBox.style.display = 'none';
    store
      .addOverlayImage(file)
      .then(refresh)
      .catch((err: unknown) => {
        errorBox.style.display = '';
        errorBox.textContent = `${tr('追加できませんでした', 'Could not add')}: ${err instanceof Error ? err.message : String(err)}`;
      });
  });

  refresh();

  return el;
}
