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
