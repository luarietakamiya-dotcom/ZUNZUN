import { tr } from '../../core/i18n';
import { listLocalFonts, localFontName, SUBTITLE_FONTS } from '../../core/lyrics/subtitle-fonts';
import { defaultSubtitle, type SubtitleSettings } from '../../core/types';

/**
 * シンプル字幕 (JIZURA を使わない字幕。core/lyrics/simple-subtitle.ts) の設定欄。リリックモーションのタブで、描き方が
 * 「シンプル字幕」のときだけ出す。書体は Google Fonts の一覧と、この PC に入っている書体 (2026-11-25 姫)。
 * 画面はタブを替えるたびに作り直されるので、この PC の書体の一覧はモジュール単位で覚えておく。
 */

let localFonts: string[] | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: { className?: string; textContent?: string } = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.textContent != null) node.textContent = props.textContent;
  for (const c of children) node.append(c);
  return node;
}

export interface SubtitleEditor {
  element: HTMLElement;
  refresh(settings: SubtitleSettings | undefined, enabled: boolean): void;
}

export function createSubtitleEditor(onChange: (patch: Partial<SubtitleSettings>) => void): SubtitleEditor {
  let current: SubtitleSettings = defaultSubtitle();

  // 書体: Google Fonts の一覧 + この PC の書体
  const fontSelect = el('select', { className: 'select' });
  fontSelect.dataset.subtitle = 'font';
  fontSelect.addEventListener('change', () => onChange({ font: fontSelect.value }));
  const fontStatus = el('span', { className: 'param-help' });
  const localName = el('input');
  localName.type = 'text';
  localName.placeholder = tr('書体の名前 (例: 游ゴシック)', 'Font name (e.g. Arial)');
  localName.maxLength = 100;
  localName.hidden = true;
  const useLocal = el('button', { className: 'tab-button', textContent: tr('この書体を使う', 'Use this font') });
  useLocal.type = 'button';
  useLocal.hidden = true;
  useLocal.addEventListener('click', () => {
    const name = localName.value.replace(/["'\\;{}<>]/g, '').trim();
    if (name) onChange({ font: `local:${name}` });
  });
  const listLocal = el('button', { className: 'tab-button', textContent: tr('この PC の書体を一覧に出す', 'List fonts on this PC') });
  listLocal.type = 'button';
  listLocal.addEventListener('click', () => {
    fontStatus.textContent = tr('PC の書体を調べています… (ブラウザが許可を聞いたら「許可」を押してください)', 'Reading fonts on this PC… (allow it if the browser asks)');
    void listLocalFonts().then((names) => {
      if (names && names.length) {
        localFonts = names;
        fontStatus.textContent = tr(`この PC の書体 ${names.length} 種類を一覧に足しました。`, `Added ${names.length} fonts from this PC to the list.`);
        fillFonts();
      } else {
        // 一覧を出せないブラウザ (Safari・Firefox など) や、許可されなかったとき: 名前を手で入れる
        localName.hidden = false;
        useLocal.hidden = false;
        fontStatus.textContent = tr('このブラウザでは PC の書体を一覧にできません。書体の名前を入れてください。', 'This browser cannot list PC fonts. Type the font name instead.');
      }
    });
  });

  const fillFonts = (): void => {
    const sel = current.font;
    fontSelect.textContent = '';
    const google = el('optgroup');
    google.label = tr('どの PC でも同じ (Google Fonts)', 'Same on every PC (Google Fonts)');
    for (const f of SUBTITLE_FONTS) {
      const o = el('option', { textContent: tr(f.label.ja, f.label.en) });
      o.value = f.key;
      google.append(o);
    }
    fontSelect.append(google);
    const names = new Set(localFonts ?? []);
    const chosen = localFontName(sel);
    if (chosen) names.add(chosen);
    if (names.size) {
      const local = el('optgroup');
      local.label = tr('この PC の書体 (ほかの PC では別の書体になります)', 'Fonts on this PC (may differ on other PCs)');
      for (const n of names) {
        const o = el('option', { textContent: n });
        o.value = `local:${n}`;
        local.append(o);
      }
      fontSelect.append(local);
    }
    fontSelect.value = sel;
  };

  const bold = el('input');
  bold.type = 'checkbox';
  bold.dataset.subtitle = 'bold';
  bold.addEventListener('change', () => onChange({ bold: bold.checked }));

  const position = el('select', { className: 'select' });
  position.dataset.subtitle = 'position';
  for (const [v, ja, en] of [['bottom', '下', 'Bottom'], ['middle', '中央', 'Middle'], ['top', '上', 'Top']] as const) {
    const o = el('option', { textContent: tr(ja, en) });
    o.value = v;
    position.append(o);
  }
  position.addEventListener('change', () => onChange({ position: position.value as SubtitleSettings['position'] }));

  const color = el('input');
  color.type = 'color';
  color.dataset.subtitle = 'color';
  color.addEventListener('input', () => onChange({ color: color.value }));
  const outlineColor = el('input');
  outlineColor.type = 'color';
  outlineColor.dataset.subtitle = 'outline-color';
  outlineColor.addEventListener('input', () => onChange({ outlineColor: outlineColor.value }));

  type NumKey = 'size' | 'outline' | 'shadow' | 'fade';
  const SLIDERS: { key: NumKey; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
    { key: 'size', label: tr('大きさ', 'Size'), min: 0.5, max: 2, step: 0.05, fmt: (v) => `×${v.toFixed(2)}` },
    { key: 'outline', label: tr('ふちどり', 'Outline'), min: 0, max: 1, step: 0.05, fmt: (v) => (v ? v.toFixed(2) : tr('なし', 'none')) },
    { key: 'shadow', label: tr('影', 'Shadow'), min: 0, max: 1, step: 0.05, fmt: (v) => (v ? v.toFixed(2) : tr('なし', 'none')) },
    { key: 'fade', label: tr('フェード', 'Fade'), min: 0, max: 1, step: 0.05, fmt: (v) => (v ? tr(`${v.toFixed(2)} 秒`, `${v.toFixed(2)} s`) : tr('なし (パッと切り替え)', 'none (hard cut)')) },
  ];
  const sliders = new Map<NumKey, { input: HTMLInputElement; label: HTMLSpanElement; fmt: (v: number) => string; name: string }>();
  const sliderRows = SLIDERS.map((d) => {
    const input = el('input');
    input.type = 'range';
    input.min = String(d.min);
    input.max = String(d.max);
    input.step = String(d.step);
    input.dataset.subtitle = d.key;
    const label = el('span', { className: 'param-label' });
    input.addEventListener('input', () => onChange({ [d.key]: parseFloat(input.value) }));
    sliders.set(d.key, { input, label, fmt: d.fmt, name: d.label });
    return el('label', { className: 'param-row' }, [label, input]);
  });

  const element = el('div', { className: 'lyrics-subtitle' }, [
    el('p', {
      className: 'lyrics-help',
      textContent: tr(
        'JIZURA を使わず、今の行をそのまま字幕として出します。動きはなく、位置・大きさ・色は固定です (出入りのフェードだけ)。準備がほぼ一瞬で、書き出しも軽くなります。',
        'Shows the current line as a plain subtitle without JIZURA. No motion: position, size and color stay fixed (only a fade in/out). Ready almost instantly and lighter to export.',
      ),
    }),
    el('div', { className: 'row-gap lyrics-row-wrap' }, [el('span', { className: 'param-label', textContent: tr('書体:', 'Font:') }), fontSelect, el('label', { className: 'row-gap param-label' }, [bold, tr('太字', 'Bold')])]),
    el('div', { className: 'row-gap lyrics-row-wrap' }, [listLocal, localName, useLocal, fontStatus]),
    el('div', { className: 'row-gap lyrics-row-wrap' }, [
      el('span', { className: 'param-label', textContent: tr('位置:', 'Position:') }), position,
      el('span', { className: 'param-label', textContent: tr('文字の色:', 'Text color:') }), color,
      el('span', { className: 'param-label', textContent: tr('ふちどりの色:', 'Outline color:') }), outlineColor,
    ]),
    el('div', { className: 'param-grid lyrics-motion-grid' }, sliderRows),
  ]);

  return {
    element,
    refresh(settings, enabled) {
      current = { ...defaultSubtitle(), ...(settings ?? {}) };
      fillFonts();
      bold.checked = current.bold;
      position.value = current.position;
      color.value = current.color;
      outlineColor.value = current.outlineColor;
      for (const [key, s] of sliders) {
        s.input.value = String(current[key]);
        s.label.textContent = `${s.name}: ${s.fmt(current[key])}`;
      }
      for (const c of [fontSelect, bold, position, color, outlineColor, listLocal, localName, useLocal, ...[...sliders.values()].map((s) => s.input)]) c.disabled = !enabled;
    },
  };
}
