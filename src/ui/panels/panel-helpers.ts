import { t2, tr, type Text2 } from '../../core/i18n';

/**
 * 曲を選ぶ欄の accept。`audio/*` だけだと、iPhone の Safari では mp3 でもファイルアプリで灰色になって選べないことがあった
 * (2026-10-02 ユーザーの実機。種類は「MP3 オーディオ」で拡張子も .mp3 だった)。拡張子も並べると、iOS はその拡張子の種類を
 * はっきり許すので選べる (歌詞タブの「ボーカルだけの音」の欄は前からこの形)。
 */
export const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.weba,.mp4,.caf,.aif,.aiff';

/**
 * 「すべてのファイルから選ぶ」ボタン: 曲を選ぶ欄で絞り込みが効きすぎて選べないときの逃げ道。
 * 絞り込みの無い別の欄で選んだファイルを、本来の欄 (target) に渡して、その欄の処理 (change) をそのまま動かす。
 */
export function anyFileButton(target: HTMLInputElement): HTMLButtonElement {
  const any = document.createElement('input');
  any.type = 'file';
  any.hidden = true;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tab-button';
  btn.dataset.anyFile = 'true';
  btn.textContent = tr('ファイルが選べないときは: すべてのファイルから選ぶ', 'Cannot pick your file? Choose from all files');
  btn.addEventListener('click', () => any.click());
  any.addEventListener('change', () => {
    const file = any.files?.[0];
    any.value = '';
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    target.files = dt.files;
    target.dispatchEvent(new Event('change', { bubbles: true }));
  });
  btn.append(any);
  return btn;
}

/** 各パネルの共通の骨組み (タイトル・説明・プレースホルダーカード) を作る小さなヘルパー。 */
export function panelSkeleton(title: string, description: string, placeholder: string): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel';

  const h2 = document.createElement('h2');
  h2.textContent = title;
  el.appendChild(h2);

  const p = document.createElement('p');
  p.textContent = description;
  el.appendChild(p);

  const card = document.createElement('div');
  card.className = 'placeholder-card';
  card.textContent = placeholder;
  el.appendChild(card);

  return el;
}

/**
 * つまみ (スライダー) の 1 行: 「名前: 値」と、その下に何が変わるかの短い説明。
 * setLabel(値の文字) で表示を更新する。言語は作るときの言語 (切り替えるとパネルごと作り直される)
 */
export function sliderRow(label: Text2, help: Text2, min: number, max: number, step: number): { row: HTMLLabelElement; input: HTMLInputElement; setLabel(value: string): void } {
  const row = document.createElement('label');
  row.className = 'param-row';
  const labelSpan = document.createElement('span');
  labelSpan.className = 'param-label';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  const helpSpan = document.createElement('span');
  helpSpan.className = 'param-help';
  helpSpan.textContent = t2(help);
  row.append(labelSpan, input, helpSpan);
  const name = t2(label);
  return { row, input, setLabel: (value) => (labelSpan.textContent = `${name}: ${value}`) };
}
