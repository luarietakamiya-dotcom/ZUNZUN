import { isDarkText, jizuraFonts, jizuraStyles, type JizuraApi } from '../../core/lyrics/jizura-adapter';
import type { LyricsCustomStyle } from '../../core/types';

/**
 * オリジナルのスタイル (L7) の編集欄。Lyrics タブの「歌詞モーション」欄の中に置く。
 * 名前・元にするスタイル・色 (6 色)・書体 (見出し / 明朝 / 本文)・質感 (粒 / 走査線 / 色ズレの強さ / 光のにじみ) を変えられる。
 * 変えるたびに onChange で新しい LyricsCustomStyle を渡す (保存と歌詞モーションの作り直しは呼び出し側)。
 * 演出の好み (どのレイアウトが出やすいかなど) は「元にするスタイル」のものを引き継ぐ。
 */

export interface StyleEditorCallbacks {
  onChange(custom: LyricsCustomStyle): void;
  /** 「元のスタイルの値を読み込む」: 今の元のスタイルから色・書体・質感を作り直す */
  onResetFromBase(baseKey: string): void;
  onDelete(): void;
}

export interface StyleEditor {
  element: HTMLElement;
  /** JIZURA を読み込んだら呼ぶ (スタイル・書体の一覧を埋める) */
  setJizura(J: JizuraApi): void;
  /** 保存されている値を表示に反映する */
  refresh(custom: LyricsCustomStyle | null): void;
}

const COLOR_FIELDS: { key: keyof LyricsCustomStyle['colors']; label: string }[] = [
  { key: 'fg', label: '文字' },
  { key: 'sub', label: '補助 (小さな文字・線)' },
  { key: 'accent', label: 'アクセント 1' },
  { key: 'accent2', label: 'アクセント 2' },
  { key: 'ghostA', label: '色ズレ 1' },
  { key: 'ghostB', label: '色ズレ 2' },
];

const FONT_FIELDS: { key: keyof LyricsCustomStyle['fonts']; label: string }[] = [
  { key: 'display', label: '見出し' },
  { key: 'serif', label: '明朝' },
  { key: 'body', label: '本文' },
];

const TEXTURE_FIELDS: { key: keyof LyricsCustomStyle['texture']; label: string; max: number }[] = [
  { key: 'grain', label: 'フィルムの粒', max: 1 },
  { key: 'scan', label: '走査線', max: 1 },
  { key: 'ghost', label: '色ズレの強さ', max: 1.5 },
  { key: 'glow', label: '光のにじみ', max: 1 },
];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

export function createStyleEditor(cb: StyleEditorCallbacks): StyleEditor {
  const root = h('div', 'lyrics-style-editor');
  let current: LyricsCustomStyle | null = null;
  let J: JizuraApi | null = null;

  const emit = (patch: (c: LyricsCustomStyle) => LyricsCustomStyle): void => {
    if (!current) return;
    current = patch(current);
    cb.onChange(current);
  };

  // 名前・元にするスタイル
  const nameInput = h('input', 'lyrics-text-input');
  nameInput.maxLength = 40;
  nameInput.addEventListener('change', () => emit((c) => ({ ...c, name: nameInput.value.trim().slice(0, 40) || 'マイスタイル' })));
  const baseSelect = h('select', 'select');
  baseSelect.addEventListener('change', () => emit((c) => ({ ...c, base: baseSelect.value })));
  const resetBtn = h('button', 'tab-button', '元のスタイルの色・書体・質感を読み込む');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    if (current) cb.onResetFromBase(current.base);
  });
  const deleteBtn = h('button', 'tab-button', 'マイスタイルを削除');
  deleteBtn.type = 'button';
  deleteBtn.addEventListener('click', () => {
    if (window.confirm('マイスタイルを削除して、元のスタイルに戻します。')) cb.onDelete();
  });

  // 色
  const colorInputs = new Map<string, HTMLInputElement>();
  const colorRows = COLOR_FIELDS.map((f) => {
    const input = h('input', 'lyrics-color-input');
    input.type = 'color';
    input.addEventListener('input', () => emit((c) => ({ ...c, colors: { ...c.colors, [f.key]: input.value.toLowerCase() } })));
    colorInputs.set(f.key, input);
    const row = h('label', 'lyrics-color-row');
    row.append(input, h('span', 'param-label', f.label));
    return row;
  });
  const darkWarning = h('div', 'lyrics-warning', '文字の色が暗いため、映像に重ねると読みにくくなります。明るい色をおすすめします。');

  // 書体
  const fontSelects = new Map<string, HTMLSelectElement>();
  const fontRows = FONT_FIELDS.map((f) => {
    const select = h('select', 'select');
    select.addEventListener('change', () => emit((c) => ({ ...c, fonts: { ...c.fonts, [f.key]: select.value } })));
    fontSelects.set(f.key, select);
    const row = h('label', 'param-row');
    row.append(h('span', 'param-label', f.label), select);
    return row;
  });

  // 質感
  const textureInputs = new Map<string, { input: HTMLInputElement; label: HTMLSpanElement; def: (typeof TEXTURE_FIELDS)[number] }>();
  const textureRows = TEXTURE_FIELDS.map((f) => {
    const input = h('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(f.max);
    input.step = '0.01';
    const label = h('span', 'param-label');
    input.addEventListener('input', () => {
      label.textContent = `${f.label}: ${parseFloat(input.value).toFixed(2)}`;
      emit((c) => ({ ...c, texture: { ...c.texture, [f.key]: parseFloat(input.value) } }));
    });
    textureInputs.set(f.key, { input, label, def: f });
    const row = h('label', 'param-row');
    row.append(label, input);
    return row;
  });

  const section = (title: string, ...children: HTMLElement[]): HTMLElement => {
    const s = h('div', 'lyrics-style-section');
    s.append(h('div', 'lyrics-style-title', title), ...children);
    return s;
  };
  const nameRow = h('div', 'row-gap lyrics-row-wrap');
  nameRow.append(h('span', 'param-label', '名前:'), nameInput, h('span', 'param-label', '元にするスタイル (演出の好みを引き継ぐ):'), baseSelect);
  const colorGrid = h('div', 'lyrics-color-grid');
  colorGrid.append(...colorRows);
  const fontGrid = h('div', 'param-grid lyrics-motion-grid');
  fontGrid.append(...fontRows);
  const textureGrid = h('div', 'param-grid lyrics-motion-grid');
  textureGrid.append(...textureRows);
  const buttons = h('div', 'row-gap lyrics-row-wrap');
  buttons.append(resetBtn, deleteBtn);
  root.append(nameRow, section('色', colorGrid, darkWarning), section('書体', fontGrid), section('質感', textureGrid), buttons);

  const fillSelect = (select: HTMLSelectElement, options: [string, string][]): void => {
    select.textContent = '';
    for (const [value, label] of options) {
      const opt = h('option', '', label);
      opt.value = value;
      select.appendChild(opt);
    }
  };

  const refresh = (custom: LyricsCustomStyle | null): void => {
    current = custom;
    root.hidden = !custom;
    if (!custom) return;
    if (document.activeElement !== nameInput) nameInput.value = custom.name;
    if (J) baseSelect.value = custom.base;
    for (const f of COLOR_FIELDS) colorInputs.get(f.key)!.value = custom.colors[f.key];
    darkWarning.hidden = !J || !isDarkText(custom.colors.fg, (c) => J!.lum(c));
    for (const f of FONT_FIELDS) {
      const select = fontSelects.get(f.key)!;
      select.value = custom.fonts[f.key];
      // 一覧に無いキー (JIZURA の更新で消えたなど) は「元のスタイルのまま」を表示する
      if (select.value !== custom.fonts[f.key]) select.value = '';
    }
    for (const [key, r] of textureInputs) {
      const v = custom.texture[key as keyof LyricsCustomStyle['texture']];
      r.input.value = String(v);
      r.label.textContent = `${r.def.label}: ${v.toFixed(2)}`;
    }
  };

  return {
    element: root,
    setJizura(api: JizuraApi): void {
      J = api;
      fillSelect(baseSelect, jizuraStyles(api));
      const fonts: [string, string][] = [['', '元のスタイルのまま'], ...jizuraFonts(api)];
      for (const select of fontSelects.values()) fillSelect(select, fonts);
      refresh(current);
    },
    refresh,
  };
}
