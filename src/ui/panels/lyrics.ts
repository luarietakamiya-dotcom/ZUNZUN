import {
  buildLyricsView,
  formatTime,
  History,
  lineAt,
  parseLyricsSource,
  parseTimeInput,
  snapTime,
  syncTargetsFor,
  tapStartTime,
  TapSession,
  type LyricsView,
  type SnapResult,
  type SnapTargets,
} from '../../core/lyrics';
import { MAX_LYRICS_LENGTH } from '../../core/project/validate';
import { store } from '../../core/store';
import { defaultLyrics, type LyricsSettings, type LyricsSource, type LyricsTiming } from '../../core/types';

/**
 * Lyrics タブ (L3): 歌詞の入力・読み込み、再生しながらの半自動タップ同期、行ごとの時刻の確認と手入力。
 * 歌詞モーション (JIZURA) はまだ無いので、プレビューは「今の行」を文字で大きく出すだけ。
 * 操作は docs/ARCHITECTURE.md「歌詞同期の方針」のとおり:
 * - タップ: 再生中に Space/Enter を押すと、その場でタップが始まり「次の行」の頭として記録する (ボタンから始めてもよい)。
 *   止まっているときの Space は再生、Esc はタップをやめて一時停止。Backspace で 1 つ戻る、Esc で中断。Shift を押しながら叩くと吸着しない
 *   (Alt+Space は Windows でウィンドウのメニューが開くので使わない)
 * - 叩いた時刻は「いまスピーカーから聞こえている位置」(出力の遅れを差し引いた位置) で記録する
 * - 叩いた時刻は ±窓内の歌い出し候補 → ビートへ吸着する (core/lyrics/snap.ts)
 * - Ctrl/Cmd+Z で取り消し、Ctrl/Cmd+Y (または Shift+Z) でやり直し
 *
 * タブを切り替えるとパネルは丸ごと作り直される (unmount フックなし) ので、取り消しの履歴と選択中の行は
 * モジュール単位で持つ。タップ中にタブを離れた場合、タップはそこで終わる (叩いた時刻は残る)。
 */

type TimingSnapshot = Pick<LyricsTiming, 'lineTimes' | 'lineEnds'>;

const EMPTY_TIMING: TimingSnapshot = { lineTimes: {}, lineEnds: {} };
const history = new History<TimingSnapshot>(EMPTY_TIMING);
let selectedLine = 0;

const SOURCE_LABELS: Record<LyricsSource, string> = {
  text: 'テキスト (JIZURA の記法)',
  lrc: 'LRC',
  srt: 'SRT',
};

/**
 * 時刻の由来の表示。'estimate' (タップも LRC の時刻も無い行) は、JIZURA の規則で文字数から仮の時刻が付いているだけなので
 * 「未同期」と出し、プレビューにも出さない (1 行目が 0.4 秒から始まるため、イントロで歌詞が出て吸着したように見えていた)。
 * 仮の時刻は歌詞モーション (L5) では使うので、内部では持っておく。
 */
const START_SOURCE_LABELS = { manual: '手動', lrc: 'LRC', estimate: '未同期' } as const;

/** 由来の表示。タグから来た時刻は、SRT を読み込んだときは SRT と出す */
function startSourceLabel(src: keyof typeof START_SOURCE_LABELS, source: LyricsSource): string {
  return src === 'lrc' && source === 'srt' ? 'SRT' : START_SOURCE_LABELS[src];
}

function currentLyrics(): LyricsSettings {
  return store.lyrics ?? defaultLyrics();
}

/**
 * 取り消しの履歴が、store の今のタイミングと同じものを指しているかを確かめる。
 * Project JSON を読み込んだ直後など、別の経路で差し替わっていたら履歴を捨てて今の状態から始める。
 */
function syncHistoryWithStore(): void {
  const timing = store.lyrics?.timing ?? EMPTY_TIMING;
  const cur = history.current;
  if (timing.lineTimes !== cur.lineTimes || timing.lineEnds !== cur.lineEnds) {
    history.reset({ lineTimes: timing.lineTimes, lineEnds: timing.lineEnds });
  }
}

/** タイミングを書き換えて store に反映する。history に積んだものと同じオブジェクトを store に渡す。 */
function commitTiming(next: TimingSnapshot): void {
  history.push(next);
  store.updateLyricsTiming({ lineTimes: next.lineTimes, lineEnds: next.lineEnds });
}

function applyHistory(state: TimingSnapshot | null): boolean {
  if (!state) return false;
  store.updateLyricsTiming({ lineTimes: state.lineTimes, lineEnds: state.lineEnds });
  return true;
}

/** 拡張子と中身から入力形式を決める。LRC は text と同じ規則で読めるので、区別が要るのは SRT だけ */
function detectSource(fileName: string, text: string): LyricsSource {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'srt') return 'srt';
  if (ext === 'lrc') return 'lrc';
  if (/^\s*\d+\s*\n\s*\d+:\d{1,2}:\d{1,2}[,.]\d+\s*-->/m.test(text)) return 'srt';
  if (/^\s*\[\d+:\d{1,2}(?:[.:]\d+)?\]/m.test(text)) return 'lrc';
  return 'text';
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Pick<HTMLElementTagNameMap[K], 'className' | 'textContent'>> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
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

function describeSnap(s: SnapResult, raw: number): string {
  const d = s.t - raw;
  const delta = `${d >= 0 ? '+' : '−'}${Math.abs(d * 1000).toFixed(0)}ms`;
  if (s.kind === 'candidate') return `歌い出し候補に吸着 (${delta})`;
  if (s.kind === 'beat') return `ビートに吸着 (${delta})`;
  return '吸着なし (叩いた時刻のまま)';
}

export function renderLyricsPanel(): HTMLElement {
  syncHistoryWithStore();

  const root = el('section', { className: 'panel lyrics-panel' });
  root.append(
    el('h2', { textContent: 'Lyrics' }),
    el('p', {
      textContent:
        '歌詞を入力するか LRC/SRT を読み込み、曲を再生しながら各行の歌い出しで Space を叩いて時刻を合わせます (再生中の Space = 記録、止まっているときの Space = 再生、Esc = 一時停止)。' +
        '叩いた時刻は、近くの「歌い出し候補」(歌声の帯域が強くなった瞬間) かビートに自動で吸着します。歌詞モーションの見た目は後の段階で追加します。',
    }),
  );

  // ------------------------------------------------------------ 入力
  const inputCard = el('div', { className: 'lyrics-card' });
  const sourceSelect = el('select', { className: 'select' });
  for (const [value, label] of Object.entries(SOURCE_LABELS)) {
    const opt = el('option', { textContent: label });
    opt.value = value;
    sourceSelect.appendChild(opt);
  }
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = '.txt,.lrc,.srt,text/plain';
  const textarea = el('textarea', { className: 'lyrics-textarea' });
  textarea.rows = 10;
  textarea.maxLength = MAX_LYRICS_LENGTH;
  textarea.spellcheck = false;
  textarea.placeholder = '夜明けの色を/覚えてる\nほどけた声が遠くで鳴った\n\n[間奏 8]\n*透明*なままじゃ終われない!';
  const syntax = el('details', { className: 'lyrics-syntax' }, [
    el('summary', { textContent: '歌詞の書き方 (JIZURA と同じ)' }),
    el('ul', {}, [
      el('li', { textContent: '1 行 = 1 行の歌詞。空行で「間」を空ける。# で始まる行はコメント' }),
      el('li', { textContent: '/ で文字のまとまりを区切る、*強調*、行末の ! でキメ、「歌詞|注釈」で注釈' }),
      el('li', { textContent: '[間奏] / [間奏 8] (8 秒) で歌詞の無い区間。[00:12.34] は LRC のタイムタグ' }),
      el('li', { textContent: '行の時刻は行番号で覚えるので、行を足したり消したりすると後ろの行の時刻がずれます' }),
    ]),
  ]);
  inputCard.append(
    el('div', { className: 'row-gap lyrics-row-wrap' }, [el('span', { className: 'param-label', textContent: '形式:' }), sourceSelect, el('span', { className: 'param-label', textContent: 'ファイルから読み込む:' }), fileInput]),
    textarea,
    syntax,
  );
  root.appendChild(inputCard);

  // ------------------------------------------------------------ 再生とプレビュー
  const playCard = el('div', { className: 'lyrics-card' });
  const audioStatus = el('div', { className: 'param-label' });
  const playBtn = button('再生', () => (store.audio.isPlaying ? store.audio.pause() : store.audio.play()));
  const backBtn = button('−3秒', () => store.audio.seek(Math.max(0, store.audio.currentTime - 3)));
  const fwdBtn = button('+3秒', () => store.audio.seek(Math.min(store.audio.duration, store.audio.currentTime + 3)));
  const timeLabel = el('span', { className: 'lyrics-time', textContent: '0:00.00' });
  const nowLine = el('div', { className: 'lyrics-now-line' });
  const nextLine = el('div', { className: 'lyrics-next-line' });
  playCard.append(
    audioStatus,
    el('div', { className: 'row-gap lyrics-row-wrap' }, [playBtn, backBtn, fwdBtn, timeLabel]),
    el('div', { className: 'lyrics-now' }, [nowLine, nextLine]),
  );
  root.appendChild(playCard);

  // ------------------------------------------------------------ タップ同期
  const tapCard = el('div', { className: 'lyrics-card' });
  const startFirstBtn = button('1 行目からタップ', () => startTap(0));
  const startSelBtn = button('選択した行からタップ', () => startTap(selectedLine));
  const stopBtn = button('中断 (Esc)', () => stopTap());
  const tapInfo = el('div', { className: 'lyrics-tap-info' });
  const tapButton = el('button', { className: 'lyrics-tap-button', textContent: 'ここで叩く (Space / Enter)' });
  tapButton.type = 'button';
  // キーボードで押したときの click (detail = 0) は keydown 側で処理済みなので、マウスで押したときだけ叩く
  tapButton.addEventListener('click', (e) => {
    if (e.detail > 0) doTap(e.shiftKey);
  });
  const tapBackBtn = button('1 つ戻る (Backspace)', () => doBack());
  const lastSnap = el('div', { className: 'param-label' });
  const snapCheck = el('input');
  snapCheck.type = 'checkbox';
  snapCheck.addEventListener('change', () => store.updateLyricsTiming({ snap: snapCheck.checked }));
  const windowRange = el('input');
  windowRange.type = 'range';
  windowRange.min = '0';
  windowRange.max = '300';
  windowRange.step = '10';
  const windowLabel = el('span', { className: 'param-label' });
  windowRange.addEventListener('input', () => {
    store.updateLyricsTiming({ snapWindowMs: parseInt(windowRange.value, 10) });
    windowLabel.textContent = `吸着する範囲: ±${windowRange.value}ms`;
  });
  const tapActive = el('div', { className: 'lyrics-tap-active' }, [tapInfo, el('div', { className: 'row-gap lyrics-row-wrap' }, [tapButton, tapBackBtn, stopBtn]), lastSnap]);
  tapCard.append(
    el('h3', { className: 'lyrics-h3', textContent: 'タップ同期' }),
    el('div', { className: 'row-gap lyrics-row-wrap' }, [startFirstBtn, startSelBtn]),
    tapActive,
    el('div', { className: 'row-gap lyrics-row-wrap' }, [
      el('label', { className: 'row-gap param-label' }, [snapCheck, '歌い出し候補・ビートに吸着する (Shift を押しながら叩くと吸着しない)']),
    ]),
    el('label', { className: 'param-row lyrics-window' }, [windowLabel, windowRange]),
  );
  root.appendChild(tapCard);

  // ------------------------------------------------------------ 行の一覧
  const listCard = el('div', { className: 'lyrics-card' });
  const undoBtn = button('取り消し (Ctrl+Z)', () => undo());
  const redoBtn = button('やり直し (Ctrl+Y)', () => redo());
  const resetBtn = button('全行の時刻をリセット', () => {
    if (!window.confirm('手で決めた (タップ・入力した) 開始・終了の時刻をすべて消します。取り消し (Ctrl+Z) で戻せます。')) return;
    commitTiming({ lineTimes: {}, lineEnds: {} });
    refresh();
  });
  const table = el('table', { className: 'lyrics-table' });
  const thead = el('thead', {}, [
    el('tr', {}, ['#', '開始', '由来', '終了', '歌詞', ''].map((h) => el('th', { textContent: h }))),
  ]);
  const tbody = el('tbody');
  table.append(thead, tbody);
  const tableWrap = el('div', { className: 'lyrics-table-wrap' }, [table]);
  const emptyNote = el('div', { className: 'placeholder-card', textContent: '歌詞を入力すると、ここに行の一覧が出ます。' });
  listCard.append(
    el('h3', { className: 'lyrics-h3', textContent: '行の一覧 (行を押すとその位置へ移動・選択。開始の時刻は直接入力もできます)' }),
    el('div', { className: 'row-gap lyrics-row-wrap' }, [undoBtn, redoBtn, resetBtn]),
    emptyNote,
    tableWrap,
  );
  root.appendChild(listCard);

  // ------------------------------------------------------------ 状態
  let view: LyricsView = buildLyricsView(currentLyrics(), store.audio.isLoaded ? store.audio.duration : undefined);
  /** プレビュー用: 未同期の行は開始を +∞ にして「今の行」にならないようにした時刻 */
  let syncedTimes = { starts: [] as number[], ends: [] as number[] };
  let tap: TapSession | null = null;
  let shownLine = -2;
  let shownTime = '';
  let rows: HTMLTableRowElement[] = [];

  const snapTargets = (): SnapTargets => (store.audio.analysis ? syncTargetsFor(store.audio.analysis) : { candidates: [], beats: [] });

  function refresh(): void {
    syncHistoryWithStore();
    const lyrics = currentLyrics();
    view = buildLyricsView(lyrics, store.audio.isLoaded ? store.audio.duration : undefined);
    syncedTimes = {
      starts: view.times.starts.map((s, i) => (view.startSource[i] === 'estimate' ? Infinity : s)),
      ends: view.times.ends,
    };
    if (sourceSelect.value !== lyrics.source) sourceSelect.value = lyrics.source;
    if (document.activeElement !== textarea && textarea.value !== lyrics.text) textarea.value = lyrics.text;
    snapCheck.checked = lyrics.timing.snap;
    windowRange.value = String(lyrics.timing.snapWindowMs);
    windowLabel.textContent = `吸着する範囲: ±${lyrics.timing.snapWindowMs}ms`;
    const lineCount = view.parsed.lines.length;
    if (selectedLine >= lineCount) selectedLine = Math.max(0, lineCount - 1);
    renderRows();
    refreshControls();
    shownLine = -2; // 次のフレームでプレビューを描き直す
  }

  function refreshControls(): void {
    const loaded = store.audio.isLoaded;
    const hasLines = view.parsed.lines.length > 0;
    audioStatus.textContent = loaded
      ? `${store.audio.fileName} — 歌い出し候補 ${snapTargets().candidates.length} 個 / ビート ${snapTargets().beats.length} 個`
      : '音源が読み込まれていません。Music タブで音源を読み込むと、再生とタップ同期ができます。';
    for (const b of [playBtn, backBtn, fwdBtn]) b.disabled = !loaded;
    startFirstBtn.disabled = !loaded || !hasLines || tap != null;
    startSelBtn.disabled = !loaded || !hasLines || tap != null;
    startSelBtn.textContent = `選択した行 (${selectedLine + 1} 行目) からタップ`;
    tapActive.hidden = tap == null;
    tapBackBtn.disabled = !tap?.canBack;
    undoBtn.disabled = !history.canUndo || tap != null;
    redoBtn.disabled = !history.canRedo || tap != null;
    emptyNote.hidden = hasLines;
    tableWrap.hidden = !hasLines;
    if (tap) {
      const i = tap.line;
      const line = view.parsed.lines[i];
      tapInfo.textContent = tap.isActive && line
        ? `次に叩く行: ${i + 1} / ${view.parsed.lines.length} 行目 — ${line.interlude ? '〔間奏〕' : line.text}`
        : 'すべての行を叩きました。';
    }
  }

  function renderRows(): void {
    tbody.textContent = '';
    rows = view.parsed.lines.map((line, i) => {
      const tr = el('tr', { className: 'lyrics-row' });
      tr.dataset.index = String(i);
      const src = view.startSource[i]!;
      const unsynced = src === 'estimate';
      const shownStart = (): string => (unsynced ? '' : formatTime(view.times.starts[i]!));
      if (unsynced) tr.classList.add('unsynced');
      const startInput = el('input', { className: 'lyrics-time-input' });
      startInput.value = shownStart();
      // 未同期の行は、仮の時刻を薄く出すだけにする (入力すると手動の時刻になる)
      if (unsynced) startInput.placeholder = formatTime(view.times.starts[i]!);
      startInput.title = '開始時刻 (例: 1:23.45)。入力すると手動の時刻になります';
      startInput.addEventListener('click', (e) => e.stopPropagation());
      startInput.addEventListener('change', () => {
        const t = parseTimeInput(startInput.value);
        if (t == null) {
          startInput.value = shownStart();
          return;
        }
        const cur = history.current;
        commitTiming({ lineTimes: { ...cur.lineTimes, [String(i)]: t }, lineEnds: cur.lineEnds });
        refresh();
      });
      const clearBtn = button('×', () => {
        const cur = history.current;
        const lineTimes = { ...cur.lineTimes };
        const lineEnds = { ...cur.lineEnds };
        delete lineTimes[String(i)];
        delete lineEnds[String(i)];
        commitTiming({ lineTimes, lineEnds });
        refresh();
      }, 'tab-button lyrics-clear');
      clearBtn.title = 'この行の手動の時刻を消す';
      clearBtn.hidden = src !== 'manual' && !view.endManual[i];
      clearBtn.addEventListener('click', (e) => e.stopPropagation());
      tr.append(
        el('td', { className: 'lyrics-num', textContent: String(i + 1) }),
        el('td', {}, [startInput]),
        el('td', {}, [el('span', { className: `lyrics-src lyrics-src-${src}`, textContent: startSourceLabel(src, currentLyrics().source) })]),
        el('td', { className: 'lyrics-end', textContent: unsynced && !view.endManual[i] ? '—' : formatTime(view.times.ends[i]!) + (view.endManual[i] ? ' (手動)' : '') }),
        el('td', { className: 'lyrics-text', textContent: line.interlude ? `〔間奏${line.secs ? ` ${line.secs}秒` : ''}〕` : line.text }),
        el('td', {}, [clearBtn]),
      );
      tr.addEventListener('click', () => {
        selectedLine = i;
        if (store.audio.isLoaded) store.audio.seek(view.times.starts[i]!);
        highlightRows(shownLine);
        refreshControls();
      });
      tbody.appendChild(tr);
      return tr;
    });
    highlightRows(shownLine);
  }

  function highlightRows(current: number): void {
    rows.forEach((tr, i) => {
      tr.classList.toggle('current', i === current);
      tr.classList.toggle('selected', i === selectedLine);
    });
  }

  // ------------------------------------------------------------ 入力の反映
  let textTimer = 0;
  textarea.addEventListener('input', () => {
    window.clearTimeout(textTimer);
    textTimer = window.setTimeout(() => {
      if (tap) stopTap(); // 行が増減するとタップの位置が合わなくなる
      store.setLyrics({ ...currentLyrics(), text: textarea.value });
      refresh();
    }, 250);
  });
  sourceSelect.addEventListener('change', () => {
    store.setLyrics({ ...currentLyrics(), source: sourceSelect.value as LyricsSource });
    refresh();
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void file.text().then((raw) => {
      const text = raw.slice(0, MAX_LYRICS_LENGTH);
      const source = detectSource(file.name, text);
      const parsed = parseLyricsSource(text, source);
      // 別の歌詞を読み込んだら、前の歌詞の行番号で覚えていた時刻は意味が無いので消す (取り消しで戻せる)。
      // SRT は字幕の終了時刻を行の終了として取り込む
      const lineEnds: Record<string, number> = {};
      parsed.srtEnds?.forEach((e, i) => (lineEnds[String(i)] = e));
      if (tap) stopTap();
      const base = currentLyrics();
      const next: TimingSnapshot = { lineTimes: {}, lineEnds };
      history.push(next);
      store.setLyrics({ ...base, text, source, timing: { ...base.timing, ...next } });
      textarea.value = text;
      fileInput.value = '';
      refresh();
    });
  });

  // ------------------------------------------------------------ タップ
  /** 再生位置はそのままで、line 行目から叩くタップを始める。 */
  function beginTapAt(line: number): TapSession {
    syncHistoryWithStore();
    const session = new TapSession(view.parsed.lines.length, line);
    tap = session;
    lastSnap.textContent = '';
    refreshControls();
    tapButton.focus();
    return session;
  }

  /**
   * 再生中にいきなり叩いたときに記録する行: すでに過ぎた同期済みの行のうち最後のものの次 (イントロなら 1 行目)。
   * プレビューの「次の行」と同じ規則なので、画面に「次: …」と出ている行が記録される。
   */
  function nextLineToTap(t: number): number {
    let last = -1;
    syncedTimes.starts.forEach((s, i) => {
      if (s <= t) last = Math.max(last, i);
    });
    return Math.min(last + 1, view.parsed.lines.length - 1);
  }

  /** ボタンから始めるタップ: その行の少し前から再生し直す。 */
  function startTap(from: number): void {
    if (!store.audio.isLoaded || view.parsed.lines.length === 0) return;
    const session = beginTapAt(from);
    // 再生を始める位置は同期済みの時刻だけから決める (未同期の行の仮の時刻は当てにならない)。
    // 叩く行がまだ未同期なら、その前で最後に同期済みの行の頭から流す (無ければ曲の頭から)
    const line = session.line;
    let startAt = 0;
    if (view.startSource[line] !== 'estimate') {
      startAt = tapStartTime(view.times.starts.map((t, k) => (view.startSource[k] === 'estimate' ? -Infinity : t)), line);
    } else {
      for (let k = line - 1; k >= 0; k--) {
        if (view.startSource[k] !== 'estimate') {
          startAt = view.times.starts[k]!;
          break;
        }
      }
    }
    store.audio.seek(startAt);
    store.audio.play();
  }

  function stopTap(): void {
    tap?.stop();
    tap = null;
    refreshControls();
  }

  function doTap(alt: boolean): void {
    if (!tap || !tap.isActive) return;
    const lyrics = currentLyrics();
    const raw = store.audio.heardTime;
    const snapped = snapTime(raw, snapTargets(), lyrics.timing.snapWindowMs / 1000, lyrics.timing.snap && !alt);
    const cur = history.current;
    const lineTimes = tap.tap(cur.lineTimes, snapped.t);
    commitTiming({ lineTimes, lineEnds: cur.lineEnds });
    const latency = Math.round(store.audio.outputLatency * 1000);
    lastSnap.textContent =
      `${tap.line} 行目: 叩いた位置 ${formatTime(raw)} → ${formatTime(snapped.t)} — ${describeSnap(snapped, raw)}` +
      (latency > 0 ? ` (出力の遅れ 約${latency}ms を差し引き済み)` : '');
    refresh();
    if (!tap.isActive) {
      tap = null;
      lastSnap.textContent += ' / すべての行を叩き終えました';
      refreshControls();
    }
  }

  function doBack(): void {
    if (!tap) return;
    const cur = history.current;
    const lineTimes = tap.back(cur.lineTimes);
    if (!lineTimes) return;
    commitTiming({ lineTimes, lineEnds: cur.lineEnds });
    store.audio.seek(Math.max(0, store.audio.currentTime - 3));
    if (!store.audio.isPlaying) store.audio.play();
    lastSnap.textContent = `${tap.line + 1} 行目から叩き直します`;
    refresh();
  }

  function undo(): void {
    if (tap) return;
    syncHistoryWithStore();
    if (applyHistory(history.undo())) refresh();
  }

  function redo(): void {
    if (tap) return;
    syncHistoryWithStore();
    if (applyHistory(history.redo())) refresh();
  }

  // ------------------------------------------------------------ キーボード
  const onKey = (e: KeyboardEvent): void => {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (isEditable(e.target)) return;
    // Space はどのボタンにフォーカスがあってもタップ/再生に使う (「再生」ボタンを押したあと Space を押すと、
    // ブラウザの標準動作でそのボタンがもう一度押されて一時停止になっていた)。Enter はボタンの上ではボタンを押す
    const isTapKey = !mod && (e.key === ' ' || (e.key === 'Enter' && (!(e.target instanceof HTMLButtonElement) || e.target === tapButton)));
    if (isTapKey) {
      e.preventDefault();
      if (e.repeat || !store.audio.isLoaded) return;
      if (tap) doTap(e.shiftKey);
      else if (store.audio.isPlaying && view.parsed.lines.length > 0) {
        // 再生中に叩いたら、その場でタップを始めて「次に叩く行」の頭として記録する
        beginTapAt(nextLineToTap(store.audio.heardTime));
        doTap(e.shiftKey);
      } else store.audio.play();
      return;
    }
    if (tap) {
      if (e.key === 'Backspace') {
        e.preventDefault();
        doBack();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        stopTap();
        store.audio.pause();
      }
      return;
    }
    if (e.key === 'Escape' && store.audio.isPlaying) {
      e.preventDefault();
      store.audio.pause();
      return;
    }
    const key = e.key.toLowerCase();
    if (mod && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
    }
  };
  document.addEventListener('keydown', onKey);

  // ------------------------------------------------------------ 毎フレームの表示
  const tick = (): void => {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(textTimer);
      tap = null;
      return;
    }
    // 表示も「聞こえている位置」に合わせる (出力の遅れのぶん先に進んで見えないように)
    const t = store.audio.isLoaded ? store.audio.heardTime : 0;
    const label = store.audio.isLoaded ? `${formatTime(t)} / ${formatTime(store.audio.duration)}` : formatTime(t);
    if (label !== shownTime) {
      shownTime = label;
      timeLabel.textContent = label;
    }
    const playing = store.audio.isPlaying;
    const playText = playing ? '一時停止' : '再生';
    if (playBtn.textContent !== playText) playBtn.textContent = playText;

    const cur = lineAt(syncedTimes, t);
    if (cur !== shownLine) {
      shownLine = cur;
      highlightRows(cur);
      const lines = view.parsed.lines;
      const showText = (i: number): string => {
        const l = lines[i];
        return !l ? '' : l.interlude ? '〔間奏〕' : l.text;
      };
      nowLine.textContent = cur >= 0 ? showText(cur) : '';
      // 次の行: 今の行の次。行の外なら、すでに過ぎた同期済みの行のうち最後のものの次の行
      // (イントロなら 1 行目、同期済みの行のあとに未同期の行があればその行 = 次に叩く行)
      let next = cur + 1;
      if (cur < 0) {
        let last = -1;
        syncedTimes.starts.forEach((s, i) => {
          if (s <= t) last = Math.max(last, i);
        });
        next = last + 1;
      }
      if (next >= lines.length) next = -1;
      nextLine.textContent = next >= 0 ? `次: ${showText(next)}` : '';
      // ページ全体ではなく、一覧の枠の中だけをスクロールして今の行を見せる
      const row = cur >= 0 && store.audio.isPlaying ? rows[cur] : undefined;
      if (row) {
        const top = row.offsetTop - tableWrap.clientHeight / 3;
        if (row.offsetTop < tableWrap.scrollTop || row.offsetTop + row.offsetHeight > tableWrap.scrollTop + tableWrap.clientHeight) tableWrap.scrollTop = Math.max(0, top);
      }
    }
    requestAnimationFrame(tick);
  };

  refresh();
  requestAnimationFrame(tick);
  return root;
}
