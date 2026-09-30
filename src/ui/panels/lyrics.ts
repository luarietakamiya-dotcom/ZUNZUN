import { computePeaks, type Peaks } from '../../core/audio/peaks';
import { tr } from '../../core/i18n';
import {
  buildLyricsView,
  estimateOffset,
  moveLine,
  moveLineEnd,
  moveLineStart,
  shiftLines,
  snapTime,
  type EditContext,
  formatTime,
  History,
  lineAt,
  parseLyricsSource,
  parseTimeInput,
  snapAllLines,
  tapStartTime,
  TapSession,
  type LyricsView,
  type SnapAllResult,
  type SyncTargets,
} from '../../core/lyrics';
import { customFromStyle, jizuraStyles, loadJizura, type JizuraApi } from '../../core/lyrics/jizura-adapter';
import { previewMotionProvider } from '../../core/lyrics/motion-provider';
import { MAX_LYRICS_LENGTH } from '../../core/project/validate';
import { store } from '../../core/store';
import { CUSTOM_STYLE_KEY, defaultLyrics, type LyricsMotion, type LyricsSettings, type LyricsSource, type LyricsTiming } from '../../core/types';
import { lyricSyncTargets } from '../../core/lyrics/stem';
import { createRhythmEditor } from './lyrics-rhythm';
import { activeStem, createStemCard } from './lyrics-stem';
import { createStyleEditor } from './lyrics-style-editor';
import { LyricsTimeline } from './lyrics-timeline';
import { backgroundPaletteNow } from '../../core/render/palette';

/**
 * Lyrics タブ (L3): 歌詞の入力・読み込み、再生しながらの半自動タップ同期、行ごとの時刻の確認と手入力。
 * 歌詞モーション (JIZURA) はまだ無いので、プレビューは「今の行」を文字で大きく出すだけ。
 * 操作は docs/ARCHITECTURE.md「歌詞同期の方針」のとおり:
 * - タップ: 再生中に Space/Enter を押すと、その場でタップが始まり「次の行」の頭として記録する (ボタンから始めてもよい)。
 *   止まっているときの Space は再生、Esc はタップをやめて一時停止。Backspace で 1 つ戻る
 * - 叩いた時刻は「いまスピーカーから聞こえている位置」(出力の遅れを差し引いた位置) で、吸着させずにそのまま記録する
 * - 叩き終えたら「吸着」ボタンで、手で決めた行をまとめて歌い出し候補 → ビートへ吸着させる (core/lyrics/snap-all.ts)。
 *   叩くタイミングのくせを見積もって補正するので、1 行ずつ吸着するより精密。「吸着前に戻す」で 1 回で戻せる
 *   (最初は叩くたびに吸着していたが、ユーザーの希望で「最後にまとめて」に変えた)
 * - Ctrl/Cmd+Z で取り消し、Ctrl/Cmd+Y (または Shift+Z) でやり直し
 *
 * タブを切り替えるとパネルは丸ごと作り直される (unmount フックなし) ので、取り消しの履歴と選択中の行は
 * モジュール単位で持つ。タップ中にタブを離れた場合、タップはそこで終わる (叩いた時刻は残る)。
 */

type TimingSnapshot = Pick<LyricsTiming, 'lineTimes' | 'lineEnds'>;

const EMPTY_TIMING: TimingSnapshot = { lineTimes: {}, lineEnds: {} };
const history = new History<TimingSnapshot>(EMPTY_TIMING);
let selectedLine = 0;
/**
 * 'tap' = タップで合わせる (再生中の Space で記録、プレビューは次の行がいちばん大きい)。
 * 'check' = 確認する (Space は再生/一時停止だけ、プレビューは今の行がいちばん大きい、行を押すと 1 秒前から再生)。
 * タブを切り替えても残す。
 */
let mode: 'tap' | 'check' = 'tap';
/** 確認モードで行を押したとき、その行の何秒前から再生するか */
const CHECK_PREROLL = 1.0;
/** 選んだ行のループ試聴 (タブをまたいで残す) */
let loopOn = false;
/** ループ試聴で、行の何秒前から流すか */
const LOOP_PREROLL = 0.5;

const peaksCache = new WeakMap<AudioBuffer, Peaks>();
/** 波形の表示用データ (音源ごとに 1 度だけ作る) */
function peaksFor(buffer: AudioBuffer): Peaks {
  let p = peaksCache.get(buffer);
  if (!p) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    p = computePeaks(channels, buffer.sampleRate, 200);
    peaksCache.set(buffer, p);
  }
  return p;
}

const SOURCE_LABELS = (): Record<LyricsSource, string> => ({
  text: tr('テキスト (JIZURA の書き方)', 'Text (JIZURA notation)'),
  lrc: 'LRC',
  srt: 'SRT',
});

/**
 * 時刻の由来の表示。'estimate' (タップも LRC の時刻も無い行) は、JIZURA の規則で文字数から仮の時刻が付いているだけなので
 * 「未同期」と出し、プレビューにも出さない (1 行目が 0.4 秒から始まるため、イントロで歌詞が出て吸着したように見えていた)。
 * 仮の時刻は歌詞モーション (L5) では使うので、内部では持っておく。
 */
const START_SOURCE_LABELS = (): Record<'manual' | 'lrc' | 'estimate', string> => ({ manual: tr('手動', 'Manual'), lrc: 'LRC', estimate: tr('未同期', 'Not synced') });

/** 由来の表示。タグから来た時刻は、SRT を読み込んだときは SRT と出す */
function startSourceLabel(src: 'manual' | 'lrc' | 'estimate', source: LyricsSource): string {
  return src === 'lrc' && source === 'srt' ? 'SRT' : START_SOURCE_LABELS()[src];
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

/** 直前の「吸着」の結果。「吸着前に戻す」と、一覧の由来の表示に使う (タブをまたいで残す) */
let lastSnapAll: { result: SnapAllResult; after: TimingSnapshot } | null = null;

const ms = (sec: number): string => `${sec >= 0 ? '+' : '−'}${Math.abs(sec * 1000).toFixed(0)}ms`;

function describeSnapAll(r: SnapAllResult): string {
  const count = (k: string): number => r.lines.filter((l) => l.kind === k).length;
  const habit =
    Math.abs(r.bias) < 0.005
      ? tr('叩くタイミングのくせ: ほぼ無し', 'Tapping habit: almost none')
      : tr(`叩くタイミングのくせ: 平均 ${Math.abs(r.bias * 1000).toFixed(0)}ms ${r.bias < 0 ? '遅め' : '早め'} → 補正`, `Tapping habit: ${Math.abs(r.bias * 1000).toFixed(0)}ms ${r.bias < 0 ? 'late' : 'early'} on average → corrected`);
  return tr(
    `${r.lines.length} 行を吸着しました (歌い出しの候補 ${count('candidate')} / 拍 ${count('beat')} / 近くに無くそのまま ${count('none')})。${habit}`,
    `Snapped ${r.lines.length} lines (vocal entries ${count('candidate')} / beats ${count('beat')} / nothing near, kept ${count('none')}). ${habit}`,
  );
}

export function renderLyricsPanel(): HTMLElement {
  syncHistoryWithStore();

  const root = el('section', { className: 'panel lyrics-panel' });
  root.append(
    el('h2', { textContent: tr('歌詞', 'Lyrics') }),
    el('p', {
      textContent:
        tr(
          '歌詞を入力するか LRC / SRT を読み込み、曲を再生しながら各行の歌い出しで Space を叩いて時刻を合わせます (再生中の Space = 記録、止まっているときの Space = 再生、Esc = 一時停止)。叩き終えたら「吸着」ボタンで、近くの「歌い出しの候補」(歌声が強くなった瞬間) か拍にまとめて寄せます。',
          'Type the lyrics or load LRC / SRT, then play the song and press Space at the start of each line (Space while playing = record, Space while stopped = play, Esc = pause). When done, "Snap" moves them to the nearest vocal entry (where the voice gets louder) or beat.',
        ),
    }),
  );

  // ------------------------------------------------------------ 入力
  const inputCard = el('div', { className: 'lyrics-card' });
  const sourceSelect = el('select', { className: 'select' });
  for (const [value, label] of Object.entries(SOURCE_LABELS())) {
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
  textarea.placeholder = tr('夜明けの色を/覚えてる\nほどけた声が遠くで鳴った\n\n[間奏 8]\n*透明*なままじゃ終われない!', 'I still remember/the color of dawn\na loosened voice rang far away\n\n[間奏 8]\nI *can\'t* end it transparent!');
  const syntax = el('details', { className: 'lyrics-syntax' }, [
    el('summary', { textContent: tr('歌詞の書き方 (JIZURA と同じ)', 'How to write lyrics (same as JIZURA)') }),
    el('ul', {}, [
      el('li', { textContent: tr('1 行 = 1 行の歌詞。空行で「間」を空ける。# で始まる行はコメント', 'One line = one lyric line. A blank line makes a pause. Lines starting with # are comments') }),
      el('li', { textContent: tr('/ で文字のまとまりを区切る、*強調*、行末の ! でキメ、「歌詞|注釈」で注釈', '/ splits phrases, *emphasis*, a trailing ! makes a hit, "lyric|note" adds a note') }),
      el('li', { textContent: tr('[間奏] / [間奏 8] (8 秒) で歌詞の無い区間。[00:12.34] は LRC のタイムタグ', '[間奏] / [間奏 8] (8 s) marks an instrumental part. [00:12.34] is an LRC time tag') }),
      el('li', { textContent: tr('行の時刻は行番号で覚えるので、行を足したり消したりすると後ろの行の時刻がずれます', 'Times are stored by line number, so adding or removing lines shifts the times of later lines') }),
    ]),
  ]);
  inputCard.append(
    el('div', { className: 'row-gap lyrics-row-wrap' }, [el('span', { className: 'param-label', textContent: tr('形式:', 'Format:') }), sourceSelect, el('span', { className: 'param-label', textContent: tr('ファイルから読み込む:', 'Load from file:') }), fileInput]),
    textarea,
    syntax,
  );
  root.appendChild(inputCard);

  // ------------------------------------------------------------ 再生とプレビュー
  const playCard = el('div', { className: 'lyrics-card' });
  const audioStatus = el('div', { className: 'param-label' });
  const playBtn = button(tr('再生', 'Play'), () => (store.audio.isPlaying ? store.audio.pause() : store.audio.play()));
  const backBtn = button(tr('−3秒', '−3s'), () => store.audio.seek(Math.max(0, store.audio.currentTime - 3)));
  const fwdBtn = button(tr('+3秒', '+3s'), () => store.audio.seek(Math.min(store.audio.duration, store.audio.currentTime + 3)));
  const timeLabel = el('span', { className: 'lyrics-time', textContent: '0:00.00' });
  // 前の行・今の行・次の行。タップのときは次の行 (これから叩く行)、確認のときは今の行をいちばん大きく
  const prevLine = el('div', { className: 'lyrics-prev-line' });
  const nowLine = el('div', { className: 'lyrics-now-line' });
  const nextLine = el('div', { className: 'lyrics-next-line' });
  const progressFill = el('div', { className: 'lyrics-progress-fill' });
  const progress = el('div', { className: 'lyrics-progress' }, [progressFill]);
  const nowBox = el('div', { className: 'lyrics-now' }, [prevLine, nowLine, progress, nextLine]);
  const tapModeBtn = button(tr('タップで合わせる', 'Sync by tapping'), () => setMode('tap'), 'lyrics-mode-button');
  const checkModeBtn = button(tr('確認する', 'Check'), () => setMode('check'), 'lyrics-mode-button');
  const modeHelp = el('div', { className: 'param-label' });
  playCard.append(
    el('div', { className: 'lyrics-mode-switch' }, [tapModeBtn, checkModeBtn]),
    modeHelp,
    audioStatus,
    el('div', { className: 'row-gap lyrics-row-wrap' }, [playBtn, backBtn, fwdBtn, timeLabel]),
    nowBox,
  );
  root.appendChild(playCard);

  // ------------------------------------------------------------ ボーカル stem (吸着用)
  const stemCard = createStemCard({ onChange: () => refresh() });
  root.appendChild(stemCard.element);

  // ------------------------------------------------------------ タイムライン (L4)
  const timeline = new LyricsTimeline({
    onSelect: (i) => selectLine(i, mode === 'check'),
    onSeek: (t) => {
      if (store.audio.isLoaded) store.audio.seek(t);
    },
    onDragCommit: (kind, i, value) =>
      applyEdit((c, t) => (kind === 'start' ? moveLineStart(c, t, i, value) : kind === 'end' ? moveLineEnd(c, t, i, value) : moveLine(c, t, i, value))),
    snap: (t, noSnap) => snapTime(t, snapTargets(), currentLyrics().timing.snapWindowMs / 1000, !noSnap).t,
    // 小節線のドラッグ (R2 の残り)。小節の頭の書き換え・吸着はリズム欄に任せる
    onBarDragCommit: (i, t) => rhythmEditor.moveBar(i, t),
    snapBar: (t, noSnap) => rhythmEditor.snapBar(t, noSnap),
    canDragBars: () => tap == null && !rhythmEditor.isTapping,
  });
  const loopBtn = button(tr('選んだ行をくり返し聞く', 'Loop the selected line'), () => toggleLoop(), 'tab-button lyrics-toggle');
  const offsetInput = el('input', { className: 'lyrics-offset-input' });
  offsetInput.type = 'number';
  offsetInput.step = '10';
  offsetInput.value = '100';
  const shiftSelBtn = button(tr('選んだ行をずらす', 'Shift selected line'), () => shiftBy('selected'));
  const shiftAllBtn = button(tr('全体をずらす', 'Shift all'), () => shiftBy('all'));
  const estimateBtn = button(tr('全体のずれを見積もる', 'Estimate overall offset'), () => doEstimate());
  const estimateText = el('span', { className: 'param-label' });
  let pendingOffset: { offset: number; lines: number[] } | null = null;
  const applyEstimateBtn = button(tr('この量ずらす', 'Apply this shift'), () => {
    if (!pendingOffset) return;
    const { offset, lines } = pendingOffset;
    pendingOffset = null;
    applyEdit((c, t) => shiftLines(c, t, lines, offset));
    estimateText.textContent = tr(`全体を ${ms(offset)} ずらしました (取り消し: Ctrl+Z)`, `Shifted everything by ${ms(offset)} (undo: Ctrl+Z)`);
  });
  const timelineCard = el('div', { className: 'lyrics-card' }, [
    el('h3', { className: 'lyrics-h3', textContent: tr('タイムライン (細かい調整)', 'Timeline (fine tuning)') }),
    timeline.element,
    el('div', { className: 'row-gap lyrics-row-wrap' }, [
      loopBtn,
      el('span', { className: 'param-label', textContent: tr('← → で選んだ行を 10ms ずつ (Shift で 100ms) 動かす、↑ ↓ で行を選ぶ', '← → move the selected line by 10ms (Shift: 100ms), ↑ ↓ select a line') }),
    ]),
    el('div', { className: 'row-gap lyrics-row-wrap' }, [
      el('span', { className: 'param-label', textContent: tr('ずらす量 (ms、マイナスで早める):', 'Shift amount (ms, negative = earlier):') }),
      offsetInput,
      shiftSelBtn,
      shiftAllBtn,
    ]),
    el('div', { className: 'row-gap lyrics-row-wrap' }, [estimateBtn, estimateText, applyEstimateBtn]),
  ]);
  root.appendChild(timelineCard);

  // ------------------------------------------------------------ 歌詞モーション (L6)
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
  const motionCard = el('div', { className: 'lyrics-card' }, [
    el('h3', { className: 'lyrics-h3', textContent: tr('歌詞の動き (歌詞モーション)', 'Lyric motion') }),
    el('p', {
      className: 'lyrics-help',
      textContent:
        tr(
          '歌詞を動かしてビジュアライザーの上に重ねます。映像と重ねた見た目は「ビジュアライザー」タブ、書き出しは「書き出し」タブで。書体は Google Fonts から読み込みます (外と通信するのは書体を取ってくるときだけです)。',
          'Animates the lyrics over the visuals. See the combined result in the Visualizer tab and export in the Export tab. Fonts are loaded from Google Fonts (the only network access).',
        ),
    }),
    el('label', { className: 'row-gap param-label' }, [motionEnabled, tr('ビジュアライザーの上に歌詞の動きを重ねる', 'Show lyric motion over the visuals')]),
    el('div', { className: 'row-gap lyrics-row-wrap' }, [el('span', { className: 'param-label', textContent: tr('スタイル:', 'Style:') }), styleSelect, customBtn, motionStatus]),
    styleEditor.element,
    el('div', { className: 'param-grid lyrics-motion-grid' }, sliderRows),
    motionCanvas,
  ]);
  root.appendChild(motionCard);

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
  }

  // ------------------------------------------------------------ タップ同期
  const tapCard = el('div', { className: 'lyrics-card' });
  const startFirstBtn = button(tr('1 行目からタップ', 'Tap from line 1'), () => startTap(0), 'lyrics-big-button');
  const startSelBtn = button(tr('選んだ行からタップ', 'Tap from selected line'), () => startTap(selectedLine), 'lyrics-big-button');
  const stopBtn = button(tr('中断 (Esc)', 'Stop (Esc)'), () => stopTap());
  const tapInfo = el('div', { className: 'lyrics-tap-info' });
  const tapButton = el('button', { className: 'lyrics-tap-button', textContent: tr('ここで叩く (Space / Enter)', 'Tap here (Space / Enter)') });
  tapButton.type = 'button';
  // キーボードで押したときの click (detail = 0) は keydown 側で処理済みなので、マウスで押したときだけ叩く
  tapButton.addEventListener('click', (e) => {
    if (e.detail > 0) doTap();
  });
  const tapBackBtn = button(tr('1 つ戻る (Backspace)', 'Undo one (Backspace)'), () => doBack());
  const lastSnap = el('div', { className: 'param-label' });
  const snapBtn = button(tr('吸着', 'Snap'), () => doSnapAll(), 'lyrics-snap-button');
  snapBtn.title = tr('手で決めた (タップ・入力した) 行を、まとめて歌い出しの候補か拍に寄せます', 'Moves manually set (tapped or typed) lines to the nearest vocal entry or beat');
  const unsnapBtn = button(tr('吸着前に戻す', 'Undo snap'), () => undoSnapAll());
  const snapReport = el('div', { className: 'param-label lyrics-snap-report' });
  const windowRange = el('input');
  windowRange.type = 'range';
  windowRange.min = '0';
  windowRange.max = '300';
  windowRange.step = '10';
  const windowLabel = el('span', { className: 'param-label' });
  windowRange.addEventListener('input', () => {
    store.updateLyricsTiming({ snapWindowMs: parseInt(windowRange.value, 10) });
    windowLabel.textContent = tr(`吸着で探す範囲: ±${windowRange.value}ms`, `Snap search range: ±${windowRange.value}ms`);
  });
  const tapActive = el('div', { className: 'lyrics-tap-active' }, [tapInfo, el('div', { className: 'row-gap lyrics-row-wrap' }, [tapButton, tapBackBtn, stopBtn]), lastSnap]);
  tapCard.append(
    el('h3', { className: 'lyrics-h3', textContent: tr('タップで合わせる', 'Tap sync') }),
    el('div', { className: 'row-gap lyrics-row-wrap' }, [startFirstBtn, startSelBtn]),
    tapActive,
    el('h3', { className: 'lyrics-h3', textContent: tr('吸着 (叩き終えたら)', 'Snap (after tapping)') }),
    el('p', {
      className: 'lyrics-help',
      textContent:
        tr(
          '叩いた時刻はそのまま記録されます。叩き終えたら「吸着」で、手で決めた行をまとめて近くの歌い出しの候補 (無ければ拍) に寄せます。叩くタイミングのくせ (全体に遅め / 早め) も見積もって直します。うまくいかなければ「吸着前に戻す」で戻せます。',
          'Taps are recorded as-is. When done, "Snap" moves manually set lines to the nearest vocal entry (or beat). Your overall tapping habit (late / early) is estimated and corrected. If it goes wrong, use "Undo snap".',
        ),
    }),
    el('div', { className: 'row-gap lyrics-row-wrap' }, [snapBtn, unsnapBtn]),
    snapReport,
    el('label', { className: 'param-row lyrics-window' }, [windowLabel, windowRange]),
  );
  root.appendChild(tapCard);

  // ------------------------------------------------------------ 行の一覧
  const listCard = el('div', { className: 'lyrics-card' });
  const undoBtn = button(tr('取り消し (Ctrl+Z)', 'Undo (Ctrl+Z)'), () => undo());
  const redoBtn = button(tr('やり直し (Ctrl+Y)', 'Redo (Ctrl+Y)'), () => redo());
  const resetBtn = button(tr('全部の行の時刻を消す', 'Reset all line times'), () => {
    if (!window.confirm(tr('手で決めた (タップ・入力した) 開始・終了の時刻をすべて消します。取り消し (Ctrl+Z) で戻せます。', 'Clear all manually set (tapped or typed) start and end times? You can undo with Ctrl+Z.'))) return;
    commitTiming({ lineTimes: {}, lineEnds: {} });
    refresh();
  });
  const table = el('table', { className: 'lyrics-table' });
  const thead = el('thead', {}, [
    el('tr', {}, ['#', tr('開始', 'Start'), tr('決め方', 'Source'), tr('終了', 'End'), tr('歌詞', 'Lyric'), ''].map((h) => el('th', { textContent: h }))),
  ]);
  const tbody = el('tbody');
  table.append(thead, tbody);
  const tableWrap = el('div', { className: 'lyrics-table-wrap' }, [table]);
  const emptyNote = el('div', { className: 'placeholder-card', textContent: tr('歌詞を入力すると、ここに行の一覧が出ます。', 'Lines appear here once you enter lyrics.') });
  listCard.append(
    el('h3', { className: 'lyrics-h3', textContent: tr('行の一覧 (行を押すとその位置へ移動・選択。開始の時刻は直接入力もできます)', 'Lines (click to jump and select; you can type a start time)') }),
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

  // ------------------------------------------------------------ リズム (変拍子, R2)。タイムラインのすぐ下に置く
  const rhythmEditor = createRhythmEditor({ isBusy: () => tap != null, onChange: () => refresh() });
  timelineCard.after(rhythmEditor.element);

  // 歌い出し候補は、ボーカル stem を使うときは stem から (ビートは元の曲から)。core/lyrics/stem.ts
  const snapTargets = (): SyncTargets => lyricSyncTargets(store.audio.analysis, activeStem()?.analysis ?? null);
  /** 直前の吸着の結果が、今の状態のまま (その後に手を加えていない) か */
  const snapIsCurrent = (): boolean => lastSnapAll != null && history.current === lastSnapAll.after;

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
    windowRange.value = String(lyrics.timing.snapWindowMs);
    windowLabel.textContent = tr(`吸着で探す範囲: ±${lyrics.timing.snapWindowMs}ms`, `Snap search range: ±${lyrics.timing.snapWindowMs}ms`);
    const lineCount = view.parsed.lines.length;
    if (selectedLine >= lineCount) selectedLine = Math.max(0, lineCount - 1);
    renderRows();
    refreshControls();
    refreshMotionControls();
    // ボーカル stem を使うときは、波形と歌声らしさも stem のものを出す (どこで歌っているかが見やすい)
    const stem = activeStem();
    const analysis = stem?.analysis ?? store.audio.analysis;
    const buffer = stem?.audioBuffer ?? store.audio.audioBuffer;
    const targets = snapTargets();
    stemCard.refresh();
    timeline.setData({
      duration: store.audio.isLoaded ? store.audio.duration : 0,
      lines: view.parsed.lines,
      starts: view.times.starts,
      ends: view.times.ends,
      source: view.startSource,
      peaks: buffer ? peaksFor(buffer) : null,
      vocal: analysis?.vocalLikeness ?? null,
      vocalRate: analysis?.frameRate ?? 0,
      onsets: targets.onsets,
      beats: targets.beats,
      selected: selectedLine,
      loop: loopRegion(),
      rhythm: rhythmEditor.grid(),
      barHeads: rhythmEditor.barHeads(),
    });
    shownLine = -2; // 次のフレームでプレビューを描き直す
  }

  /** 歌詞モーションだけのプレビュー (黒地)。映像と重ねた見た目は Visualizer タブで見る */
  function drawMotionPreview(t: number): void {
    if (!motionCtx) return;
    const motion = store.audio.isLoaded
      ? previewMotionProvider.get({
          lyrics: store.lyrics,
          analysis: store.audio.analysis,
          projectSeed: store.seed,
          width: store.exportSettings.width,
          height: store.exportSettings.height,
          fps: store.exportSettings.fps,
          rhythm: store.rhythm,
          palette: backgroundPaletteNow(store.background, store.backgroundFile),
        })
      : null;
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

  function refreshControls(): void {
    const loaded = store.audio.isLoaded;
    const hasLines = view.parsed.lines.length > 0;
    audioStatus.textContent = loaded
      ? tr(
          `${store.audio.fileName} — 歌い出しの候補 ${snapTargets().candidates.length} 個${activeStem() ? ' (ボーカルだけの音から)' : ''} / 拍 ${snapTargets().beats.length} 個`,
          `${store.audio.fileName} — ${snapTargets().candidates.length} vocal entries${activeStem() ? ' (from the vocal-only audio)' : ''} / ${snapTargets().beats.length} beats`,
        )
      : tr('曲が読み込まれていません。「音楽」タブで曲を読み込むと、再生とタップでの同期ができます。', 'No song loaded. Load one in the Music tab to play and tap-sync.');
    for (const b of [playBtn, backBtn, fwdBtn]) b.disabled = !loaded;
    const barTapping = rhythmEditor.isTapping;
    startFirstBtn.disabled = !loaded || !hasLines || tap != null || barTapping;
    startSelBtn.disabled = !loaded || !hasLines || tap != null || barTapping;
    startSelBtn.textContent = tr(`選んだ行 (${selectedLine + 1} 行目) からタップ`, `Tap from selected line (${selectedLine + 1})`);
    tapActive.hidden = tap == null;
    tapCard.hidden = mode !== 'tap';
    nowBox.classList.toggle('mode-check', mode === 'check');
    tapModeBtn.setAttribute('aria-pressed', String(mode === 'tap'));
    checkModeBtn.setAttribute('aria-pressed', String(mode === 'check'));
    modeHelp.textContent =
      mode === 'tap'
        ? tr('再生中に Space で「次の行」の歌い出しを記録します。止まっているときの Space は再生、Esc で一時停止。', 'While playing, Space records the start of the next line. Space while stopped plays, Esc pauses.')
        : tr('歌詞が歌と合っているかを見るモードです (記録はしません)。Space で再生 / 一時停止、一覧の行を押すとその 1 秒前から再生します。', 'Check whether the lyrics match the singing (nothing is recorded). Space plays / pauses; clicking a line plays from 1 second before it.');
    tapBackBtn.disabled = !tap?.canBack;
    const hasTimeline = loaded && hasLines;
    loopBtn.disabled = !hasTimeline;
    loopBtn.setAttribute('aria-pressed', String(loopOn));
    for (const b of [shiftSelBtn, shiftAllBtn, estimateBtn]) b.disabled = !hasTimeline || tap != null;
    applyEstimateBtn.hidden = pendingOffset == null;
    const manualCount = Object.keys(history.current.lineTimes).length;
    snapBtn.disabled = !loaded || tap != null || manualCount === 0;
    unsnapBtn.disabled = tap != null || !snapIsCurrent();
    undoBtn.disabled = !history.canUndo || tap != null;
    redoBtn.disabled = !history.canRedo || tap != null;
    emptyNote.hidden = hasLines;
    tableWrap.hidden = !hasLines;
    rhythmEditor.refresh();
    if (tap) {
      const i = tap.line;
      const line = view.parsed.lines[i];
      tapInfo.textContent = tap.isActive && line
        ? tr(`次に叩く行: ${i + 1} / ${view.parsed.lines.length} 行目 — ${line.interlude ? '〔間奏〕' : line.text}`, `Next line to tap: ${i + 1} / ${view.parsed.lines.length} — ${line.interlude ? '[interlude]' : line.text}`)
        : tr('すべての行を叩きました。', 'All lines tapped.');
    }
  }

  function renderRows(): void {
    tbody.textContent = '';
    rows = view.parsed.lines.map((line, i) => {
      const rowEl = el('tr', { className: 'lyrics-row' });
      rowEl.dataset.index = String(i);
      const src = view.startSource[i]!;
      const unsynced = src === 'estimate';
      const shownStart = (): string => (unsynced ? '' : formatTime(view.times.starts[i]!));
      if (unsynced) rowEl.classList.add('unsynced');
      const startInput = el('input', { className: 'lyrics-time-input' });
      startInput.value = shownStart();
      // 未同期の行は、仮の時刻を薄く出すだけにする (入力すると手動の時刻になる)
      if (unsynced) startInput.placeholder = formatTime(view.times.starts[i]!);
      startInput.title = tr('開始の時刻 (例: 1:23.45)。入力すると手動の時刻になります', 'Start time (e.g. 1:23.45). Typing sets a manual time');
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
      clearBtn.title = tr('この行の手動の時刻を消す', 'Clear this line\'s manual time');
      clearBtn.hidden = src !== 'manual' && !view.endManual[i];
      clearBtn.addEventListener('click', (e) => e.stopPropagation());
      rowEl.append(
        el('td', { className: 'lyrics-num', textContent: String(i + 1) }),
        el('td', {}, [startInput]),
        el('td', {}, [sourceBadge(i, src)]),
        el('td', { className: 'lyrics-end', textContent: unsynced && !view.endManual[i] ? '—' : formatTime(view.times.ends[i]!) + (view.endManual[i] ? tr(' (手動)', ' (manual)') : '') }),
        el('td', { className: 'lyrics-text', textContent: line.interlude ? tr(`〔間奏${line.secs ? ` ${line.secs}秒` : ''}〕`, `[interlude${line.secs ? ` ${line.secs}s` : ''}]`) : line.text }),
        el('td', {}, [clearBtn]),
      );
      rowEl.addEventListener('click', () => {
        selectedLine = i;
        timeline.reveal(view.times.starts[i]!);
        if (store.audio.isLoaded) {
          if (mode === 'check') {
            store.audio.seek(Math.max(0, view.times.starts[i]! - CHECK_PREROLL));
            store.audio.play();
          } else store.audio.seek(view.times.starts[i]!);
        }
        highlightRows(shownLine);
        refreshControls();
      });
      tbody.appendChild(rowEl);
      return rowEl;
    });
    highlightRows(shownLine);
  }

  /** 由来のバッジ。直前の「吸着」で動いた行 (その後に手を加えていない間) は「吸着」と、動いた量を出す */
  function sourceBadge(i: number, src: LyricsView['startSource'][number]): HTMLElement {
    const snapped = snapIsCurrent() ? lastSnapAll!.result.lines.find((l) => l.line === i) : undefined;
    if (snapped && snapped.kind !== 'none') {
      const badge = el('span', {
        className: 'lyrics-src lyrics-src-snapped',
        textContent: `${snapped.kind === 'candidate' ? tr('吸着', 'snap') : tr('拍', 'beat')} ${ms(snapped.to - snapped.from)}`,
      });
      badge.title = `${tr('叩いた位置', 'Tapped at')} ${formatTime(snapped.from)} → ${formatTime(snapped.to)}`;
      return badge;
    }
    return el('span', { className: `lyrics-src lyrics-src-${src}`, textContent: startSourceLabel(src, currentLyrics().source) });
  }

  function highlightRows(current: number): void {
    rows.forEach((rowEl, i) => {
      rowEl.classList.toggle('current', i === current);
      rowEl.classList.toggle('selected', i === selectedLine);
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

  /** 今の行の開始として、聞こえている位置をそのまま記録する (吸着は叩き終えてから「吸着」ボタンでまとめて)。 */
  function doTap(): void {
    if (!tap || !tap.isActive) return;
    const raw = store.audio.heardTime;
    const cur = history.current;
    const lineTimes = tap.tap(cur.lineTimes, Math.round(raw * 10000) / 10000);
    commitTiming({ lineTimes, lineEnds: cur.lineEnds });
    const latency = Math.round(store.audio.outputLatency * 1000);
    lastSnap.textContent =
      tr(`${tap.line} 行目を ${formatTime(raw)} で記録`, `Line ${tap.line} recorded at ${formatTime(raw)}`) +
      (latency > 0 ? tr(` (音が出るまでの遅れ 約${latency}ms を差し引き済み)`, ` (output latency ≈${latency}ms subtracted)`) : '');
    refresh();
    if (!tap.isActive) {
      tap = null;
      lastSnap.textContent += tr(' / すべての行を叩き終えました', ' / all lines tapped');
      refreshControls();
    }
  }

  function doSnapAll(): void {
    if (tap || !store.audio.isLoaded) return;
    syncHistoryWithStore();
    const cur = history.current;
    const targets = snapTargets();
    const result = snapAllLines(cur.lineTimes, targets.onsets, targets.beats, {
      windowSec: currentLyrics().timing.snapWindowMs / 1000,
    });
    const after: TimingSnapshot = { lineTimes: result.lineTimes, lineEnds: cur.lineEnds };
    commitTiming(after);
    lastSnapAll = { result, after };
    snapReport.textContent = describeSnapAll(result);
    refresh();
  }

  /** 直前の吸着を取り消す (吸着したあとに手を加えていないときだけ)。取り消しの履歴で 1 つ戻すのと同じ */
  function undoSnapAll(): void {
    if (!snapIsCurrent()) return;
    lastSnapAll = null;
    snapReport.textContent = tr('吸着前に戻しました。', 'Snap undone.');
    if (applyHistory(history.undo())) refresh();
  }

  function doBack(): void {
    if (!tap) return;
    const cur = history.current;
    const lineTimes = tap.back(cur.lineTimes);
    if (!lineTimes) return;
    commitTiming({ lineTimes, lineEnds: cur.lineEnds });
    store.audio.seek(Math.max(0, store.audio.currentTime - 3));
    if (!store.audio.isPlaying) store.audio.play();
    lastSnap.textContent = tr(`${tap.line + 1} 行目から叩き直します`, `Re-tapping from line ${tap.line + 1}`);
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

  // ------------------------------------------------------------ タイムライン編集
  function editContext(): EditContext {
    return { starts: view.times.starts, ends: view.times.ends, synced: view.startSource.map((src) => src !== 'estimate') };
  }

  /** core/lyrics/edit.ts の規則で書き換えて、取り消しの履歴に積む */
  function applyEdit(fn: (c: EditContext, t: TimingSnapshot) => TimingSnapshot): void {
    if (tap) return;
    syncHistoryWithStore();
    const cur = history.current;
    const next = fn(editContext(), cur);
    if (next === cur) return;
    commitTiming(next);
    refresh();
  }

  function selectLine(i: number, playFromBefore: boolean): void {
    if (i < 0 || i >= view.parsed.lines.length) return;
    selectedLine = i;
    highlightRows(shownLine);
    refreshControls();
    timeline.reveal(view.times.starts[i]!);
    if (store.audio.isLoaded && playFromBefore) {
      store.audio.seek(Math.max(0, view.times.starts[i]! - CHECK_PREROLL));
      store.audio.play();
    }
  }

  function loopRegion(): { start: number; end: number } | null {
    if (!loopOn || selectedLine >= view.parsed.lines.length) return null;
    return { start: Math.max(0, view.times.starts[selectedLine]! - LOOP_PREROLL), end: view.times.ends[selectedLine]! };
  }

  function toggleLoop(): void {
    loopOn = !loopOn;
    const region = loopRegion();
    if (region && store.audio.isLoaded) {
      store.audio.seek(region.start);
      store.audio.play();
    }
    refresh();
  }

  /** 全体をずらす対象: 時刻の決まっている行。1 行も無ければ全行 */
  function syncedLineIndices(): number[] {
    const idx = view.startSource.flatMap((src, i) => (src !== 'estimate' ? [i] : []));
    return idx.length > 0 ? idx : view.parsed.lines.map((_, i) => i);
  }

  function shiftBy(which: 'selected' | 'all'): void {
    const dt = parseFloat(offsetInput.value) / 1000;
    if (!Number.isFinite(dt) || dt === 0) return;
    if (which === 'selected') applyEdit((c, t) => moveLine(c, t, selectedLine, dt));
    else applyEdit((c, t) => shiftLines(c, t, syncedLineIndices(), dt));
  }

  function doEstimate(): void {
    pendingOffset = null;
    const idx = view.startSource.flatMap((src, i) => (src !== 'estimate' ? [i] : []));
    if (idx.length < 3) {
      estimateText.textContent = tr('時刻の決まっている行 (タップ済み・LRC) が 3 行以上必要です', 'Needs at least 3 lines with times (tapped or LRC)');
      refreshControls();
      return;
    }
    const est = estimateOffset(
      idx.map((i) => view.times.starts[i]!),
      snapTargets().onsets,
    );
    if (!est) {
      estimateText.textContent = tr('歌い出しの候補が見つからないため見積もれません', 'No vocal entries found, cannot estimate');
    } else if (Math.abs(est.offset) < 0.02) {
      estimateText.textContent = tr(`全体のずれはほぼありません (歌い出しの候補と合う行: ${Math.round(est.zeroMatched * 100)}%)`, `Almost no overall offset (lines matching vocal entries: ${Math.round(est.zeroMatched * 100)}%)`);
    } else {
      pendingOffset = { offset: est.offset, lines: idx };
      estimateText.textContent = tr(`全体を ${ms(est.offset)} ずらすと、歌い出しの候補と合う行が ${Math.round(est.zeroMatched * 100)}% → ${Math.round(est.matched * 100)}% になります`, `Shifting everything by ${ms(est.offset)} raises lines matching vocal entries from ${Math.round(est.zeroMatched * 100)}% to ${Math.round(est.matched * 100)}%`);
    }
    refreshControls();
  }

  function setMode(next: 'tap' | 'check'): void {
    if (mode === next) return;
    if (tap) stopTap();
    mode = next;
    refreshControls();
    shownLine = -2;
  }

  // ------------------------------------------------------------ キーボード
  const onKey = (e: KeyboardEvent): void => {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (isEditable(e.target)) return;
    // 小節の頭のタップ中は、Space / Backspace / Esc をリズム欄が受ける
    if (rhythmEditor.handleKey(e)) return;
    // Space はどのボタンにフォーカスがあってもタップ/再生に使う (「再生」ボタンを押したあと Space を押すと、
    // ブラウザの標準動作でそのボタンがもう一度押されて一時停止になっていた)。Enter はボタンの上ではボタンを押す
    const isTapKey = !mod && (e.key === ' ' || (e.key === 'Enter' && (!(e.target instanceof HTMLButtonElement) || e.target === tapButton)));
    if (isTapKey) {
      e.preventDefault();
      if (e.repeat || !store.audio.isLoaded) return;
      if (mode === 'check') {
        if (store.audio.isPlaying) store.audio.pause();
        else store.audio.play();
        return;
      }
      if (tap) doTap();
      else if (store.audio.isPlaying && view.parsed.lines.length > 0) {
        // 再生中に叩いたら、その場でタップを始めて「次に叩く行」の頭として記録する
        beginTapAt(nextLineToTap(store.audio.heardTime));
        doTap();
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
    if (!mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && view.parsed.lines.length > 0) {
      e.preventDefault();
      const d = (e.shiftKey ? 0.1 : 0.01) * (e.key === 'ArrowLeft' ? -1 : 1);
      applyEdit((c, t) => moveLine(c, t, selectedLine, d));
      return;
    }
    if (!mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && view.parsed.lines.length > 0) {
      e.preventDefault();
      selectLine(Math.min(view.parsed.lines.length - 1, Math.max(0, selectedLine + (e.key === 'ArrowUp' ? -1 : 1))), mode === 'check');
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
      timeline.dispose();
      rhythmEditor.dispose();
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
    // ループ試聴: 選んだ行の終わりまで来たら、行の少し前へ戻す
    const region = loopRegion();
    if (region && playing && t >= region.end) store.audio.seek(region.start);
    timeline.setSelection(selectedLine, region);
    timeline.draw(t, playing);
    drawMotionPreview(t);
    rhythmEditor.tick(t);
    const playText = playing ? tr('一時停止', 'Pause') : tr('再生', 'Play');
    if (playBtn.textContent !== playText) playBtn.textContent = playText;

    const cur = lineAt(syncedTimes, t);
    // 今の行の中でどこまで進んだか (確認モードで表示)
    const pct = cur >= 0 ? Math.min(1, Math.max(0, (t - syncedTimes.starts[cur]!) / Math.max(0.01, syncedTimes.ends[cur]! - syncedTimes.starts[cur]!))) : 0;
    progressFill.style.width = `${(pct * 100).toFixed(1)}%`;
    if (cur !== shownLine) {
      shownLine = cur;
      highlightRows(cur);
      const lines = view.parsed.lines;
      const showText = (i: number): string => {
        const l = lines[i];
        return !l ? '' : l.interlude ? tr('〔間奏〕', '[interlude]') : l.text;
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
      // 前の行: 今の行の 1 つ前。行の外なら、最後に過ぎた行
      const prev = cur >= 0 ? cur - 1 : next - 1;
      prevLine.textContent = prev >= 0 ? showText(prev) : '';
      if (next >= lines.length) next = -1;
      nextLine.textContent = next >= 0 ? showText(next) : '';
      nextLine.dataset.label = next >= 0 ? tr(`次 (${next + 1} 行目)`, `Next (line ${next + 1})`) : '';
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
