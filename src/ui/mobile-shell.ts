import type { PanelId } from './panels';
import { PANELS } from './panels';
import { createLivePreview } from './panels/live-preview';
import { createSizeSelect } from './size-select';
import { createTransport } from './transport';
import { lang, onLangChange, setLang, t2, tr, type Lang, type Text2 } from '../core/i18n';
import { setLayout } from './layout';

/**
 * スマホ表示 (2026-10-02 ユーザー「今のはそのままに、機能をそのまま使えるスマホ用メニューつくれば？」)。
 * PC 表示 (shell.ts) と同じパネルを、画面の下のメニュー 5 つから呼び出す。パネルの中身は作り直さない
 * (並べ方は style.css の .mobile-shell の中だけで変える。PC 表示には効かない)。
 * - 下のメニュー: 音楽 / 歌詞 / 映像 (ビジュアライザー・リリックモーション・背景と素材) / 書き出し / その他 (保存・使い方)
 * - 上: ロゴ・再生欄。自分でプレビューを持たないパネル (音楽・書き出し) では、小さなプレビューを上に固定する
 * - その他: 言語・ライセンス・PC 表示への切り替え
 * 今どのメニューか・どのパネルかは、表示を切り替えても残るように、このモジュールに置く (UI は作り直されるため)。
 */

interface MenuDef {
  id: string;
  icon: string;
  label: Text2;
  panels: PanelId[];
}

const MENUS: MenuDef[] = [
  { id: 'music', icon: '♪', label: { ja: '音楽', en: 'Music' }, panels: ['music'] },
  { id: 'lyrics', icon: '詞', label: { ja: '歌詞', en: 'Lyrics' }, panels: ['lyrics'] },
  { id: 'visual', icon: '✦', label: { ja: '映像', en: 'Visuals' }, panels: ['visualizer', 'motion', 'overlay'] },
  { id: 'export', icon: '⤓', label: { ja: '書き出し', en: 'Export' }, panels: ['export'] },
  { id: 'more', icon: '…', label: { ja: 'その他', en: 'More' }, panels: ['settings', 'help'] },
];

/** 自分でプレビューを持つパネル (上の小さなプレビューは出さない。WebGL を 2 つ使わないように) */
const HAS_OWN_PREVIEW: ReadonlySet<PanelId> = new Set(['visualizer', 'overlay', 'motion']);
/** 上の小さなプレビューを出さないパネル (歌詞は作り直しの重さで打ち込みを取りこぼさないように、使い方は読む画面なので) */
const NO_TOP_PREVIEW: ReadonlySet<PanelId> = new Set([...HAS_OWN_PREVIEW, 'lyrics', 'help', 'settings']);

let activeMenu = MENUS[0]!.id;
const activePanel: Record<string, PanelId> = Object.fromEntries(MENUS.map((m) => [m.id, m.panels[0]!]));

/** 今のメニューとパネル (テスト・PC 表示から移るとき用) */
export function mobileActive(): { menu: string; panel: PanelId } {
  return { menu: activeMenu, panel: activePanel[activeMenu]! };
}

/** PC 表示のタブ → スマホ表示のメニュー (切り替えたときに同じ画面を開く) */
export function selectMobilePanel(panel: PanelId): void {
  const m = MENUS.find((x) => x.panels.includes(panel));
  if (!m) return;
  activeMenu = m.id;
  activePanel[m.id] = panel;
}

export function mountMobileShell(root: HTMLElement): () => void {
  root.innerHTML = '';
  const shell = document.createElement('div');
  shell.className = 'app-shell mobile-shell';

  const header = document.createElement('header');
  header.className = 'm-header';
  const title = document.createElement('h1');
  const three = document.createElement('span');
  three.className = 'logo-3';
  three.textContent = '3';
  title.append('ZUNZUN', three);
  header.append(title, createTransport({ spaceHandledByPanel: () => mobileActive().panel === 'lyrics' }));
  // 画面の大きさ: ヘッダーは 1 行で余裕が無いので、そのすぐ下に細い 1 行を固定して置く (どのタブでも見える)
  const sizeBar = document.createElement('div');
  sizeBar.className = 'm-sizebar';
  const sizeLabel = document.createElement('span');
  const sizeLabelText = (): string => tr('画面の大きさ', 'Screen size');
  sizeLabel.textContent = sizeLabelText();
  sizeBar.append(sizeLabel, createSizeSelect());

  const previewBox = document.createElement('div');
  previewBox.className = 'm-preview';
  const sub = document.createElement('nav');
  sub.className = 'm-subtabs';
  sub.setAttribute('role', 'tablist');
  const body = document.createElement('main');
  body.className = 'app-body m-body';
  const nav = document.createElement('nav');
  nav.className = 'm-nav';
  nav.setAttribute('aria-label', 'menu');

  shell.append(header, sizeBar, previewBox, sub, body, nav);
  root.appendChild(shell);

  /** 「その他」の上に出す、言語・ライセンス・PC 表示 */
  const moreTools = (): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'm-tools';
    const langs = document.createElement('div');
    langs.className = 'lang-switch';
    langs.setAttribute('role', 'group');
    langs.setAttribute('aria-label', tr('表示の言語', 'Language'));
    for (const l of ['ja', 'en'] as Lang[]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab-button lang-button';
      b.textContent = l === 'ja' ? '日本語' : 'EN';
      b.dataset.lang = l;
      b.setAttribute('aria-pressed', String(l === lang()));
      b.addEventListener('click', () => setLang(l));
      langs.appendChild(b);
    }
    const license = document.createElement('button');
    license.type = 'button';
    license.className = 'tab-button';
    license.dataset.shell = 'license';
    license.textContent = tr('ライセンス', 'License');
    license.addEventListener('click', () => {
      activePanel.more = 'help';
      render();
      body.querySelector('[data-help="license"]')?.scrollIntoView({ block: 'start' });
    });
    const pc = document.createElement('button');
    pc.type = 'button';
    pc.className = 'tab-button';
    pc.dataset.shell = 'to-pc';
    pc.textContent = tr('PC 表示にする', 'Switch to PC view');
    pc.addEventListener('click', () => setLayout('pc'));
    box.append(langs, license, pc);
    return box;
  };

  let previewFor: PanelId | null = null;
  const render = (): void => {
    const menu = MENUS.find((m) => m.id === activeMenu) ?? MENUS[0]!;
    const panel = activePanel[menu.id]!;
    document.documentElement.lang = lang();

    // 下のメニュー
    nav.innerHTML = '';
    for (const m of MENUS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'm-nav-button';
      b.dataset.menu = m.id;
      b.setAttribute('aria-current', String(m.id === menu.id));
      const icon = document.createElement('span');
      icon.className = 'm-nav-icon';
      icon.textContent = m.icon;
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'm-nav-label';
      label.textContent = t2(m.label);
      b.append(icon, label);
      b.addEventListener('click', () => {
        activeMenu = m.id;
        render();
        window.scrollTo(0, 0);
      });
      nav.appendChild(b);
    }

    // メニューの中のパネルの切り替え (2 つ以上あるときだけ)
    sub.innerHTML = '';
    sub.hidden = menu.panels.length < 2;
    for (const id of menu.panels) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab-button m-subtab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === panel));
      b.dataset.panel = id;
      b.textContent = t2(PANELS[id].label);
      b.addEventListener('click', () => {
        activePanel[menu.id] = id;
        render();
      });
      sub.appendChild(b);
    }

    // 上の小さなプレビュー (要るパネルだけ。同じパネルのままなら作り直さない)
    const wantPreview = !NO_TOP_PREVIEW.has(panel);
    if (!wantPreview) {
      previewBox.innerHTML = '';
      previewBox.hidden = true;
      previewFor = null;
    } else if (previewFor === null) {
      previewBox.hidden = false;
      previewBox.appendChild(createLivePreview().element);
      previewFor = panel;
    }

    body.innerHTML = '';
    if (menu.id === 'more') body.appendChild(moreTools());
    body.appendChild(PANELS[panel].render());
  };

  render();
  const offLang = onLangChange(() => {
    sizeLabel.textContent = sizeLabelText();
    render();
  });
  return () => {
    offLang();
    root.innerHTML = '';
  };
}
