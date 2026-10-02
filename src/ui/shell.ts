import type { PanelId } from './panels';
import { PANELS } from './panels';
import { createTransport } from './transport';
import { lang, onLangChange, setLang, t2, tr, type Lang } from '../core/i18n';
import { isNarrowScreen, setLayout } from './layout';

// 並び: 作る順 (曲 → 歌詞 → 歌詞の動き → 映像 → 背景 → 保存 → 書き出し) と使い方 (2026-10-01 レビュー・ユーザーの声)
const TAB_ORDER: PanelId[] = ['music', 'lyrics', 'motion', 'visualizer', 'overlay', 'settings', 'export', 'help'];

/** 今のタブ (スマホ表示と切り替えても同じ画面を開けるように、モジュールに置く) */
let active: PanelId = 'music';
export const pcActive = (): PanelId => active;
export function selectPcPanel(id: PanelId): void {
  active = id;
}

/**
 * アプリのシェル (PC 表示。ヘッダーのタブ + 現在のパネル本体) を root にマウントする。
 * 返す関数で片づける (スマホ表示へ切り替えるとき。layout.ts / main.ts)。
 */
export function mountShell(root: HTMLElement): () => void {
  root.innerHTML = '';

  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const header = document.createElement('header');
  header.className = 'app-header';

  const title = document.createElement('h1');
  // ロゴ: ZUNZUN3 (3 だけ黄色)
  const three = document.createElement('span');
  three.className = 'logo-3';
  three.textContent = '3';
  title.append('ZUNZUN', three);
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

  // 共通の再生欄 (どのタブでも使える)。Lyrics タブでは Space をタップに使うので、そのタブの処理に任せる
  header.appendChild(createTransport({ spaceHandledByPanel: () => active === 'lyrics' }));

  // ライセンス: どの画面からでも 1 回で見られるように、右上に置く (押すと「使い方」タブのライセンス欄へ)
  const licenseLink = document.createElement('button');
  licenseLink.type = 'button';
  licenseLink.className = 'tab-button license-link';
  licenseLink.dataset.shell = 'license';
  licenseLink.addEventListener('click', () => {
    active = 'help';
    render();
    body.querySelector('[data-help="license"]')?.scrollIntoView({ block: 'start' });
  });
  header.appendChild(licenseLink);

  // 狭い画面で PC 表示を選んでいるときだけ、スマホ表示へ戻るボタンを出す (ふつうのパソコンの画面には出ない)
  const mobileLink = document.createElement('button');
  mobileLink.type = 'button';
  mobileLink.className = 'tab-button license-link';
  mobileLink.dataset.shell = 'to-mobile';
  mobileLink.addEventListener('click', () => setLayout('mobile'));
  if (isNarrowScreen()) header.appendChild(mobileLink);

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
    licenseLink.textContent = tr('ライセンス', 'License');
    mobileLink.textContent = tr('スマホ表示', 'Mobile view');
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
  const offLang = onLangChange(() => {
    syncLang();
    render();
  });
  return () => {
    offLang();
    root.innerHTML = '';
  };
}
