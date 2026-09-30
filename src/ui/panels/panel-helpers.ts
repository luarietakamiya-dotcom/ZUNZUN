import { t2, type Text2 } from '../../core/i18n';

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
