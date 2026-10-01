import type { PanelId } from './panels';
import { PANELS } from './panels';
import { createTransport } from './transport';
import { lang, onLangChange, setLang, t2, tr, type Lang } from '../core/i18n';

const TAB_ORDER: PanelId[] = ['music', 'visualizer', 'lyrics', 'overlay', 'settings', 'export', 'help'];

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

  // 共通の再生欄 (どのタブでも使える)。Lyrics タブでは Space をタップに使うので、そのタブの処理に任せる
  header.appendChild(createTransport({ spaceHandledByPanel: () => active === 'lyrics' }));

  // 表記の言語 (日本語 / English)。切り替えるとタブ名と今のタブを作り直す
  const langBox = document.createElement('div');
  langBox.className = 'lang-switch';
  langBox.setAttribute('role', 'group');
  const langButtons: [Lang, HTMLButtonElement][] = (['ja', 'en'] as Lang[]).map((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab-button lang-button';
    b.textContent = l === 'ja' ? '日本語' : 'EN';
    b.dataset.lang = l;
    b.addEventListener('click', () => setLang(l));
    langBox.appendChild(b);
    return [l, b];
  });
  header.appendChild(langBox);
  const syncLang = (): void => {
    langBox.setAttribute('aria-label', tr('表示の言語', 'Language'));
    for (const [l, b] of langButtons) b.setAttribute('aria-pressed', String(l === lang()));
    document.documentElement.lang = lang();
  };
  syncLang();

  const render = () => {
    tabs.innerHTML = '';
    for (const id of TAB_ORDER) {
      const def = PANELS[id];
      const btn = document.createElement('button');
      btn.className = 'tab-button';
      btn.type = 'button';
      btn.textContent = t2(def.label);
      btn.title = t2(def.hint);
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
  onLangChange(() => {
    syncLang();
    render();
  });
}
