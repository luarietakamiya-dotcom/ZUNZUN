import { store } from '../../core/store';
import { createBackgroundCard } from './background-card';
import type { OverlayLayer } from '../../core/types';

const IMAGE_ACCEPT = 'image/png,image/webp,image/jpeg';

type NumericKey = 'x' | 'y' | 'scale' | 'opacity' | 'glow' | 'float' | 'beat';

const SLIDERS: { key: NumericKey; label: string; min: number; max: number; step: number }[] = [
  { key: 'x', label: 'X (0=左端, 1=右端)', min: -0.5, max: 1.5, step: 0.01 },
  { key: 'y', label: 'Y (0=下端, 1=上端)', min: -0.5, max: 1.5, step: 0.01 },
  { key: 'scale', label: 'Scale (画面の高さに対する比率)', min: 0.02, max: 1.5, step: 0.01 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01 },
  { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.01 },
  { key: 'float', label: 'Float (上下浮遊)', min: 0, max: 1, step: 0.01 },
  { key: 'beat', label: 'Beat反応 (拍で拡大)', min: 0, max: 1, step: 0.01 },
];

/**
 * オーバーレイの設定パネル。ここでは画像の追加/削除/並び替え/変形のみを扱い、
 * 実際の合成結果 (Bloom を通さず前面に重なる) は Visualizer タブのキャンバスで確認する。
 * 別タブなのでライブプレビューは無い (shell.ts はタブ切り替えごとにパネルを丸ごと作り直すため、
 * 1 つの WebGL キャンバスを 2 タブで同時に出すには Step 6 の範囲を超える設計変更が要る)。
 */
export function renderOverlayPanel(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel';

  const h2 = document.createElement('h2');
  h2.textContent = 'Overlay';
  el.appendChild(h2);

  const p = document.createElement('p');
  p.textContent =
    'ビジュアライザーの上にPNG/WebP/JPGを重ねます (Bloomの影響を受けない前面レイヤーです)。' +
    '実際の見た目はVisualizerタブのプレビューで確認してください。';
  el.appendChild(p);

  // 背景の一枚絵 (ビジュアライザーの奥)。オーバーレイ (前面) とは別の欄
  el.appendChild(createBackgroundCard());

  const addRow = document.createElement('div');
  addRow.className = 'row-gap';
  const addLabel = document.createElement('span');
  addLabel.className = 'param-label';
  addLabel.textContent = '画像を追加:';
  const addInput = document.createElement('input');
  addInput.type = 'file';
  addInput.accept = IMAGE_ACCEPT;
  addRow.appendChild(addLabel);
  addRow.appendChild(addInput);
  el.appendChild(addRow);

  const errorBox = document.createElement('div');
  errorBox.className = 'placeholder-card';
  errorBox.style.display = 'none';
  el.appendChild(errorBox);

  const list = document.createElement('div');
  list.className = 'overlay-list';
  el.appendChild(list);

  // id -> objectURL。サムネイル表示用。個別削除時は revoke するが、タブ切り替えでパネルごと
  // 破棄されるときは他パネル同様に明示的な unmount フックが無いため revoke しない
  // (ブロブ URL はページを離れれば解放されるので、実害の小さいトレードオフとして許容する)。
  const thumbUrls = new Map<string, string>();

  function makeSliderRow(layer: OverlayLayer, def: (typeof SLIDERS)[number]): HTMLElement {
    const row = document.createElement('label');
    row.className = 'param-row';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'param-label';
    const updateLabel = (v: number): void => {
      labelSpan.textContent = `${def.label}: ${v.toFixed(2)}`;
    };
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.value = String(layer[def.key]);
    updateLabel(layer[def.key]);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      store.setOverlayField(layer.id, def.key, v);
      updateLabel(v);
    });
    row.appendChild(labelSpan);
    row.appendChild(input);
    return row;
  }

  function makeRotationRow(layer: OverlayLayer): HTMLElement {
    const row = document.createElement('label');
    row.className = 'param-row';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'param-label';
    const updateLabel = (deg: number): void => {
      labelSpan.textContent = `Rotation: ${deg.toFixed(0)}°`;
    };
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '-180';
    input.max = '180';
    input.step = '1';
    const initialDeg = (layer.rotation * 180) / Math.PI;
    input.value = String(initialDeg);
    updateLabel(initialDeg);
    input.addEventListener('input', () => {
      const deg = parseFloat(input.value);
      store.setOverlayField(layer.id, 'rotation', (deg * Math.PI) / 180);
      updateLabel(deg);
    });
    row.appendChild(labelSpan);
    row.appendChild(input);
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
      relinkWrap.textContent = `プロジェクトが参照する「${layer.ref}」がまだ読み込まれていません。選び直してください。`;
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
    frontBtn.textContent = '前面へ';
    frontBtn.addEventListener('click', () => {
      store.reorderOverlay(layer.id, 'up');
      refresh();
    });

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'tab-button';
    backBtn.textContent = '背面へ';
    backBtn.addEventListener('click', () => {
      store.reorderOverlay(layer.id, 'down');
      refresh();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'tab-button';
    removeBtn.textContent = '削除';
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
      empty.textContent = 'オーバーレイはまだありません。上のボタンから画像を追加してください。';
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
        errorBox.textContent = `追加に失敗しました: ${err instanceof Error ? err.message : String(err)}`;
      });
  });

  refresh();

  return el;
}
