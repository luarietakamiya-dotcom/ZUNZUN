import { t2, tr, type Text2 } from '../../core/i18n';
import { store } from '../../core/store';
import type { VisualizerBlend } from '../../core/types';
import { sliderRow } from './panel-helpers';

/**
 * 「背景と素材」タブの「レイヤー」欄: 画面に重なる順番 (手前が上) を入れ替え、表示・非表示と、ビジュアライザーの重ね方・濃さ、
 * 歌詞の濃さを決める。設定は store.composition (Project JSON の composition)。見た目は「ビジュアライザー」タブで確かめる。
 */

const NAMES: Record<string, Text2> = {
  background: { ja: '背景 (写真・動画)', en: 'Background (photo / video)' },
  visualizer: { ja: 'ビジュアライザー', en: 'Visualizer' },
  lyrics: { ja: '歌詞', en: 'Lyrics' },
  overlays: { ja: '重ねる画像 (ロゴなど)', en: 'Overlay images (logos etc.)' },
};

const BLENDS: { value: VisualizerBlend; label: Text2 }[] = [
  { value: 'screen', label: { ja: 'スクリーン (黒い部分は透けて、光だけが下に乗る。おすすめ)', en: 'Screen (black becomes see-through, only light is added. Recommended)' } },
  { value: 'add', label: { ja: '加算 (スクリーンより明るい。真っ白になりやすい)', en: 'Add (brighter than Screen, blows out to white easily)' } },
  { value: 'over', label: { ja: 'そのまま上に (濃さで透かす。1 なら下は見えない)', en: 'Normal (see through by opacity. At 1 nothing below shows)' } },
];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

export function layerName(id: string): string {
  const n = NAMES[id];
  if (n) return t2(n);
  const m = id.startsWith('media:') ? store.media.find((x) => `media:${x.id}` === id) : undefined;
  return m ? `${tr('素材', 'Media')}: ${m.ref}` : id;
}

export function createLayersCard(): HTMLElement {
  const root = h('div', 'background-card layers-card');
  root.append(
    h('h3', 'lyrics-h3', tr('レイヤー (重なる順番)', 'Layers (stacking order)')),
    h(
      'p',
      'lyrics-help',
      tr(
        '上にあるものほど手前に見えます。▲ ▼ で入れ替え、チェックを外すと隠せます。たとえば歌詞をビジュアライザーの下にすると、光が歌詞の上に重なります。見た目は「ビジュアライザー」タブで確かめてください。',
        'Items higher in the list appear in front. Use ▲ ▼ to reorder and uncheck to hide. For example, putting the lyrics under the visualizer lets its light shine over the text. Check the result in the Visualizer tab.',
      ),
    ),
  );
  const list = h('div', 'layers-list');
  root.appendChild(list);

  const render = (): void => {
    list.textContent = '';
    const c = store.composition;
    // 手前 (order の最後) から順に並べる
    const front = [...c.order].reverse();
    front.forEach((id, k) => {
      const row = h('div', 'layer-row');
      row.dataset.layer = id;
      const head = h('div', 'row-gap layer-head');
      const visible = h('input');
      visible.type = 'checkbox';
      visible.checked = !c.hidden.includes(id);
      visible.title = tr('表示する', 'Show');
      visible.addEventListener('change', () => {
        store.setLayerVisible(id, visible.checked);
        render();
      });
      const up = h('button', 'tab-button layer-move', '▲');
      up.type = 'button';
      up.title = tr('ひとつ手前へ', 'Bring forward');
      up.disabled = k === 0;
      up.addEventListener('click', () => {
        store.moveLayer(id, 1);
        render();
      });
      const down = h('button', 'tab-button layer-move', '▼');
      down.type = 'button';
      down.title = tr('ひとつ奥へ', 'Send backward');
      down.disabled = k === front.length - 1;
      down.addEventListener('click', () => {
        store.moveLayer(id, -1);
        render();
      });
      head.append(visible, h('span', 'layer-name', layerName(id)), up, down);
      row.appendChild(head);
      if (id === 'visualizer') {
        const sel = h('select', 'select');
        for (const b of BLENDS) {
          const o = h('option', '', t2(b.label));
          o.value = b.value;
          sel.appendChild(o);
        }
        sel.value = c.visualizerBlend;
        sel.dataset.control = 'visualizer-blend';
        sel.addEventListener('change', () => store.updateComposition({ visualizerBlend: sel.value as VisualizerBlend }));
        const blendRow = h('label', 'param-row');
        blendRow.append(h('span', 'param-label', tr('下のレイヤーへの重ね方', 'How it is layered over what is below')), sel);
        const { row: op, input, setLabel } = sliderRow(
          { ja: 'ビジュアライザーの濃さ', en: 'Visualizer opacity' },
          { ja: '0 = 見えない、1 = そのまま', en: '0 = invisible, 1 = full strength' },
          0, 1, 0.01,
        );
        input.value = String(c.visualizerOpacity);
        setLabel(c.visualizerOpacity.toFixed(2));
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          store.updateComposition({ visualizerOpacity: v });
          setLabel(v.toFixed(2));
        });
        const grid = h('div', 'param-grid');
        grid.append(blendRow, op);
        row.appendChild(grid);
      } else if (id === 'lyrics') {
        const { row: op, input, setLabel } = sliderRow({ ja: '歌詞の濃さ', en: 'Lyrics opacity' }, { ja: '0 = 見えない、1 = くっきり', en: '0 = invisible, 1 = fully visible' }, 0, 1, 0.01);
        input.value = String(c.lyricsOpacity);
        setLabel(c.lyricsOpacity.toFixed(2));
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          store.updateComposition({ lyricsOpacity: v });
          setLabel(v.toFixed(2));
        });
        const grid = h('div', 'param-grid');
        grid.append(op);
        row.appendChild(grid);
      }
      list.appendChild(row);
    });
  };
  render();
  return root;
}
