import { syncTargetsFor } from '../../core/lyrics';
import { loadedStem, loadVocalStem, STEM_DURATION_TOLERANCE, stemState, unloadVocalStem, type LoadedStem } from '../../core/lyrics/stem';
import { store } from '../../core/store';
import { tr } from '../../core/i18n';
import { AUDIO_ACCEPT } from './panel-helpers';
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
  fileInput.accept = AUDIO_ACCEPT;
  const removeBtn = h('button', 'tab-button', tr('外す', 'Remove'));
  removeBtn.type = 'button';
  const enabled = h('input');
  enabled.type = 'checkbox';
  const enabledLabel = h('label', 'row-gap param-label');
  enabledLabel.append(enabled, tr('合わせるときにボーカルだけの音を使う', 'Use the vocal-only audio for snapping'));
  const status = h('div', 'param-label lyrics-stem-status');
  const warn = h('div', 'param-label lyrics-stem-warn');
  let busy = false;

  const row = h('div', 'row-gap lyrics-row-wrap');
  row.append(h('span', 'param-label', tr('ボーカルだけの音 (stem):', 'Vocal-only audio (stem):')), fileInput, removeBtn);
  root.append(
    h('h3', 'lyrics-h3', tr('ボーカルだけの音 (タイミング合わせ用)', 'Vocal-only audio (for timing)')),
    h(
      'p',
      'lyrics-help',
      tr(
        '伴奏入りの曲では、ギターやスネアなどの出だしも「歌い出しかも」と拾ってしまいます。ボーカルだけの音 (stem) を読み込むと、そこから拾うので、自動で合わせる位置がほぼ歌い出しだけになります。再生・ビジュアライザー・書き出し・小節の吸着は元の曲のままです。元の曲と同じ長さ・同じ始まりの位置のものを使ってください (音は保存されず、プロジェクトにはファイル名だけが残ります)。',
        'With a full mix, guitar and snare hits are also picked up as possible vocal entries. Load a vocal-only track (stem) and entries are taken from it, so snapping lands almost only on sung phrases. Playback, visuals, export and bar snapping still use the original song. Use a stem with the same length and start as the song (the audio is not saved; the project keeps only the file name).',
      ),
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
    status.textContent = tr(`「${file.name}」を読み込んでいます…`, `Loading "${file.name}"…`);
    warn.textContent = '';
    loadVocalStem(file)
      .then((stem) => {
        setStem({ ref: stem.name, sha256: stem.sha256, enabled: true });
      })
      .catch((err: unknown) => {
        warn.textContent = `${tr('読み込めませんでした', 'Could not load')}: ${err instanceof Error ? err.message : String(err)}`;
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
      status.textContent = tr('読み込んでいません (元の曲から歌い出しを拾います)。', 'Not loaded (vocal entries are taken from the original song).');
      return;
    }
    switch (state.kind) {
      case 'off':
        status.textContent = tr(`「${settings.ref}」は使っていません (元の曲から歌い出しを拾います)。`, `"${settings.ref}" is not used (vocal entries are taken from the original song).`);
        return;
      case 'missing':
        status.textContent = tr(`このプロジェクトはボーカルだけの音「${settings.ref}」を使います。同じファイルを選び直してください (それまでは元の曲から拾います)。`, `This project uses the vocal-only audio "${settings.ref}". Please pick the same file again (until then the original song is used).`);
        return;
      case 'mismatch':
        status.textContent = tr(`読み込んである「${stem?.name ?? ''}」は、設定のファイル「${settings.ref}」と違います。使うファイルを選び直してください (それまでは元の曲から拾います)。`, `The loaded "${stem?.name ?? ''}" differs from the project's "${settings.ref}". Please pick the right file (until then the original song is used).`);
        return;
      case 'active': {
        const fromStem = syncTargetsFor(stem!.analysis).candidates.length;
        const fromMain = store.audio.analysis ? syncTargetsFor(store.audio.analysis).candidates.length : null;
        status.textContent =
          tr(`「${settings.ref}」を使っています — 歌い出しの候補 ${fromStem} 個`, `Using "${settings.ref}" — ${fromStem} vocal entries`) + (fromMain != null ? tr(` (元の曲だけだと ${fromMain} 個)`, ` (${fromMain} from the original song alone)`) : '');
        if (Math.abs(state.durationGap) > STEM_DURATION_TOLERANCE) {
          warn.textContent = tr(`注意: 元の曲と長さが ${Math.abs(state.durationGap).toFixed(2)} 秒違います。同じ曲から作ったものか、始まりの位置がそろっているか確かめてください。`, `Note: the length differs from the song by ${Math.abs(state.durationGap).toFixed(2)} s. Check that it comes from the same song and starts at the same point.`);
        }
      }
    }
  }

  refresh();
  return { element: root, refresh };
}
