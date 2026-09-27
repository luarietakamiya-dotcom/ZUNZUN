import type { PanelId } from './panels';
import { PANELS } from './panels';

const TAB_ORDER: PanelId[] = ['music', 'visualizer', 'lyrics', 'overlay', 'settings', 'export'];

/**
 * アプリのシェル (ヘッダーのタブ + 現在のパネル本体) を root にマウントする。
 * Step 1 時点ではパネルはすべてプレースホルダー。Step 2 以降で各パネルに機能を足していく。
 */
export function mountShell(root: HTMLElement): void {
  root.innerHTML = '';

  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const header = document.createElement('header');
  header.className = 'app-header';

  const title = document.createElement('h1');
  title.textContent = 'ZUNZUN';
  header.appendChild(title);

  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  tabs.setAttribute('role', 'tablist');
  header.appendChild(tabs);

  const body = document.createElement('main');
  body.className = 'app-body';

  shell.appendChild(header);
  shell.appendChild(body);
  root.appendChild(shell);

  let active: PanelId = 'music';

  const render = () => {
    tabs.innerHTML = '';
    for (const id of TAB_ORDER) {
      const def = PANELS[id];
      const btn = document.createElement('button');
      btn.className = 'tab-button';
      btn.type = 'button';
      btn.textContent = def.label;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(id === active));
      btn.dataset.panel = id;
      btn.addEventListener('click', () => {
        active = id;
        render();
      });
      tabs.appendChild(btn);
    }
    body.innerHTML = '';
    body.appendChild(PANELS[active].render());
  };

  render();
}
