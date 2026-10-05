import { createMotionEditor } from './lyrics-motion-editor';
import { tr } from '../../core/i18n';
import { customFromStyle, jizuraStyles, loadJizura, LyricMotion, type JizuraApi } from '../../core/lyrics/jizura-adapter';
import { previewMotionProvider } from '../../core/lyrics/motion-provider';
import { blankAlpha } from '../../core/lyrics/blanks';
import { store } from '../../core/store';
import { CUSTOM_STYLE_KEY, defaultLyrics, type LyricsMotion, type LyricsSectionMotion, type LyricsSettings, type MotionLevel } from '../../core/types';
import { defaultSectionMotion, levelOf, SECTION_KINDS } from '../../core/lyrics/section-motion';
import type { SectionKind } from '../../core/lyrics/sections';
import { buildLyricsView } from '../../core/lyrics/view';
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
    if (sampleActive) { clearTimeout(sampleRebuild); sampleRebuild = setTimeout(() => void buildSample(), 180); }
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
  const individualEditor = createMotionEditor(updateMotion);
  const motionCanvas = el('canvas', { className: 'lyrics-motion-canvas' });
  motionCanvas.width = 640;
  motionCanvas.height = 360;
  const motionCtx = motionCanvas.getContext('2d');
  const applyNotice = createMotionApplyNotice();
  let sampleActive = false, samplePlaying = true, sampleTime = 1, sampleClock = performance.now(), sampleGeneration = 0;
  let sample: LyricMotion | null = null;
  let sampleRebuild: ReturnType<typeof setTimeout> | undefined;
  let sampleStatus = '';
  const sampleSeek = el('input'); sampleSeek.type = 'range'; sampleSeek.min = '0'; sampleSeek.max = '16'; sampleSeek.step = '0.01'; sampleSeek.value = '1';
  sampleSeek.setAttribute('aria-label', tr('サンプルの再生位置', 'Sample position'));
  sampleSeek.style.flex = '1';
  const sampleControls = el('div', { className: 'row-gap lyrics-row-wrap' }); sampleControls.hidden = true; sampleControls.style.display = 'none';
  const samplePause = button(tr('見本を停止', 'Pause sample'), () => { samplePlaying = !samplePlaying; samplePause.textContent = samplePlaying ? tr('見本を停止', 'Pause sample') : tr('見本を再生', 'Play sample'); sampleClock = performance.now(); });
  sampleSeek.addEventListener('input', () => { sampleTime = Number(sampleSeek.value); sampleClock = performance.now(); });
  const sampleAspect = el('select'); sampleAspect.setAttribute('aria-label', tr('サンプルの画面比率', 'Sample aspect ratio'));
  for (const ratio of ['16:9', '9:16']) { const option = el('option'); option.value = ratio; option.textContent = ratio; sampleAspect.append(option); }
  sampleAspect.addEventListener('change', () => { if (sampleActive) void buildSample(); });
  sampleControls.append(samplePause, sampleAspect, sampleSeek);
  const sampleButton = button(tr('サンプル歌詞で動きを見る', 'Preview with sample lyrics'), () => {
    sampleActive = !sampleActive; sampleControls.hidden = !sampleActive; sampleControls.style.display = sampleActive ? 'flex' : 'none';
    sampleButton.textContent = sampleActive ? tr('曲の歌詞に戻す', 'Back to song lyrics') : tr('サンプル歌詞で動きを見る', 'Preview with sample lyrics');
    if (sampleActive) void buildSample(); else { sampleGeneration++; sample = null; clearTimeout(sampleRebuild); }
  });
  async function buildSample(): Promise<void> {
    const generation = ++sampleGeneration;
    sampleStatus = tr('見本を準備しています…', 'Preparing sample…');
    const settings = defaultLyrics();
    settings.text = '光\n夜空に描いた言葉を君の明日まで届けたい\n消えないこの想い\n君へ届け';
    settings.timing.lineTimes = { '0': 0.4, '1': 4.4, '2': 8.4, '3': 12.4 };
    settings.timing.lineEnds = { '0': 4.3, '1': 8.3, '2': 12.3, '3': 15.9 };
    settings.motion = { ...currentLyrics().motion, lines: {}, effects: {}, sections: { enabled: false, levels: {} } };
    try {
      const next = await LyricMotion.create(settings, { duration: 16, beats: Array.from({ length: 32 }, (_, i) => i * 0.5), energy: new Float32Array(960).fill(0.5), energyRate: 60 }, { projectSeed: 41, width: sampleAspect.value === '9:16' ? 360 : 640, height: sampleAspect.value === '9:16' ? 640 : 360, fps: 30 });
      if (generation !== sampleGeneration || !sampleActive || !root.isConnected) return;
      sample = next; sampleTime = 1; sampleClock = performance.now(); sampleStatus = tr('サンプル歌詞・見本のリズムで再生中', 'Playing sample lyrics with a sample rhythm');
    } catch (err) { if (generation === sampleGeneration) sampleStatus = `${tr('見本を作れませんでした', 'Could not build sample')}: ${String(err)}`; }
  }

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
  // 曲の区切りで動きを変える (core/lyrics/section-motion.ts)
  const KIND_LABEL: Record<SectionKind, string> = {
    intro: tr('イントロ', 'Intro'),
    verse: tr('Aメロ', 'Verse'),
    prechorus: tr('Bメロ', 'Pre-chorus'),
    chorus: tr('サビ', 'Chorus'),
    bridge: tr('Cメロ', 'Bridge'),
    interlude: tr('間奏', 'Interlude'),
    outro: tr('アウトロ', 'Outro'),
    other: tr('その他', 'Other'),
  };
  const sectionsOn = el('input');
  sectionsOn.type = 'checkbox';
  sectionsOn.dataset.motion = 'sections-on';
  const sectionSelects = new Map<SectionKind, HTMLSelectElement>();
  const updateSections = (patch: Partial<LyricsSectionMotion>): void => {
    const cur = currentLyrics().motion.sections ?? defaultSectionMotion();
    updateMotion({ sections: { ...cur, ...patch, levels: { ...cur.levels, ...(patch.levels ?? {}) } } });
  };
  sectionsOn.addEventListener('change', () => updateSections({ enabled: sectionsOn.checked }));
  const sectionGrid = el('div', { className: 'param-grid' });
  for (const kind of SECTION_KINDS) {
    const sel = el('select', { className: 'select' });
    sel.dataset.motionLevel = kind;
    for (const [v, label] of [
      ['calm', tr('静か', 'Calm')],
      ['normal', tr('ふつう', 'Normal')],
      ['intense', tr('激しい', 'Intense')],
    ] as const) {
      const o = el('option', { textContent: label });
      o.value = v;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => updateSections({ levels: { [kind]: sel.value as MotionLevel } }));
    sectionSelects.set(kind, sel);
    sectionGrid.appendChild(el('label', { className: 'param-row' }, [el('span', { className: 'param-label', textContent: KIND_LABEL[kind] }), sel]));
  }
  const sectionNote = el('span', { className: 'param-help' });
  const sectionCard = el('div', { className: 'lyrics-card' }, [
    el('h3', { className: 'lyrics-h3', textContent: tr('曲の区切りで動きを変える', 'Change the motion by song section') }),
    el('p', {
      className: 'lyrics-help',
      textContent: tr(
        '歌詞に [イントロ] [サビ] などの見出しがあると、区切りごとに動きの強さを変えます (静か = 動き・飾りが少なく区切りも粗い、激しい = 動き・飾り・区切りの細かさを上げる。基準は上のつまみ)。変えると歌詞の動きを作り直すので、少し時間がかかります。',
        'With headings like [Intro] [Chorus] in the lyrics, the motion strength changes per section (Calm = less motion and decoration, coarser cuts; Intense = more of everything; based on the sliders above). Changing it rebuilds the lyric motion, which takes a moment.',
      ),
    }),
    el('label', { className: 'row-gap param-label' }, [sectionsOn, tr('曲の区切りで動きを変える', 'Change the motion by song section')]),
    sectionGrid,
    sectionNote,
  ]);
  const noLyrics = el('div', { className: 'placeholder-card' });
  const motionCard = el('div', { className: 'lyrics-card' }, [
    el('label', { className: 'row-gap param-label' }, [motionEnabled, tr('ビジュアライザーの上に歌詞の動きを重ねる', 'Show lyric motion over the visuals')]),
    el('div', { className: 'row-gap lyrics-row-wrap' }, [el('span', { className: 'param-label', textContent: tr('スタイル:', 'Style:') }), styleSelect, customBtn, motionStatus]),
    styleEditor.element,
    el('div', { className: 'param-grid lyrics-motion-grid' }, sliderRows),
    applyNotice.element,
    sampleButton,
    sampleControls,
    motionCanvas,
  ]);
  root.append(noLyrics, motionCard, individualEditor.element, sectionCard);

  /** スタイルの一覧は JIZURA を読み込んでから埋める (読み込むまでは今のスタイルだけ出す) */
  let styleOptions: [string, string][] | null = null;
  void loadJizura()
    .then((J) => {
      jz = J;
      styleOptions = jizuraStyles(J);
      styleEditor.setJizura(J);
      individualEditor.setJizura(J);
      refreshMotionControls();
    })
    .catch(() => {
      motionStatus.textContent = tr('歌詞の動きの仕組み (JIZURA) を読み込めませんでした', 'Could not load the lyric motion engine (JIZURA)');
    });

  function refreshMotionControls(): void {
    individualEditor.refresh();
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
    const sm = m.sections ?? defaultSectionMotion();
    sectionsOn.checked = sm.enabled;
    sectionsOn.disabled = !m.enabled;
    for (const [kind, sel] of sectionSelects) {
      sel.value = levelOf(sm, kind);
      sel.disabled = !m.enabled || !sm.enabled;
    }
    const kinds = new Set(buildLyricsView(currentLyrics(), store.audio.isLoaded ? store.audio.duration : undefined).sections.map((x) => x.kind));
    sectionNote.textContent =
      kinds.size === 0
        ? tr('今の歌詞には区切りの見出しがないので、曲全体が同じ強さです。', 'The current lyrics have no section headings, so the whole song uses one strength.')
        : tr(`今の歌詞の区切り: ${[...kinds].map((k) => KIND_LABEL[k]).join('・')}`, `Sections in the current lyrics: ${[...kinds].map((k) => KIND_LABEL[k]).join(', ')}`);
    const hasText = currentLyrics().text.trim().length > 0;
    noLyrics.hidden = hasText;
    noLyrics.textContent = tr('まだ歌詞がありません。「歌詞」タブで歌詞を入れると、ここで動きを決められます。', 'No lyrics yet. Enter them in the Lyrics tab to choose how they move here.');
  }

  /** 歌詞の動きだけの見本 (黒地)。映像と重ねた見た目は Visualizer タブで見る */
  function drawMotionPreview(t: number): void {
    if (!motionCtx) return;
    const motion = sampleActive ? sample : previewMotionNow();
    const status = sampleActive ? (!samplePlaying && sample ? tr('サンプルを停止中・位置を動かして比較できます', 'Sample paused: seek to compare') : sampleStatus) : !store.audio.isLoaded
      ? tr('曲を読み込むと見本が出ます', 'Load a song to see a preview')
      : previewMotionProvider.lastError
        ? `${tr('作れませんでした', 'Could not build')}: ${previewMotionProvider.lastError}`
        : previewMotionProvider.isBuilding
          ? tr('準備しています… (書体の読み込みなど)', 'Preparing… (loading fonts etc.)')
          : '';
    if (motionStatus.textContent !== status) motionStatus.textContent = status;
    if (motion) {
      motionCanvas.style.maxWidth = `${Math.min(640, Math.round(360 * motion.plan.W / motion.plan.H))}px`;
      const h = Math.round((motionCanvas.width * motion.plan.H) / motion.plan.W);
      if (motionCanvas.height !== h) motionCanvas.height = h;
    }
    motionCtx.fillStyle = '#000';
    motionCtx.fillRect(0, 0, motionCanvas.width, motionCanvas.height);
    // JIZURA は描く前に canvas を消すので、黒地は別の canvas に重ねずに「描いたあとに下へ敷く」
    if (motion) {
      // 歌詞の空白 (何も出さない時間) は描かない。端は黒を重ねてなめらかに消す
      const a = sampleActive ? 1 : blankAlpha(store.lyrics?.timing.blanks, t);
      if (a > 0.001) {
        motion.render(motionCtx, t, { fast: true });
        motionCtx.globalCompositeOperation = 'destination-over';
        motionCtx.fillRect(0, 0, motionCanvas.width, motionCanvas.height);
        motionCtx.globalCompositeOperation = 'source-over';
        if (a < 1) {
          motionCtx.fillStyle = `rgba(0,0,0,${(1 - a).toFixed(3)})`;
          motionCtx.fillRect(0, 0, motionCanvas.width, motionCanvas.height);
        }
      }
    }
  }

  refreshMotionControls();
  // shell.ts はタブ切り替えで中身を差し替えるだけなので、外れたら止める
  const tick = (): void => {
    if (!root.isConnected && root.dataset.mounted === '1') { sampleGeneration++; clearTimeout(sampleRebuild); return; }
    if (root.isConnected) root.dataset.mounted = '1';
    if (sampleActive && sample) {
      const now = performance.now();
      if (samplePlaying) sampleTime = (sampleTime + Math.min(0.1, (now - sampleClock) / 1000)) % 16;
      sampleClock = now; sampleSeek.value = String(sampleTime);
    }
    drawMotionPreview(sampleActive ? sampleTime : store.audio.isLoaded ? store.audio.heardTime : 0);
    applyNotice.update();
    individualEditor.refresh();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return root;
}
