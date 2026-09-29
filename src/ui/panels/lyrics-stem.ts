import { syncTargetsFor } from '../../core/lyrics';
import { loadedStem, loadVocalStem, STEM_DURATION_TOLERANCE, stemState, unloadVocalStem, type LoadedStem } from '../../core/lyrics/stem';
import { store } from '../../core/store';
import { defaultLyrics, type LyricsStem } from '../../core/types';

/**
 * Lyrics タブの「ボーカル stem (吸着用)」欄。ボーカルだけの音源を読み込むと、歌詞の吸着先 (歌い出し候補) をそこから拾う。
 * 再生・ビジュアライザー・書き出し・小節の頭の吸着は元の曲のまま (core/lyrics/stem.ts)。
 * stem の中身はメモリにだけ置き、Project JSON にはファイル名と sha256 だけを保存する。
 */

export interface StemCardCallbacks {
  /** stem の設定・読み込みが変わったとき (吸着先・タイムラインの作り直し) */
  onChange(): void;
}

export interface StemCard {
  element: HTMLElement;
  refresh(): void;
}

/** 今の設定で吸着に使う stem (使わなければ null)。Lyrics パネルの吸着先・タイムラインの表示が使う */
export function activeStem(): LoadedStem | null {
  const stem = loadedStem();
  const state = stemState(store.lyrics?.stem, stem, store.audio.isLoaded ? store.audio.duration : undefined);
  return state.kind === 'active' ? stem : null;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

export function createStemCard(cb: StemCardCallbacks): StemCard {
  const root = h('div', 'lyrics-card lyrics-stem');
  const fileInput = h('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac';
  const removeBtn = h('button', 'tab-button', '外す');
  removeBtn.type = 'button';
  const enabled = h('input');
  enabled.type = 'checkbox';
  const enabledLabel = h('label', 'row-gap param-label');
  enabledLabel.append(enabled, '吸着にボーカル stem を使う');
  const status = h('div', 'param-label lyrics-stem-status');
  const warn = h('div', 'param-label lyrics-stem-warn');
  let busy = false;

  const row = h('div', 'row-gap lyrics-row-wrap');
  row.append(h('span', 'param-label', 'ボーカルだけの音源:'), fileInput, removeBtn);
  root.append(
    h('h3', 'lyrics-h3', 'ボーカル stem (吸着用)'),
    h(
      'p',
      'lyrics-help',
      '伴奏入りの曲では、ギターやスネアなどの出だしも「歌い出し候補」になります。ボーカルだけの音源 (stem) を読み込むと、' +
        '候補をそこから拾うので、吸着がほぼ歌い出しだけに寄るようになります。再生・ビジュアライザー・書き出し・小節の吸着は元の曲のままです。' +
        '元の曲と同じ長さ・同じ頭の位置の stem を使ってください (音源は保存されず、プロジェクトにはファイル名だけが残ります)。',
    ),
    row,
    enabledLabel,
    status,
    warn,
  );

  const setStem = (stem: LyricsStem | null): void => {
    const base = store.lyrics ?? defaultLyrics();
    store.setLyrics({ ...base, stem });
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    busy = true;
    status.textContent = `「${file.name}」を読み込んでいます…`;
    warn.textContent = '';
    loadVocalStem(file)
      .then((stem) => {
        setStem({ ref: stem.name, sha256: stem.sha256, enabled: true });
      })
      .catch((err: unknown) => {
        warn.textContent = `読み込めませんでした: ${err instanceof Error ? err.message : String(err)}`;
      })
      .finally(() => {
        busy = false;
        fileInput.value = '';
        refresh();
        cb.onChange();
      });
  });
  enabled.addEventListener('change', () => {
    const cur = store.lyrics?.stem;
    if (!cur) return;
    setStem({ ...cur, enabled: enabled.checked });
    refresh();
    cb.onChange();
  });
  removeBtn.addEventListener('click', () => {
    unloadVocalStem();
    setStem(null);
    refresh();
    cb.onChange();
  });

  function refresh(): void {
    if (busy) return;
    const settings = store.lyrics?.stem ?? null;
    const stem = loadedStem();
    const mainDuration = store.audio.isLoaded ? store.audio.duration : undefined;
    const state = stemState(settings, stem, mainDuration);
    enabled.checked = settings?.enabled ?? false;
    enabled.disabled = settings == null;
    removeBtn.disabled = settings == null && stem == null;
    warn.textContent = '';
    root.classList.toggle('active', state.kind === 'active');
    if (!settings) {
      status.textContent = '読み込んでいません (元の曲から歌い出し候補を拾います)。';
      return;
    }
    switch (state.kind) {
      case 'off':
        status.textContent = `「${settings.ref}」は吸着に使っていません (元の曲から歌い出し候補を拾います)。`;
        return;
      case 'missing':
        status.textContent = `このプロジェクトはボーカル stem「${settings.ref}」を使う設定です。同じファイルを選び直してください (選び直すまでは元の曲の候補を使います)。`;
        return;
      case 'mismatch':
        status.textContent = `読み込んである「${stem?.name ?? ''}」は、設定のファイル「${settings.ref}」と違います。使うファイルを選び直してください (それまでは元の曲の候補を使います)。`;
        return;
      case 'active': {
        const fromStem = syncTargetsFor(stem!.analysis).candidates.length;
        const fromMain = store.audio.analysis ? syncTargetsFor(store.audio.analysis).candidates.length : null;
        status.textContent =
          `「${settings.ref}」を使っています — 歌い出し候補 ${fromStem} 個` + (fromMain != null ? ` (元の曲だけだと ${fromMain} 個)` : '');
        if (Math.abs(state.durationGap) > STEM_DURATION_TOLERANCE) {
          warn.textContent = `注意: 元の曲と長さが ${Math.abs(state.durationGap).toFixed(2)} 秒違います。同じ曲から作った stem か、頭の位置がそろっているか確かめてください。`;
        }
      }
    }
  }

  refresh();
  return { element: root, refresh };
}
