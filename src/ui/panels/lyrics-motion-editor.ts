import { tr } from '../../core/i18n';
import { store } from '../../core/store';
import { defaultLyrics, type LyricsEffectGroup, type LyricsLineMotion, type LyricsMotion } from '../../core/types';
import { buildLyricsView } from '../../core/lyrics/view';
import { EFFECT_GROUPS } from '../../core/lyrics/motion-edit';
import { buildJizuraProject, COVERING_LAYOUTS, COVERING_TRANSITIONS, usesOddMeterPack, motionRhythmGrid, type JizuraApi } from '../../core/lyrics/jizura-adapter';
import { applyMotionPack } from '../../core/lyrics/packs';
import type { PackJ } from '../../core/lyrics/packs/types';
import { previewMotionNow } from './motion-apply';
import { previewMotionProvider } from '../../core/lyrics/motion-provider';

const LABELS: Record<LyricsEffectGroup, [string, string]> = {
  layout: ['文字の配置', 'Layout'], enter: ['登場', 'Entrance'], hold: ['表示中の動き', 'Hold'], exit: ['退場', 'Exit'],
  decor: ['装飾', 'Decoration'], treat: ['文字の加工', 'Text treatment'], cam: ['カメラ', 'Camera'], fx: ['画面効果', 'Screen effects'], trans: ['場面転換', 'Transition'],
};

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = className;
  return el;
}

export function createMotionEditor(update: (patch: Partial<LyricsMotion>) => void) {
  const element = node('div', '', 'lyrics-card lyrics-individual-editor');
  let J: JizuraApi | null = null;
  let lastMotion: LyricsMotion | null = null;
  let lastText = '';
  let lastSource = '';
  let lastRhythm = store.rhythm;
  let lastJ: JizuraApi | null = null;
  let lastSelected = -1;
  let lastLoaded = false;
  let lastDuration = 0;
  let selected = 0;
  let lockButton: HTMLButtonElement | null = null;
  let shuffleButton: HTMLButtonElement | null = null;
  const status = node('p', '', 'lyrics-help');
  const emptyLyrics = defaultLyrics();
  const current = () => store.lyrics ?? emptyLyrics;
  const selectedText = () => buildLyricsView(current()).parsed.lines[selected]?.text ?? '';
  const lineValue = (): LyricsLineMotion => {
    const text = selectedText();
    const saved = current().motion.lines?.[String(selected)];
    return saved?.text === text ? saved : { text };
  };
  const changeLine = (patch: Partial<LyricsLineMotion>) => {
    update({ lines: { ...current().motion.lines, [String(selected)]: { ...lineValue(), ...patch } } });
  };

  function refresh(): void {
    const lyrics = current();
    if (lyrics.motion === lastMotion && lyrics.text === lastText && lyrics.source === lastSource && J === lastJ && selected === lastSelected && store.rhythm === lastRhythm && store.audio.isLoaded === lastLoaded && store.audio.duration === lastDuration) {
      updateAvailability();
      return;
    }
    lastMotion = lyrics.motion;
    lastText = lyrics.text;
    lastSource = lyrics.source;
    lastJ = J;
    lastSelected = selected;
    lastRhythm = store.rhythm;
    lastLoaded = store.audio.isLoaded;
    lastDuration = store.audio.duration;
    const open = new Set([...element.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.group));
    element.replaceChildren(node('h3', tr('演出を個別に編集', 'Edit individual effects'), 'lyrics-h3'));
    if (!J) {
      element.append(node('p', tr('演出の一覧を読み込んでいます…', 'Loading effects…'), 'lyrics-help'));
      return;
    }
    const project = buildJizuraProject(lyrics, J.defaultProject(), { seed: store.seed, aspect: '16:9', fps: store.exportSettings.fps, oddMeter: usesOddMeterPack(lyrics.motion, motionRhythmGrid(store.rhythm)) });
    applyMotionPack(project, lyrics.motion, J as unknown as PackJ);
    const enabled = project.enabled as Record<string, Record<string, boolean>>;
    const entries = (group: LyricsEffectGroup) => J!.order(group).filter((key) => {
      const def = J!.registry(group)[key];
      return def && !def.special && !(group === 'layout' && COVERING_LAYOUTS.includes(key)) && !(group === 'trans' && COVERING_TRANSITIONS.includes(key)) && (!J!.randomOk || J!.randomOk(project, group, key));
    });
    const effects = node('details');
    effects.dataset.motionEditor = 'effects';
    effects.dataset.group = 'effects';
    effects.open = open.has('effects');
    effects.append(node('summary', tr('自動生成に使う演出を選ぶ', 'Choose effects for automatic generation')));
    effects.append(node('p', tr('チェックを外した演出は自動生成の候補から外します。行で直接指定した演出と固定した行は、その指定を優先します。', 'Unchecked effects are excluded from automatic generation. Per-line choices and locked lines take priority.'), 'lyrics-help'));
    for (const group of EFFECT_GROUPS) {
      const keys = entries(group);
      if (!keys.length) continue;
      const section = node('details');
      section.dataset.group = group;
      section.open = open.has(group);
      section.append(node('summary', tr(...LABELS[group])));
      const grid = node('div', '', 'param-grid');
      for (const key of keys) {
        const input = node('input');
        input.type = 'checkbox';
        input.dataset.effectGroup = group;
        input.dataset.effectKey = key;
        input.checked = lyrics.motion.effects?.[group]?.[key] ?? enabled[group]?.[key] !== false;
        input.disabled = !lyrics.motion.enabled;
        input.addEventListener('change', () => {
          update({ effects: { ...current().motion.effects, [group]: { ...current().motion.effects?.[group], [key]: input.checked } } });
        });
        const label = node('label', '', 'row-gap param-label');
        label.append(input, J.registry(group)[key]!.name);
        grid.append(label);
      }
      section.append(grid);
      effects.append(section);
    }
    const resetEffects = node('button', tr('演出の選択をスタイルの既定に戻す', 'Reset effects to style defaults'), 'tab-button');
    resetEffects.type = 'button';
    resetEffects.disabled = !lyrics.motion.effects;
    resetEffects.addEventListener('click', () => update({ effects: undefined }));
    effects.append(resetEffects);
    element.append(effects);

    const view = buildLyricsView(lyrics, store.audio.isLoaded ? store.audio.duration : undefined);
    if (!view.parsed.lines.length) {
      element.append(node('p', tr('歌詞を入れると、行ごとの編集ができます。', 'Enter lyrics to edit each line.'), 'lyrics-help'));
      return;
    }
    selected = Math.min(selected, view.parsed.lines.length - 1);
    const lineSelect = node('select', '', 'select');
    lineSelect.dataset.motionEditor = 'line';
    view.parsed.lines.forEach((line, i) => {
      const option = node('option', `${i + 1}. ${line.interlude ? tr('間奏', 'Interlude') : line.text}`);
      option.value = String(i);
      lineSelect.append(option);
    });
    lineSelect.value = String(selected);
    lineSelect.addEventListener('change', () => { selected = Number(lineSelect.value); status.textContent = ''; refresh(); });
    element.append(node('h4', tr('歌詞の行ごとに編集', 'Edit each lyric line')), lineSelect);
    const saved = lineValue();
    const fields = node('div', '', 'param-grid');
    for (const group of ['layout', 'enter', 'hold', 'exit', 'decor', 'treat', 'cam'] as const) {
      const select = node('select', '', 'select');
      select.dataset.lineEffect = group;
      const auto = node('option', tr('おまかせ', 'Automatic'));
      auto.value = '';
      select.append(auto);
      if (group === 'decor') {
        const none = node('option', tr('なし', 'None'));
        none.value = '__none';
        select.append(none);
      }
      const chosen = group === 'decor' ? saved.decor?.[0] : saved[group];
      const choices = entries(group);
      if (chosen && J.registry(group)[chosen] && !choices.includes(chosen) && !(group === 'layout' && COVERING_LAYOUTS.includes(chosen))) choices.push(chosen);
      for (const key of choices) {
        const option = node('option', J.registry(group)[key]!.name);
        option.value = key;
        select.append(option);
      }
      select.value = group === 'decor' ? saved.decor ? saved.decor[0] ?? '__none' : '' : saved[group] ?? '';
      select.disabled = !lyrics.motion.enabled || saved.lock === true || view.parsed.lines[selected]!.interlude;
      select.addEventListener('change', () => {
        changeLine(group === 'decor' ? { decor: select.value === '' ? undefined : select.value === '__none' ? [] : [select.value] } : { [group]: select.value || undefined });
      });
      const label = node('label', '', 'param-row');
      label.append(node('span', tr(...LABELS[group]), 'param-label'), select);
      fields.append(label);
    }
    const cuts = node('select', '', 'select');
    cuts.dataset.lineEffect = 'cuts';
    for (let n = 0; n <= 12; n++) {
      const option = node('option', n ? tr(`${n}分割`, `${n} cuts`) : tr('おまかせ', 'Automatic'));
      option.value = String(n);
      cuts.append(option);
    }
    cuts.value = String(saved.cuts ?? 0);
    cuts.disabled = !lyrics.motion.enabled || saved.lock === true || view.parsed.lines[selected]!.interlude;
    cuts.addEventListener('change', () => changeLine({ cuts: Number(cuts.value) || undefined }));
    const cutsLabel = node('label', '', 'param-row');
    cutsLabel.append(node('span', tr('行の分割数', 'Cuts per line'), 'param-label'), cuts);
    fields.append(cutsLabel);
    element.append(fields);
    const controls = node('div', '', 'row-gap lyrics-row-wrap');
    const seek = node('button', tr('この行をプレビュー', 'Preview this line'), 'tab-button');
    seek.type = 'button';
    seek.disabled = !store.audio.isLoaded;
    seek.addEventListener('click', () => store.audio.seek(view.times.starts[selected] ?? 0));
    shuffleButton = node('button', tr('この行を作り直す', 'Regenerate this line'), 'tab-button');
    shuffleButton.type = 'button';
    shuffleButton.addEventListener('click', () => changeLine({ seed: ((lineValue().seed ?? 0) + 1) >>> 0 }));
    lockButton = node('button', saved.lock ? tr('固定を解除', 'Unlock line') : tr('この行の演出を固定', 'Lock this line'), 'tab-button');
    lockButton.type = 'button';
    lockButton.dataset.motionEditor = 'lock';
    lockButton.addEventListener('click', () => {
      if (lineValue().lock) { changeLine({ lock: undefined, lockedSeed: undefined, lockedCuts: undefined }); return; }
      const motion = previewMotionNow();
      if (!motion || previewMotionProvider.isBuilding || previewMotionProvider.hasPendingTiming || motion.plan.lines[selected]?.text !== selectedText()) {
        status.textContent = tr('見本の準備と時刻の反映が終わってから固定してください。', 'Wait for the preview and apply timing changes before locking.');
        return;
      }
      const snapshot = J!.lineSnapshot(motion.plan, selected);
      if (snapshot) changeLine({ lock: true, lockedSeed: motion.plan.lines[selected]?.seed, lockedCuts: snapshot });
    });
    const reset = node('button', tr('この行の指定をリセット', 'Reset this line'), 'tab-button');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      const lines = { ...current().motion.lines };
      delete lines[String(selected)];
      update({ lines });
    });
    controls.append(seek, shuffleButton, lockButton, reset);
    element.append(controls, status, node('p', tr('指定はプロジェクトに保存します。歌詞を書き換えた行は、おまかせに戻ります。固定は配置や動きの選択を保ちます。スタイルや画面サイズを変えると色・書体・見え方は変わります。', 'Edits are saved in the project. Changed lyrics return to automatic choices. Locking preserves the selected layout and motions; changing style or canvas size can change colors, fonts, and appearance.'), 'lyrics-help'));
    updateAvailability();
  }

  function updateAvailability(): void {
    const saved = lineValue();
    if (shuffleButton) shuffleButton.disabled = !current().motion.enabled || !!saved.lock || !selectedText();
    if (lockButton) lockButton.disabled = !current().motion.enabled || !selectedText() || (!saved.lock && (!store.audio.isLoaded || previewMotionProvider.isBuilding || previewMotionProvider.hasPendingTiming || !previewMotionNow({ build: false })));
  }

  return { element, refresh, setJizura(api: JizuraApi) { J = api; refresh(); } };
}
