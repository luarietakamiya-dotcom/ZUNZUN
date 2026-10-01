import { tr } from '../../core/i18n';
import { customFromStyle, jizuraStyles, loadJizura, type JizuraApi } from '../../core/lyrics/jizura-adapter';
import { previewMotionProvider } from '../../core/lyrics/motion-provider';
import { store } from '../../core/store';
import { CUSTOM_STYLE_KEY, defaultLyrics, type LyricsMotion, type LyricsSettings } from '../../core/types';
import { createStyleEditor } from './lyrics-style-editor';
import { createMotionApplyNotice, previewMotionNow } from './motion-apply';

/**
 * 「リリックモーション」タブ (歌詞の動き = JIZURA)。2026-10-01 に「歌詞」タブから分けた (「歌詞のメニューだけ縦に長い」)。
 * スタイル・マイスタイル・動きの大きさなどのつまみと、歌詞の動きだけの見本 (黒地)。映像と重ねた見た目は「ビジュアライザー」タブ。
 * 見本の時刻は、上の共通の再生欄 (聞こえている位置) に合わせる。
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: { className?: string; textContent?: string } = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.textContent != null) node.textContent = props.textContent;
  for (const c of children) node.append(c);
  return node;
}

function button(label: string, onClick: () => void, className = 'tab-button'): HTMLButtonElement {
  const b = el('button', { className, textContent: label });
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

const currentLyrics = (): LyricsSettings => store.lyrics ?? defaultLyrics();

export function renderLyricMotionPanel(): HTMLElement {
  const root = el('section', { className: 'panel lyrics-panel' });
  root.append(
    el('h2', { textContent: tr('リリックモーション', 'Lyric motion') }),
    el('p', {
      textContent: tr(
        '「歌詞」タブで入れて時刻を合わせた歌詞を、どう動かすかを決めます。映像と重ねた見た目は「ビジュアライザー」タブで確かめてください。書体は Google Fonts から読み込みます (外と通信するのは書体を取ってくるときだけです)。',
        'Choose how the lyrics (entered and timed in the Lyrics tab) move. See them over the visuals in the Visualizer tab. Fonts are loaded from Google Fonts (the only network access).',
      ),
    }),
  );

  const motionEnabled = el('input');
  motionEnabled.type = 'checkbox';
  const styleSelect = el('select', { className: 'select' });
  const motionStatus = el('span', { className: 'param-label' });
  const MOTION_SLIDERS: { key: 'motion' | 'decor' | 'density'; label: string; help: string }[] = [
    { key: 'motion', label: tr('動きの大きさ', 'Motion'), help: tr('歌詞の文字がどれだけ大きく動くか', 'How big the lyric text moves') },
    { key: 'decor', label: tr('飾りの量', 'Decoration'), help: tr('線や図形などの飾りがどれだけ出るか', 'How many lines, shapes and other decorations appear') },
    {
      key: 'density',
      label: tr('区切りの細かさ', 'Cut density'),
      help: tr('大きいほど、1 行を細かい場面に分けて次々に見せます', 'Higher splits each line into more, quicker shots'),
    },
  ];
  const motionInputs = new Map<string, { input: HTMLInputElement; label: HTMLSpanElement }>();
  const updateMotion = (patch: Partial<LyricsMotion>): void => {
    const base = currentLyrics();
    store.setLyrics({ ...base, motion: { ...base.motion, ...patch } });
    refreshMotionControls();
  };
  motionEnabled.addEventListener('change', () => updateMotion({ enabled: motionEnabled.checked }));
  styleSelect.addEventListener('change', () => updateMotion({ style: styleSelect.value }));
  const sliderRows = MOTION_SLIDERS.map((def) => {
    const input = el('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    const label = el('span', { className: 'param-label' });
    input.addEventListener('input', () => updateMotion({ [def.key]: parseFloat(input.value) }));
    motionInputs.set(def.key, { input, label });
    return el('label', { className: 'param-row' }, [label, input, el('span', { className: 'param-help', textContent: def.help })]);
  });
  const motionCanvas = el('canvas', { className: 'lyrics-motion-canvas' });
  motionCanvas.width = 640;
  motionCanvas.height = 360;
  const motionCtx = motionCanvas.getContext('2d');
  const applyNotice = createMotionApplyNotice();

  // オリジナルのスタイル (L7): 今のスタイルを元に作り、色・書体・質感を変える
  let jz: JizuraApi | null = null;
  const customBtn = button(tr('このスタイルを元にマイスタイルを作る', 'Make my own style from this'), () => createCustomStyle(), 'tab-button lyrics-custom-button');
  const styleEditor = createStyleEditor({
    onChange: (custom) => updateMotion({ custom }),
    onResetFromBase: (baseKey) => {
      if (!jz) return;
      const name = currentLyrics().motion.custom?.name;
      const fresh = customFromStyle(baseKey, jz.STYLES[baseKey] ?? jz.STYLES.noir!, (c) => jz!.lum(c));
      updateMotion({ custom: { ...fresh, name: name ?? fresh.name } });
    },
    onDelete: () => {
      const base = currentLyrics().motion.custom?.base ?? 'noir';
      updateMotion({ custom: null, style: base });
    },
  });
  function createCustomStyle(): void {
    if (!jz) return;
    const m = currentLyrics().motion;
    // すでにマイスタイルがあれば、それを選び直すだけ (作り直すと調整が消えるため)
    if (m.custom) {
      updateMotion({ style: CUSTOM_STYLE_KEY });
      return;
    }
    const baseKey = m.style !== CUSTOM_STYLE_KEY && jz.STYLES[m.style] ? m.style : 'noir';
    updateMotion({ style: CUSTOM_STYLE_KEY, custom: customFromStyle(baseKey, jz.STYLES[baseKey]!, (c) => jz!.lum(c)) });
  }
  const noLyrics = el('div', { className: 'placeholder-card' });
  const motionCard = el('div', { className: 'lyrics-card' }, [
    el('label', { className: 'row-gap param-label' }, [motionEnabled, tr('ビジュアライザーの上に歌詞の動きを重ねる', 'Show lyric motion over the visuals')]),
    el('div', { className: 'row-gap lyrics-row-wrap' }, [el('span', { className: 'param-label', textContent: tr('スタイル:', 'Style:') }), styleSelect, customBtn, motionStatus]),
    styleEditor.element,
    el('div', { className: 'param-grid lyrics-motion-grid' }, sliderRows),
    applyNotice.element,
    motionCanvas,
  ]);
  root.append(noLyrics, motionCard);

  /** スタイルの一覧は JIZURA を読み込んでから埋める (読み込むまでは今のスタイルだけ出す) */
  let styleOptions: [string, string][] | null = null;
  void loadJizura()
    .then((J) => {
      jz = J;
      styleOptions = jizuraStyles(J);
      styleEditor.setJizura(J);
      refreshMotionControls();
    })
    .catch(() => {
      motionStatus.textContent = tr('歌詞の動きの仕組み (JIZURA) を読み込めませんでした', 'Could not load the lyric motion engine (JIZURA)');
    });

  function refreshMotionControls(): void {
    const m = currentLyrics().motion;
    motionEnabled.checked = m.enabled;
    // マイスタイルがあれば、一覧の先頭に「★ 名前」で出す
    const options: [string, string][] = [
      ...(m.custom ? [[CUSTOM_STYLE_KEY, `★ ${m.custom.name}`] as [string, string]] : []),
      ...(styleOptions ?? (m.style !== CUSTOM_STYLE_KEY ? [[m.style, m.style] as [string, string]] : [])),
    ];
    const signature = options.map((o) => o.join('=')).join('|');
    if (styleSelect.dataset.signature !== signature) {
      styleSelect.dataset.signature = signature;
      styleSelect.textContent = '';
      for (const [key, name] of options) {
        const opt = el('option', { textContent: name });
        opt.value = key;
        styleSelect.appendChild(opt);
      }
    }
    styleSelect.value = m.style;
    const usingCustom = m.style === CUSTOM_STYLE_KEY && m.custom != null;
    styleEditor.refresh(usingCustom ? m.custom : null);
    customBtn.hidden = usingCustom;
    customBtn.textContent = m.custom ? tr(`マイスタイル (${m.custom.name}) を使う`, `Use my style (${m.custom.name})`) : tr('このスタイルを元にマイスタイルを作る', 'Make my own style from this');
    customBtn.disabled = !jz || !m.enabled;
    for (const def of MOTION_SLIDERS) {
      const row = motionInputs.get(def.key)!;
      row.input.value = String(m[def.key]);
      row.label.textContent = `${def.label}: ${m[def.key].toFixed(2)}`;
    }
    for (const c of [styleSelect, ...[...motionInputs.values()].map((r) => r.input)]) c.disabled = !m.enabled;
    const hasText = currentLyrics().text.trim().length > 0;
    noLyrics.hidden = hasText;
    noLyrics.textContent = tr('まだ歌詞がありません。「歌詞」タブで歌詞を入れると、ここで動きを決められます。', 'No lyrics yet. Enter them in the Lyrics tab to choose how they move here.');
  }

  /** 歌詞の動きだけの見本 (黒地)。映像と重ねた見た目は Visualizer タブで見る */
  function drawMotionPreview(t: number): void {
    if (!motionCtx) return;
    const motion = previewMotionNow();
    const status = !store.audio.isLoaded
      ? tr('曲を読み込むと見本が出ます', 'Load a song to see a preview')
      : previewMotionProvider.lastError
        ? `${tr('作れませんでした', 'Could not build')}: ${previewMotionProvider.lastError}`
        : previewMotionProvider.isBuilding
          ? tr('準備しています… (書体の読み込みなど)', 'Preparing… (loading fonts etc.)')
          : '';
    if (motionStatus.textContent !== status) motionStatus.textContent = status;
    if (motion) {
      const h = Math.round((motionCanvas.width * motion.plan.H) / motion.plan.W);
      if (motionCanvas.height !== h) motionCanvas.height = h;
    }
    motionCtx.fillStyle = '#000';
    motionCtx.fillRect(0, 0, motionCanvas.width, motionCanvas.height);
    // JIZURA は描く前に canvas を消すので、黒地は別の canvas に重ねずに「描いたあとに下へ敷く」
    if (motion) {
      motion.render(motionCtx, t, { fast: true });
      motionCtx.globalCompositeOperation = 'destination-over';
      motionCtx.fillRect(0, 0, motionCanvas.width, motionCanvas.height);
      motionCtx.globalCompositeOperation = 'source-over';
    }
  }

  refreshMotionControls();
  // shell.ts はタブ切り替えで中身を差し替えるだけなので、外れたら止める
  const tick = (): void => {
    if (!root.isConnected && root.dataset.mounted === '1') return;
    if (root.isConnected) root.dataset.mounted = '1';
    drawMotionPreview(store.audio.isLoaded ? store.audio.heardTime : 0);
    applyNotice.update();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return root;
}
