import { createMotionApplyNotice } from './motion-apply';
import { createLivePreview } from './live-preview';
import { store } from '../../core/store';
import { type CommonParams, defaultView, VIEW_ZOOM_MAX, VIEW_ZOOM_MIN, type ViewSettings } from '../../core/types';
import { visualizerRegistry } from '../../visualizers';
import { t2, tr, type Text2 } from '../../core/i18n';
import { sliderRow } from './panel-helpers';
import { resolvePresetParams } from '../../core/visualizer/preset-params';

/** 共通の設定。名前と説明は、誰が見ても何が変わるか分かるように (日本語 / English) */
const NUMERIC_PARAMS: { key: keyof CommonParams; label: Text2; help: Text2; min: number; max: number; step: number }[] = [
  {
    key: 'intensity',
    label: { ja: '全体の派手さ', en: 'Intensity' },
    help: { ja: '映像全体の明るさや動きの大きさ。上げるほど派手になります', en: 'Overall brightness and size of the motion. Higher is flashier' },
    min: 0, max: 1, step: 0.01,
  },
  {
    key: 'sensitivity',
    label: { ja: '音への反応のしやすさ', en: 'Sensitivity' },
    help: { ja: '上げるほど、小さな音にも反応して動きます', en: 'Higher reacts to quieter sounds too' },
    min: 0, max: 1, step: 0.01,
  },
  {
    key: 'bass',
    label: { ja: '低い音への反応', en: 'Bass' },
    help: { ja: 'ドラムのキックやベースなど、低い音でどれだけ動くか', en: 'How much kicks and bass move the visuals' },
    min: 0, max: 2, step: 0.01,
  },
  {
    key: 'mid',
    label: { ja: '中くらいの音への反応', en: 'Mid' },
    help: { ja: '声やギター、ピアノなどでどれだけ動くか', en: 'How much vocals, guitars and keys move the visuals' },
    min: 0, max: 2, step: 0.01,
  },
  {
    key: 'high',
    label: { ja: '高い音への反応', en: 'High' },
    help: { ja: 'シンバルやハイハットなど、高い音でどれだけ動くか', en: 'How much cymbals and hi-hats move the visuals' },
    min: 0, max: 2, step: 0.01,
  },
  {
    key: 'glow',
    label: { ja: '光のにじみ', en: 'Bloom' },
    help: { ja: '明るい部分のまわりが、ふんわり光って見える量', en: 'How much bright areas bloom with a soft halo' },
    min: 0, max: 1, step: 0.01,
  },
  {
    key: 'motion',
    label: { ja: '動きの量', en: 'Motion' },
    help: { ja: '形や光がどれだけ大きく・速く動くか', en: 'How far and fast shapes and lights move' },
    min: 0, max: 1, step: 0.01,
  },
  {
    key: 'cameraMotion',
    label: { ja: 'カメラのゆれ', en: 'Camera Motion' },
    help: { ja: '見ている位置がゆっくり動く量。0 で止まります', en: 'How much the viewpoint drifts. 0 keeps it still' },
    min: 0, max: 1, step: 0.01,
  },
];

const COLOR_THEMES: { id: string; label: Text2 }[] = [
  { id: 'default', label: { ja: '標準', en: 'Default' } },
  { id: 'gold', label: { ja: '金色', en: 'Gold' } },
  { id: 'ice', label: { ja: '氷の青', en: 'Ice' } },
  { id: 'neon', label: { ja: 'ネオン', en: 'Neon' } },
  { id: 'mono', label: { ja: 'モノクロ', en: 'Mono' } },
];

export function renderVisualizerPanel(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel';

  const h2 = document.createElement('h2');
  h2.textContent = tr('ビジュアライザー', 'Visualizer');
  el.appendChild(h2);

  const p = document.createElement('p');
  p.textContent = tr(
    '音に合わせて動く映像の種類を選び、下の設定で光や動きを調整します。曲をまだ読み込んでいない間は、見本の動きを表示します。',
    'Choose the music-reactive visuals and adjust light and motion below. Until a song is loaded, a sample motion is shown.',
  );
  el.appendChild(p);

  const presetSelect = document.createElement('select');
  presetSelect.className = 'select';
  presetSelect.title = tr('映像の種類', 'Visual preset');
  for (const m of visualizerRegistry.list()) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    presetSelect.appendChild(opt);
  }
  el.appendChild(presetSelect);

  // 映像のプレビュー (背景と素材タブと同じ部品。ui/panels/live-preview.ts)
  // 歌詞の時刻だけを変えたあと、歌詞の動きに反映するボタン (Lyrics タブと同じもの)
  const applyNotice = createMotionApplyNotice();
  const preview = createLivePreview({ onFrame: () => applyNotice.update() });
  el.appendChild(preview.element);
  el.appendChild(applyNotice.element);

  // このビジュアライザーだけの設定 (manifest.controls)。映像の種類を変えるたびに作り直す
  const presetBox = document.createElement('div');
  presetBox.className = 'preset-controls';
  el.appendChild(presetBox);

  const paramsWrap = document.createElement('div');
  paramsWrap.className = 'param-grid';
  el.appendChild(paramsWrap);

  for (const def of NUMERIC_PARAMS) {
    const { row, input, setLabel } = sliderRow(def.label, def.help, def.min, def.max, def.step);
    const initial = store.params[def.key] as number;
    input.value = String(initial);
    setLabel(initial.toFixed(2));
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      store.setParam(def.key, v as CommonParams[typeof def.key]);
      setLabel(v.toFixed(2));
    });
    paramsWrap.appendChild(row);
  }

  const colorRow = document.createElement('label');
  colorRow.className = 'param-row';
  const colorLabel = document.createElement('span');
  colorLabel.className = 'param-label';
  colorLabel.textContent = tr('色の組み合わせ', 'Color Theme');
  const colorSelect = document.createElement('select');
  colorSelect.className = 'select';
  for (const theme of COLOR_THEMES) {
    const opt = document.createElement('option');
    opt.value = theme.id;
    opt.textContent = t2(theme.label);
    colorSelect.appendChild(opt);
  }
  colorSelect.value = store.params.colorTheme;
  colorSelect.addEventListener('change', () => store.setParam('colorTheme', colorSelect.value));
  colorRow.appendChild(colorLabel);
  colorRow.appendChild(colorSelect);
  const colorHelp = document.createElement('span');
  colorHelp.className = 'param-help';
  colorHelp.textContent = tr('映像の色のまとまり。映像の種類によって色が変わります', 'The color set. Each preset interprets it differently');
  colorRow.appendChild(colorHelp);
  paramsWrap.appendChild(colorRow);

  // 見え方 (どのプリセットにも共通): 拡大して一部だけ使う・ずらす・傾ける (core/render/view.ts)
  const viewTitle = document.createElement('h3');
  viewTitle.textContent = tr('見え方', 'View');
  el.appendChild(viewTitle);
  const viewNote = document.createElement('p');
  viewNote.className = 'param-label';
  viewNote.textContent = tr(
    '映像を拡大して一部だけ使ったり、ずらしたり、傾けたりできます。拡大しても粗くなりません。1 倍より小さくすると、見える範囲が広がります。',
    'Zoom in to use just part of the visuals, shift or tilt them. Zooming stays sharp. Below 1× you see a wider area.',
  );
  el.appendChild(viewNote);
  const viewWrap = document.createElement('div');
  viewWrap.className = 'param-grid';
  el.appendChild(viewWrap);
  const VIEW_PARAMS: { key: keyof ViewSettings; label: Text2; help: Text2; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
    {
      key: 'zoom', label: { ja: '拡大', en: 'Zoom' },
      help: { ja: '大きくして一部だけを見せます。1 倍 = そのまま', en: 'Enlarge to show only a part. 1× = unchanged' },
      min: VIEW_ZOOM_MIN, max: VIEW_ZOOM_MAX, step: 0.01, fmt: (v) => `${v.toFixed(2)}×`,
    },
    {
      key: 'x', label: { ja: '左右の位置', en: 'Pan X' },
      help: { ja: '見る場所を左右にずらします。プラス = 右側を見る', en: 'Shift the view sideways. Positive looks to the right' },
      min: -1, max: 1, step: 0.01, fmt: (v) => v.toFixed(2),
    },
    {
      key: 'y', label: { ja: '上下の位置', en: 'Pan Y' },
      help: { ja: '見る場所を上下にずらします。プラス = 上側を見る', en: 'Shift the view up or down. Positive looks up' },
      min: -1, max: 1, step: 0.01, fmt: (v) => v.toFixed(2),
    },
    {
      key: 'roll', label: { ja: '傾き', en: 'Roll' },
      help: { ja: '映像を回します。プラス = 反時計回り', en: 'Rotate the picture. Positive = counter-clockwise' },
      min: -180, max: 180, step: 1, fmt: (v) => `${Math.round(v)}°`,
    },
  ];
  const viewInputs: { def: (typeof VIEW_PARAMS)[number]; input: HTMLInputElement; setLabel: (v: string) => void }[] = [];
  for (const def of VIEW_PARAMS) {
    const { row, input, setLabel } = sliderRow(def.label, def.help, def.min, def.max, def.step);
    input.dataset.view = def.key;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      store.updateView({ [def.key]: v });
      setLabel(def.fmt(v));
    });
    viewWrap.appendChild(row);
    viewInputs.push({ def, input, setLabel });
  }
  const syncView = (): void => {
    for (const { def, input, setLabel } of viewInputs) {
      const v = store.view[def.key];
      input.value = String(v);
      setLabel(def.fmt(v));
    }
  };
  syncView();
  const viewReset = document.createElement('button');
  viewReset.type = 'button';
  viewReset.className = 'tab-button';
  viewReset.dataset.action = 'reset-view';
  viewReset.textContent = tr('見え方を元に戻す', 'Reset View');
  viewReset.addEventListener('click', () => {
    store.updateView(defaultView());
    syncView();
  });
  el.appendChild(viewReset);


  const buildPresetControls = (id: string): void => {
    presetBox.textContent = '';
    const controls = visualizerRegistry.get(id)?.manifest.controls ?? [];
    if (controls.length === 0) return;
    const title = document.createElement('h3');
    title.textContent = tr('このビジュアライザーの設定', 'Settings for this visualizer');
    const grid = document.createElement('div');
    grid.className = 'param-grid';
    const values = resolvePresetParams(controls, store.presetParams(id));
    for (const c of controls) {
      if (c.type === 'range') {
        const { row, input, setLabel } = sliderRow(c.label, c.help, c.min, c.max, c.step);
        input.dataset.presetParam = c.key;
        input.value = String(values[c.key]);
        setLabel(Number(values[c.key]).toFixed(2));
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          store.setPresetParam(id, c.key, v);
          setLabel(v.toFixed(2));
        });
        grid.appendChild(row);
      } else {
        const row = document.createElement('label');
        row.className = 'param-row';
        const label = document.createElement('span');
        label.className = 'param-label';
        label.textContent = t2(c.label);
        const select = document.createElement('select');
        select.className = 'select';
        select.dataset.presetParam = c.key;
        for (const o of c.options) {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = t2(o.label);
          select.appendChild(opt);
        }
        select.value = String(values[c.key]);
        select.addEventListener('change', () => store.setPresetParam(id, c.key, select.value));
        const help = document.createElement('span');
        help.className = 'param-help';
        help.textContent = t2(c.help);
        row.append(label, select, help);
        grid.appendChild(row);
      }
    }
    presetBox.append(title, grid);
  };

  const applyPreset = (id: string): void => {
    const mod = visualizerRegistry.get(id);
    if (!mod) return;
    store.setPresetId(id);
    buildPresetControls(id);
  };

  const firstId = visualizerRegistry.list()[0]?.id;
  presetSelect.value = store.presetId ?? firstId ?? '';
  if (presetSelect.value) applyPreset(presetSelect.value);
  presetSelect.addEventListener('change', () => applyPreset(presetSelect.value));

  return el;
}
