import { t2, tr, type Text2 } from '../../core/i18n';
import { visualizerRegistry } from '../../visualizers';

/**
 * ビジュアライザーを選ぶカード (2026-10-04 UI を正式版に合わせる。段階 4)。サムネイルは `scripts/make-thumbs.mjs` が実際に 1 コマ描いて
 * `src/assets/thumbs/<id>.webp` に作る (ビジュアライザーを足したら、やり直す)。ここには一言の説明と「背景に重ねる向き」の印だけを持つ
 * (UI だけの知識なので、manifest ではなくここに置く)。
 */

interface PresetInfo {
  about: Text2;
  /** 黒い背景に光だけを描くので、背景の絵に重ねて使うのに向く */
  overlay?: boolean;
}

const INFO: Record<string, PresetInfo> = {
  none: { about: { ja: '何も出さない (背景だけを見せる)', en: 'Shows nothing (just the background)' } },
  'solar-gate': { about: { ja: '日食のリングと、広がる光', en: 'A solar-eclipse ring with spreading light' } },
  'milky-way': { about: { ja: '天の川と、静かな湖', en: 'The Milky Way over a calm lake' } },
  'live-stage': { about: { ja: 'ライブ会場の照明', en: 'Concert-stage lights' } },
  'speaker-rack': { about: { ja: 'ラックとスピーカーが、音で動く', en: 'A rack of speakers that move with the music' } },
  'speaker-cone': { about: { ja: 'スピーカーのコーンと、飛ぶ粒', en: 'A speaker cone with flying particles' }, overlay: true },
  'speaker-twin': { about: { ja: '左右 2 台のスピーカーの掛け合い', en: 'Two speakers answering each other' }, overlay: true },
  'speaker-mega': { about: { ja: '虹色に派手に光る大きなスピーカー', en: 'A big, flashy rainbow speaker' }, overlay: true },
  'edge-equalizer': { about: { ja: '画面の縁に並ぶイコライザー', en: 'An equalizer around the screen edge' }, overlay: true },
  'spectrum-wave': { about: { ja: 'スペクトルのなめらかな光の波', en: 'A smooth glowing wave of the spectrum' }, overlay: true },
  'led-matrix': { about: { ja: 'LED の点が並ぶイコライザー', en: 'An equalizer of LED dots' }, overlay: true },
  ripples: { about: { ja: '拍で広がる波紋', en: 'Ripples spreading on each beat' }, overlay: true },
  kaleidoscope: { about: { ja: '万華鏡。曲調で色と模様が変わり、ときどきハート', en: 'A kaleidoscope that follows the mood, with hearts now and then' } },
  'photo-motion': { about: { ja: '用意した写真が、音で動く', en: 'A prepared photo that moves with the music' } },
  'city-scroll': { about: { ja: '流れる街並み', en: 'Scrolling city scenes' } },
  'cyber-space': { about: { ja: 'サイバー空間のトンネル', en: 'A cyber-space tunnel' } },
};

/** サムネイル (ビルド時に URL にする) */
const THUMBS = import.meta.glob('../../assets/thumbs/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const thumbUrl = (id: string): string | undefined => THUMBS[`../../assets/thumbs/${id}.webp`];

export interface PresetCards {
  element: HTMLElement;
  /** 選択中の表示を合わせる */
  refresh(currentId: string): void;
}

/**
 * 一覧を開いているか。タブを切り替えるたびに画面は作り直されるので、モジュールで持つ (最初は開いて、何か選んだらたたむ。
 * たたむのは、一覧が大きく、プレビューが画面の下へ押し出されるため。押すとまた開く)
 */
let pickerOpen = true;

export function createPresetCards(onSelect: (id: string) => void): PresetCards {
  const picker = document.createElement('details');
  picker.className = 'preset-picker';
  picker.open = pickerOpen;
  picker.addEventListener('toggle', () => (pickerOpen = picker.open));
  const summary = document.createElement('summary');
  summary.className = 'preset-picker-summary';
  const summaryName = document.createElement('span');
  summaryName.className = 'preset-picker-name';
  const summaryHint = document.createElement('span');
  summaryHint.className = 'param-help';
  summary.append(summaryName, summaryHint);
  picker.appendChild(summary);
  const grid = document.createElement('div');
  grid.className = 'preset-cards';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', tr('映像の種類', 'Visual preset'));
  const cards = new Map<string, HTMLButtonElement>();
  for (const m of visualizerRegistry.list()) {
    if (m.id.startsWith('_')) continue; // 開発用
    const info = INFO[m.id];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'preset-card';
    card.dataset.preset = m.id;
    const pic = document.createElement('span');
    pic.className = 'preset-card-pic';
    const url = thumbUrl(m.id);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      pic.appendChild(img);
    } else {
      pic.classList.add('preset-card-none');
      pic.textContent = '⊘';
    }
    if (info?.overlay) {
      const badge = document.createElement('span');
      badge.className = 'preset-card-badge';
      badge.textContent = tr('背景に重ねる向き', 'For overlay');
      badge.title = tr('黒い背景に光だけを描くので、背景の絵に重ねて使うのに向いています', 'Draws only light on black, so it suits layering over a background picture');
      pic.appendChild(badge);
    }
    const name = document.createElement('span');
    name.className = 'preset-card-name';
    name.textContent = m.id === 'none' ? tr('なし', 'None') : m.name;
    const about = document.createElement('span');
    about.className = 'preset-card-about';
    about.textContent = info ? t2(info.about) : '';
    card.append(pic, name, about);
    card.addEventListener('click', () => {
      onSelect(m.id);
      picker.open = false; // 選んだら一覧をたたむ (プレビューを見せる)
    });
    cards.set(m.id, card);
    grid.appendChild(card);
  }
  picker.appendChild(grid);
  return {
    element: picker,
    refresh(currentId: string) {
      for (const [id, card] of cards) card.setAttribute('aria-pressed', String(id === currentId));
      const m = visualizerRegistry.list().find((x) => x.id === currentId);
      summaryName.textContent = `${tr('映像の種類', 'Visual preset')}: ${currentId === 'none' ? tr('なし', 'None') : (m?.name ?? currentId)}`;
      summaryHint.textContent = tr('押すと一覧が開閉します', 'Click to open or close the list');
    },
  };
}
