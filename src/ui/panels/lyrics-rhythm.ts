import { formatTime, History, snapTime } from '../../core/lyrics';
import { tr } from '../../core/i18n';
import {
  barIndexAt,
  barLengthEstimate,
  barSnapTargetsFor,
  BarTapSession,
  buildRhythmGrid,
  clickTrackSamples,
  describeGrouping,
  fillGaps,
  fillToEnd,
  fillToStart,
  moveBarHead,
  normalizeBars,
  removeMeter,
  rhythmPositionAt,
  setMeter,
  type RhythmGrid,
} from '../../core/rhythm';
import { store } from '../../core/store';
import { defaultRhythm, type RhythmSettings } from '../../core/types';

/**
 * Lyrics タブの「リズム（変拍子）」欄 (R2)。docs/ARCHITECTURE.md「変拍子（リズム）の方針」。
 * - 変拍子モードのオン/オフ (store.rhythm.enabled。オンなら歌詞モーションはこの拍に合わせる: jizura-adapter の motionRhythmGrid)
 * - 再生しながら Space で小節の頭を叩く (BarTapSession)。叩いた時刻は聞こえている位置で、音の立ち上がり → ビートへ吸着する
 *   (Shift を押しながらだと吸着しない)。Backspace で 1 つ戻る (3 秒戻して再生)、Esc で終わる
 * - 「残りを同じ長さで埋める」(fillToEnd)、「間を埋める」(fillGaps)
 * - 区間ごとの拍子 (「5 小節目から 2+2+3」)
 *
 * 小節のタップ中は、Lyrics パネルのキー操作より先に handleKey で受ける (歌詞のタップと Space を取り合わないように)。
 * 取り消しの履歴は歌詞の時刻とは別に持つ (この欄の「取り消し」ボタン。Ctrl+Z は歌詞の時刻の取り消しのまま)。
 * 履歴はタブをまたいで残すのでモジュール単位。タップはタブを離れるとそこで終わる。
 */

export interface RhythmEditorCallbacks {
  /** 歌詞のタップ中など、小節のタップを始められないとき true */
  isBusy(): boolean;
  /** 小節・拍子が変わったとき (タイムラインの描き直しなど) */
  onChange(): void;
}

export interface RhythmEditor {
  element: HTMLElement;
  readonly isTapping: boolean;
  /** 小節のタップ中のキー操作。処理したら true */
  handleKey(e: KeyboardEvent): boolean;
  /** store の内容を表示に反映する */
  refresh(): void;
  /** 毎フレーム呼ぶ (今の小節・まとまりの表示)。t = 聞こえている位置 */
  tick(t: number): void;
  /** 今の小節の頭と拍子から作った拍の並び (小節の頭が 2 つ未満なら null)。store.rhythm ごとにキャッシュする */
  grid(): RhythmGrid | null;
  /** 小節の頭 (昇順)。タイムラインの小節線のドラッグの番号はこの並びの番号 */
  barHeads(): number[];
  /** タイムラインで小節線を動かしたとき (取り消しの履歴に積む) */
  moveBar(index: number, t: number): void;
  /** 小節の頭の吸着 (タップと同じ: 音の立ち上がり → ビート、±80ms)。noSnap ならそのまま */
  snapBar(t: number, noSnap: boolean): number;
  dispose(): void;
}

/** 小節の頭の吸着で探す範囲 (秒)。立ち上がりは打楽器ごとにたくさん出るので、歌詞より狭くする */
const BAR_SNAP_WINDOW = 0.08;
/** 「再生位置から叩く」で、何秒前から流すか */
const TAP_PREROLL = 2;
/** よく使う拍子 (入力欄の候補) */
const COMMON_PATTERNS = ['4', '3', '5', '3+2', '2+3', '6', '3+3', '7', '2+2+3', '3+2+2', '2+3+2', '3+3+2', '9', '2+2+2+3'];

const history = new History<RhythmSettings | null>(null);
/** 「クリック音で確認」がオンか (タブをまたいで残す。ほかのタブではクリック音を鳴らさない) */
let clickOn = false;
/** クリック音の音源のキャッシュ (小節・拍子と曲が同じ間は作り直さない) */
let clickCache: { grid: RhythmGrid; duration: number; buffer: AudioBuffer } | null = null;
/** クリック音の音源のサンプリング周波数 (短い「チッ」なので低くてよい。3 分で約 16MB) */
const CLICK_SAMPLE_RATE = 22050;
let datalistSeq = 0;

function syncHistoryWithStore(): void {
  if (store.rhythm !== history.current) history.reset(store.rhythm);
}

let gridCache: { rhythm: RhythmSettings; grid: RhythmGrid | null } | null = null;
function gridFor(rhythm: RhythmSettings | null): RhythmGrid | null {
  if (!rhythm) return null;
  if (gridCache?.rhythm !== rhythm) {
    const g = buildRhythmGrid(rhythm);
    gridCache = { rhythm, grid: g.bars.length > 0 ? g : null };
  }
  return gridCache.grid;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function btn(label: string, onClick: () => void, className = 'tab-button'): HTMLButtonElement {
  const b = h('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function row(...children: (Node | string)[]): HTMLDivElement {
  const d = h('div', 'row-gap lyrics-row-wrap');
  d.append(...children);
  return d;
}

export function createRhythmEditor(cb: RhythmEditorCallbacks): RhythmEditor {
  syncHistoryWithStore();
  const root = h('div', 'lyrics-card lyrics-rhythm');
  let session: BarTapSession | null = null;

  const current = (): RhythmSettings => store.rhythm ?? defaultRhythm();

  function commit(next: RhythmSettings): void {
    syncHistoryWithStore();
    history.push(next);
    store.setRhythm(next);
    refresh();
    cb.onChange();
  }

  // ------------------------------------------------------------ オン/オフ
  const enabled = h('input');
  enabled.type = 'checkbox';
  enabled.addEventListener('change', () => commit({ ...current(), enabled: enabled.checked }));
  const enabledLabel = h('label', 'row-gap param-label');
  enabledLabel.append(
    enabled,
    tr(
      '変拍子モード (オンにすると、歌詞の動きは自動で見つけた拍の代わりに、ここで決めた小節と拍子に合わせて動きます。歌詞の動きのスタイルを「変拍子 (ZUNZUN)」にすると、小節の頭とまとまりに合わせた演出も加わります)',
      'Odd-meter mode (when on, lyric motion follows the bars and meters set here instead of the auto-detected beats. With the "変拍子 (ZUNZUN)" style, effects on bar heads and groups are added too)',
    ),
  );

  // ------------------------------------------------------------ 小節の頭のタップ
  const status = h('div', 'param-label');
  const tapFirstBtn = btn(tr('最初から叩く', 'Tap from the start'), () => startTap('first'), 'lyrics-big-button');
  const tapHereBtn = btn(tr('今の位置から叩く', 'Tap from here'), () => startTap('here'), 'lyrics-big-button');
  const tapBtn = h('button', 'lyrics-tap-button', tr('小節の頭 (Space / Enter)', 'Bar head (Space / Enter)'));
  tapBtn.type = 'button';
  // キーボードで押したときの click (detail = 0) は keydown 側で処理済み
  tapBtn.addEventListener('click', (e) => {
    if (e.detail > 0) doTap(e.shiftKey);
  });
  const backBtn = btn(tr('1 つ戻る (Backspace)', 'Undo one (Backspace)'), () => doBack());
  const stopBtn = btn(tr('終わる (Esc)', 'Finish (Esc)'), () => stopTap(true));
  const tapReport = h('div', 'param-label');
  const tapActive = h('div', 'lyrics-tap-active');
  tapActive.append(row(tapBtn, backBtn, stopBtn), tapReport);

  // ------------------------------------------------------------ 埋める・消す・取り消し
  const fillStartBtn = btn(tr('前を同じ長さで埋める', 'Fill to the start'), () => doFill('start'));
  fillStartBtn.title = tr('最初の数小節の長さで、曲の頭まで小節の頭を足します (頭に残る端数には小節を作りません)', 'Adds bar heads back to the start of the song using the first bars\' length (no partial bar at the very start)');
  const fillEndBtn = btn(tr('残りを同じ長さで埋める', 'Fill to the end'), () => doFill('end'));
  fillEndBtn.title = tr('最後の数小節の長さで、曲の終わりまで小節の頭を足します', 'Adds bar heads to the end of the song using the last bars\' length');
  const fillGapsBtn = btn(tr('間を埋める', 'Fill gaps'), () => doFill('gaps'));
  fillGapsBtn.title = tr('数小節おきに叩いたとき、間が小節の長さのほぼ整数倍なら等分して埋めます', 'If you tapped every few bars, gaps that are about a whole number of bars are split evenly');
  const clearBtn = btn(tr('小節をすべて消す', 'Clear all bars'), () => {
    if (!window.confirm(tr('小節の頭をすべて消します (この欄の「取り消し」で戻せます)。', 'Clear all bar heads? (You can undo it in this section.)'))) return;
    commit({ ...current(), bars: [] });
    editReport.textContent = tr('小節の頭をすべて消しました。', 'Cleared all bar heads.');
  });
  // 履歴の値は null (リズムを使っていない状態) もありうるので、戻せるかどうかは canUndo / canRedo で見る
  const undoBtn = btn(tr('取り消し', 'Undo'), () => {
    syncHistoryWithStore();
    if (history.canUndo) applyState(history.undo());
  });
  const redoBtn = btn(tr('やり直し', 'Redo'), () => {
    syncHistoryWithStore();
    if (history.canRedo) applyState(history.redo());
  });
  const editReport = h('div', 'param-label');

  // ------------------------------------------------------------ クリック音で確認
  const clickBox = h('input');
  clickBox.type = 'checkbox';
  const clickLabel = h('label', 'row-gap param-label');
  clickLabel.append(clickBox, tr('クリック音で確かめる (小節の頭 = 高い音、まとまりの頭 = 低い音。「歌詞」タブで再生している間だけ鳴ります)', 'Check with a click (bar head = high, group head = low. Only while playing in the Lyrics tab)'));
  clickBox.addEventListener('change', () => {
    clickOn = clickBox.checked;
    applyClick();
  });
  let clickTimer = 0;
  /** 小節を叩くたびに作り直さないよう、少し待ってから反映する */
  function scheduleClick(): void {
    window.clearTimeout(clickTimer);
    clickTimer = window.setTimeout(applyClick, 250);
  }
  function applyClick(): void {
    window.clearTimeout(clickTimer);
    const grid = gridFor(store.rhythm);
    if (!clickOn || !grid || !store.audio.isLoaded) {
      store.audio.setOverlay(null);
      return;
    }
    const duration = store.audio.duration;
    if (clickCache?.grid !== grid || clickCache.duration !== duration) {
      const samples = clickTrackSamples(grid, duration, CLICK_SAMPLE_RATE);
      const buffer = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate: CLICK_SAMPLE_RATE });
      buffer.copyToChannel(samples, 0);
      clickCache = { grid, duration, buffer };
    }
    store.audio.setOverlay(clickCache.buffer);
  }

  // ------------------------------------------------------------ 拍子の区間
  const datalist = h('datalist');
  datalist.id = `zz-meter-patterns-${++datalistSeq}`;
  for (const p of COMMON_PATTERNS) {
    const o = h('option');
    o.value = p;
    datalist.appendChild(o);
  }
  const meterList = h('div', 'lyrics-meter-list');
  const addBar = h('input', 'lyrics-offset-input');
  addBar.type = 'number';
  addBar.min = '1';
  addBar.step = '1';
  addBar.value = '1';
  const addPattern = patternInput('2+2+3');
  const addBtn = btn(tr('この小節から', 'From this bar'), () => {
    const bar = parseInt(addBar.value, 10) - 1;
    const next = setMeter(current().meters, bar, addPattern.value);
    if (!next) {
      meterReport.textContent = tr('拍子を読めませんでした (例: 4、5、2+2+3)。まとまりは 1〜16、合計 32 まで。', 'Could not read the meter (e.g. 4, 5, 2+2+3). Groups 1–16, total up to 32.');
      return;
    }
    meterReport.textContent = tr(`${bar + 1} 小節目から ${addPattern.value} にしました。`, `Set ${addPattern.value} from bar ${bar + 1}.`);
    commit({ ...current(), meters: next });
  });
  const hereBtn = btn(tr('今の位置の小節', 'Bar at playhead'), () => {
    const i = barIndexAt(current().bars, store.audio.heardTime);
    addBar.value = String(Math.max(0, i) + 1);
  });
  hereBtn.title = tr('今の再生位置を含む小節の番号を入れます', 'Fill in the bar number at the current playback position');
  const meterReport = h('div', 'param-label');

  // ------------------------------------------------------------ 今の位置
  const posText = h('span', 'param-label lyrics-rhythm-pos');
  const posBoxes = h('div', 'lyrics-rhythm-boxes');

  const help = h(
    'p',
    'lyrics-help',
    tr(
      '自動で見つける拍は一定のテンポしか表せないので、5 拍子・7 拍子・途中で拍子が変わる曲は、小節の頭を叩いて決めます。再生しながら小節の頭 (1 拍目) で Space を叩きます (Shift を押しながらだと吸着しません)。数小節叩いたら「残りを同じ長さで埋める」、数小節おきに叩いたら「間を埋める」が使えます。ずれた小節は、タイムラインの橙の線を波形の段でつかんで左右に動かせます。拍子は「2+2+3」(7 等分を 2・2・3 にまとめる) や「4」(4 等分) のように、小節の番号から区間ごとに書きます。',
      'Auto-detected beats can only express a steady tempo, so for 5/4, 7/8 or songs that change meter you tap the bar heads. While playing, press Space on each bar head (beat 1) (hold Shift to disable snapping). After a few bars use "Fill to the end"; if you tapped every few bars use "Fill gaps". Drag the orange lines in the waveform row of the timeline to fix bars. Write meters per section from a bar number, e.g. "2+2+3" (7 pulses grouped 2, 2, 3) or "4" (4 pulses).',
    ),
  );
  root.append(
    h('h3', 'lyrics-h3', tr('リズム (変拍子)', 'Rhythm (odd meters)')),
    help,
    enabledLabel,
    status,
    row(tapFirstBtn, tapHereBtn),
    tapActive,
    row(fillStartBtn, fillEndBtn, fillGapsBtn, clearBtn, undoBtn, redoBtn),
    clickLabel,
    editReport,
    h('h3', 'lyrics-h3', tr('拍子 (区間ごと)', 'Meters (per section)')),
    meterList,
    row(addBar, h('span', 'param-label', tr('小節目から', '(bar number)')), addPattern, addBtn, hereBtn),
    meterReport,
    row(h('span', 'param-label', tr('今の位置:', 'Now:')), posText),
    posBoxes,
    datalist,
  );

  function patternInput(value: string): HTMLInputElement {
    const i = h('input', 'lyrics-offset-input lyrics-meter-input');
    i.value = value;
    i.setAttribute('list', datalist.id);
    i.spellcheck = false;
    i.placeholder = '2+2+3';
    return i;
  }

  // ------------------------------------------------------------ 表示
  function refresh(): void {
    syncHistoryWithStore();
    const r = current();
    const loaded = store.audio.isLoaded;
    const bars = normalizeBars(r.bars);
    const len = barLengthEstimate(bars);
    enabled.checked = store.rhythm?.enabled ?? false;
    status.textContent =
      bars.length === 0
        ? tr('小節の頭はまだありません。', 'No bar heads yet.')
        : tr(`小節の頭 ${bars.length} 個 (${formatTime(bars[0]!)} 〜 ${formatTime(bars[bars.length - 1]!)})`, `${bars.length} bar heads (${formatTime(bars[0]!)} – ${formatTime(bars[bars.length - 1]!)})`) +
          (len ? tr(` / 1 小節 およそ ${len.toFixed(2)} 秒`, ` / one bar ≈ ${len.toFixed(2)} s`) : '');
    const busy = cb.isBusy();
    tapFirstBtn.disabled = !loaded || session != null || busy;
    tapHereBtn.disabled = !loaded || session != null || busy;
    tapActive.hidden = session == null;
    backBtn.disabled = !session?.canBack;
    fillEndBtn.disabled = !loaded || session != null || bars.length < 2;
    fillStartBtn.disabled = session != null || bars.length < 2;
    clickBox.checked = clickOn;
    clickBox.disabled = !loaded;
    scheduleClick();
    fillGapsBtn.disabled = session != null || bars.length < 3;
    clearBtn.disabled = session != null || bars.length === 0;
    undoBtn.disabled = session != null || !history.canUndo;
    redoBtn.disabled = session != null || !history.canRedo;
    renderMeters(r);
    shownPos = '';
  }

  function renderMeters(r: RhythmSettings): void {
    meterList.textContent = '';
    for (const m of r.meters) {
      const input = patternInput(m.pattern);
      input.addEventListener('change', () => {
        const next = setMeter(current().meters, m.bar, input.value);
        if (!next) {
          input.value = m.pattern;
          meterReport.textContent = tr('拍子を読めませんでした (例: 4、5、2+2+3)。', 'Could not read the meter (e.g. 4, 5, 2+2+3).');
          return;
        }
        meterReport.textContent = '';
        commit({ ...current(), meters: next });
      });
      const del = btn('×', () => commit({ ...current(), meters: removeMeter(current().meters, m.bar) }), 'tab-button lyrics-clear');
      del.title = tr('この区間の指定を消す (前の区間の拍子が続きます)', 'Remove this section (the previous meter continues)');
      del.hidden = m.bar === 0;
      meterList.append(
        row(h('span', 'param-label lyrics-meter-bar', tr(`${m.bar + 1} 小節目から`, `From bar ${m.bar + 1}`)), input, h('span', 'param-label', describeGrouping(m.pattern) ?? ''), del),
      );
    }
  }

  let shownPos = '';
  function tick(t: number): void {
    const grid = gridFor(store.rhythm);
    const pos = grid ? rhythmPositionAt(grid, t) : null;
    const key = pos ? `${pos.pulse.bar}:${pos.pulse.group}` : grid ? 'out' : 'none';
    if (key === shownPos) return;
    shownPos = key;
    posBoxes.textContent = '';
    if (!pos || !grid) {
      posText.textContent = grid ? tr('小節の外', 'Outside the bars') : '—';
      return;
    }
    const bar = grid.bars[pos.pulse.bar]!;
    posText.textContent = tr(`${pos.pulse.bar + 1} 小節目 · ${bar.groups.join('+')} の ${pos.pulse.group + 1} 番目のまとまり`, `Bar ${pos.pulse.bar + 1} · group ${pos.pulse.group + 1} of ${bar.groups.join('+')}`);
    bar.groups.forEach((g, i) => {
      const box = h('span', 'lyrics-rhythm-box', String(g));
      box.style.flexGrow = String(g);
      box.classList.toggle('active', i === pos.pulse.group);
      box.classList.toggle('head', i === 0);
      posBoxes.appendChild(box);
    });
  }

  // ------------------------------------------------------------ 操作
  function startTap(from: 'first' | 'here'): void {
    if (!store.audio.isLoaded || session || cb.isBusy()) return;
    const start = from === 'first' ? 0 : store.audio.heardTime;
    session = new BarTapSession(current().bars, start);
    const removed = normalizeBars(current().bars).length - session.bars.length;
    tapReport.textContent =
      tr(
        (from === 'first' ? '曲の頭から' : `${formatTime(start)} から`) + '小節の頭を叩いてください。',
        'Tap the bar heads ' + (from === 'first' ? 'from the start of the song.' : `from ${formatTime(start)}.`),
      ) +
      (removed > 0 ? tr(` (これより後ろの小節の頭 ${removed} 個は、叩き直すので消えます)`, ` (${removed} later bar heads are removed because you are re-tapping)`) : '');
    if (removed > 0) commit({ ...current(), bars: session.bars });
    store.audio.seek(from === 'first' ? 0 : Math.max(0, start - TAP_PREROLL));
    store.audio.play();
    refresh();
    tapBtn.focus();
  }

  function stopTap(pause: boolean): void {
    if (!session) return;
    const n = session.tapCount;
    session = null;
    if (pause) store.audio.pause();
    tapReport.textContent = '';
    editReport.textContent = n > 0 ? tr(`小節の頭を ${n} 個叩きました。`, `Tapped ${n} bar heads.`) : '';
    refresh();
    cb.onChange();
  }

  function doTap(noSnap: boolean): void {
    if (!session) return;
    const raw = store.audio.heardTime;
    const analysis = store.audio.analysis;
    const snapped = analysis ? snapTime(raw, barSnapTargetsFor(analysis), BAR_SNAP_WINDOW, !noSnap) : { t: raw, kind: 'none' as const };
    const before = session.tapCount;
    const bars = session.tap(snapped.t);
    if (session.tapCount === before) return; // 連打は無視
    const how =
      snapped.kind === 'candidate' ? tr(`音の立ち上がりに吸着 ${sign(snapped.t - raw)}`, `snapped to an onset ${sign(snapped.t - raw)}`) : snapped.kind === 'beat' ? tr(`拍に吸着 ${sign(snapped.t - raw)}`, `snapped to a beat ${sign(snapped.t - raw)}`) : tr('吸着なし', 'no snapping');
    tapReport.textContent = tr(`${barIndexAt(bars, snapped.t) + 1} 小節目の頭を ${formatTime(snapped.t)} で記録 (${how})`, `Bar ${barIndexAt(bars, snapped.t) + 1} head at ${formatTime(snapped.t)} (${how})`);
    commit({ ...current(), bars });
  }

  function snapBar(t: number, noSnap: boolean): number {
    const analysis = store.audio.analysis;
    return analysis ? snapTime(t, barSnapTargetsFor(analysis), BAR_SNAP_WINDOW, !noSnap).t : t;
  }

  function moveBar(index: number, t: number): void {
    if (session) return;
    const r = current();
    const before = normalizeBars(r.bars);
    const bars = moveBarHead(before, index, t);
    if (bars[index] === before[index]) return;
    editReport.textContent = tr(`${index + 1} 小節目の頭を ${formatTime(bars[index]!)} に動かしました (取り消しで戻せます)。`, `Moved bar ${index + 1} head to ${formatTime(bars[index]!)} (undo to revert).`);
    commit({ ...r, bars });
  }

  function doBack(): void {
    if (!session) return;
    const bars = session.back();
    if (!bars) return;
    commit({ ...current(), bars });
    store.audio.seek(Math.max(0, store.audio.currentTime - 3));
    if (!store.audio.isPlaying) store.audio.play();
    tapReport.textContent = tr('1 つ戻しました。3 秒前から流します。', 'Removed one. Playing from 3 seconds earlier.');
  }

  function doFill(kind: 'start' | 'end' | 'gaps'): void {
    const r = current();
    const before = normalizeBars(r.bars);
    if (kind === 'start') {
      const f = fillToStart(before, r.meters);
      if (f.added <= 0) {
        editReport.textContent = tr('足せる小節がありませんでした (小節の頭が 2 つ以上必要です。曲の頭までが 1 小節より短いときは足しません)。', 'No bars could be added (needs at least 2 bar heads; nothing is added if less than one bar remains before them).');
        return;
      }
      editReport.textContent = tr(`曲の頭の側に小節を ${f.added} 個足しました (拍子の区間の番号も ${f.added} ずらしました。取り消しで戻せます)。`, `Added ${f.added} bars before (meter sections shifted by ${f.added}; undo to revert).`);
      commit({ ...r, bars: f.bars, meters: f.meters });
      return;
    }
    const bars = kind === 'end' ? fillToEnd(before, store.audio.duration) : fillGaps(before);
    const added = bars.length - before.length;
    if (added <= 0) {
      editReport.textContent =
        kind === 'end'
          ? tr('足せる小節がありませんでした (小節の頭が 2 つ以上必要です)。', 'No bars could be added (needs at least 2 bar heads).')
          : tr('埋められる間がありませんでした (間が小節の長さの 2 倍以上・ほぼ整数倍のところだけ埋めます)。', 'No gaps to fill (only gaps of about 2+ whole bars are filled).');
      return;
    }
    editReport.textContent = tr(`小節の頭を ${added} 個足しました (取り消しで戻せます)。`, `Added ${added} bar heads (undo to revert).`);
    commit({ ...r, bars });
  }

  function applyState(state: RhythmSettings | null): void {
    if (session) return;
    store.setRhythm(state);
    editReport.textContent = '';
    refresh();
    cb.onChange();
  }

  function handleKey(e: KeyboardEvent): boolean {
    if (!session) return false;
    const isTapKey = !e.ctrlKey && !e.metaKey && (e.key === ' ' || e.key === 'Enter');
    if (isTapKey) {
      e.preventDefault();
      if (!e.repeat) doTap(e.shiftKey);
      return true;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      doBack();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      stopTap(true);
      return true;
    }
    return false;
  }

  refresh();
  return {
    element: root,
    get isTapping() {
      return session != null;
    },
    handleKey,
    refresh,
    tick,
    grid: () => gridFor(store.rhythm),
    barHeads: () => normalizeBars(store.rhythm?.bars ?? []),
    moveBar,
    snapBar,
    dispose: () => {
      session = null;
      window.clearTimeout(clickTimer);
      // ほかのタブではクリック音を鳴らさない (オンのままなら、Lyrics タブに戻ったときにまた鳴らす)
      store.audio.setOverlay(null);
    },
  };
}

const sign = (sec: number): string => `${sec >= 0 ? '+' : '−'}${Math.abs(sec * 1000).toFixed(0)}ms`;
