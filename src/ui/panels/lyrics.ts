import { createMotionApplyNotice, previewMotionNow } from './motion-apply';
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
import { MAX_LYRICS_LENGTH } from '../../core/project/validate';
import { store } from '../../core/store';
import { defaultLyrics, type LyricBlank, type LyricsSettings, type LyricsSource, type LyricsTiming } from '../../core/types';
import { blankFromPlayhead, normalizeBlanks } from '../../core/lyrics/blanks';
import { lyricSyncTargets } from '../../core/lyrics/stem';
import { anyFileButton, AUDIO_ACCEPT } from './panel-helpers';
import { createRhythmEditor } from './lyrics-rhythm';
import { activeStem, createStemCard } from './lyrics-stem';
import { LyricsTimeline } from './lyrics-timeline';

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
/** 選んでいる歌詞の空白 (-1 = なし。タブをまたいで残す) */
let selectedBlank = -1;
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

/**
 * タイムラインのドラッグで吸着するか (タブをまたいで残す)。最初は切っておく
 * (2026-10-01 「吸着してる？ちょっと使いづらい」: ドラッグ中に近くの候補・拍へ飛んで、細かく合わせにくかった)。
 * Shift を押している間は逆になる
 */
let timelineSnap = false;

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

  // ------------------------------------------------------------ はじめかた (3 つの手順。2026-10-01 「曲 → 歌詞 → タップの導線がつながっていない」)
  const stepsCard = el('div', { className: 'lyrics-card lyrics-steps' });
  stepsCard.dataset.lyrics = 'steps';
  const stepMark = (): HTMLSpanElement => el('span', { className: 'lyrics-step-mark' });
  // スマホ表示 (画面が狭く、タッチ操作が主) では、キーの名前を出さない (Space キーが無い)
  const touchFirst = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const step1Mark = stepMark();
  const step2Mark = stepMark();
  const step3Mark = stepMark();
  const step1Text = el('span', { className: 'param-label' });
  const step2Text = el('span', { className: 'param-label' });
  const step3Text = el('span', { className: 'param-label' });
  const songInput = el('input');
  songInput.type = 'file';
  songInput.accept = AUDIO_ACCEPT;
  songInput.dataset.lyrics = 'step-song';
  songInput.addEventListener('change', () => {
    const file = songInput.files?.[0];
    songInput.value = '';
    if (!file) return;
    step1Text.textContent = tr('曲を調べています… (テンポや歌声らしさを調べるので、少しかかります)', 'Analyzing the song… (tempo and voice detection take a moment)');
    store.audio
      .load(file)
      .then(() => {
        if (root.isConnected) refresh();
      })
      .catch((err: unknown) => {
        step1Text.textContent = `${tr('読み込めませんでした', 'Could not load')}: ${err instanceof Error ? err.message : String(err)}`;
      });
  });
  const toLyricsBtn = button(tr('歌詞の欄へ', 'Go to the lyrics box'), () => {
    textarea.scrollIntoView({ block: 'center', behavior: 'smooth' });
    textarea.focus();
  });
  const stepTapBtn = button(tr('1 行目からタップを始める', 'Start tapping from line 1'), () => startTap(0), 'lyrics-big-button');
  stepTapBtn.dataset.lyrics = 'step-tap';
  const stepRow = (mark: HTMLElement, title: string, text: HTMLElement, ...actions: HTMLElement[]): HTMLElement =>
    el('div', { className: 'lyrics-step' }, [mark, el('div', { className: 'lyrics-step-body' }, [el('strong', { textContent: title }), text, el('div', { className: 'row-gap lyrics-row-wrap' }, actions)])]);
  stepsCard.append(
    el('h3', { className: 'lyrics-h3', textContent: tr('はじめかた', 'Getting started') }),
    stepRow(step1Mark, tr('曲を読み込む', 'Load the song'), step1Text, songInput, anyFileButton(songInput)),
    stepRow(step2Mark, tr('歌詞を入れる', 'Enter the lyrics'), step2Text, toLyricsBtn),
    stepRow(step3Mark, tr('タップで合わせる', 'Sync by tapping'), step3Text, stepTapBtn),
  );
  /** 手順の欄の表示 (できた手順に ✓) */
  function refreshSteps(): void {
    const loaded = store.audio.isLoaded;
    const n = view.parsed.lines.length;
    const synced = view.startSource.filter((src) => src !== 'estimate').length;
    step1Mark.textContent = loaded ? '✓' : '1';
    step2Mark.textContent = n > 0 ? '✓' : '2';
    step3Mark.textContent = n > 0 && synced === n ? '✓' : '3';
    for (const [m, done] of [
      [step1Mark, loaded],
      [step2Mark, n > 0],
      [step3Mark, n > 0 && synced === n],
    ] as const)
      m.classList.toggle('done', done);
    if (!step1Text.textContent?.startsWith(tr('曲を調べています', 'Analyzing')) || loaded)
      step1Text.textContent = loaded
        ? tr(`「${store.audio.fileName}」(ほかの曲にするときも、ここか「音楽」タブで選び直せます)`, `"${store.audio.fileName}" (pick another file here or in the Music tab to change it)`)
        : tr('曲のファイルを選びます (「音楽」タブで読み込んでも同じです)', 'Choose the song file (same as loading it in the Music tab)');
    step2Text.textContent =
      n > 0
        ? tr(`${n} 行。直すときは下の「歌詞」の欄で`, `${n} lines. Edit them in the lyrics box below`)
        : tr('下の欄に歌詞を貼りつけるか、LRC / SRT のファイルを読み込みます。[サビ] などの見出しも書けます', 'Paste the lyrics into the box below or load an LRC / SRT file. Headings like [Chorus] are fine too');
    step3Text.textContent =
      tap != null
        ? touchFirst
          ? tr('タップ中です。歌詞の表示を見ながら、各行の歌い出しで下の大きなボタンを叩きます', 'Tapping. Watch the lyrics display and tap the big button below at the start of each line')
          : tr('タップ中です。下の大きな歌詞の表示を見ながら、各行の歌い出しで Space を叩きます', 'Tapping. Watch the big lyrics display below and press Space at the start of each line')
        : !loaded || n === 0
          ? tr('曲と歌詞がそろったら、ここから始められます', 'Once the song and lyrics are ready, start here')
          : synced === 0
            ? touchFirst
              ? tr('再生が始まるので、各行の歌い出しで下の大きなボタンを叩きます。叩いたあと、ずれはタイムラインで直せます', 'Playback starts; tap the big button at the start of each line. Fix small offsets on the timeline afterwards')
              : tr('再生が始まるので、各行の歌い出しで Space を叩きます (Esc で止める)。叩いたあと、ずれはタイムラインで直せます', 'Playback starts; press Space at the start of each line (Esc stops). Fix small offsets on the timeline afterwards')
            : tr(`${n} 行のうち ${synced} 行の時刻が決まっています。ずれはタイムラインで直せます`, `${synced} of ${n} lines are timed. Fix offsets on the timeline`);
    stepTapBtn.disabled = !loaded || n === 0 || tap != null || rhythmEditor.isTapping;
  }

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
      el('li', {
        textContent: tr(
          '[Intro] [Aメロ] [サビ] [Chorus] [Outro] などの見出しは歌詞に出ず、曲の区切りになります (タイムラインに色の帯で出ます)。そのほかの [ ] で囲んだ所も歌詞には出ません',
          'Headings like [Intro] [Verse] [Chorus] [Outro] are not shown as lyrics; they mark song sections (colored band on the timeline). Anything else in [ ] is hidden too',
        ),
      }),
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
  const playBtn = button(tr('再生', 'Play'), () => {
    if (store.audio.isPlaying) { stopTap(true); }
    else store.audio.play();
  });
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
    // timeline 側の noSnap は「Shift を押している」。吸着のオン・オフを Shift で一時的に逆にする
    snap: (t, shift) => snapTime(t, snapTargets(), currentLyrics().timing.snapWindowMs / 1000, timelineSnap !== shift).t,
    // 小節線のドラッグ (R2 の残り)。小節の頭の書き換え・吸着はリズム欄に任せる
    onBarDragCommit: (i, t) => rhythmEditor.moveBar(i, t),
    onBlankSelect: (k) => {
      selectedBlank = k;
      refresh();
    },
    onBlankCommit: (k, start, end) => {
      const blanks = [...(currentLyrics().timing.blanks ?? [])];
      if (!blanks[k]) return;
      blanks[k] = { ...blanks[k]!, start, end };
      setBlanks(blanks);
    },
    snapBar: (t, noSnap) => rhythmEditor.snapBar(t, noSnap),
    canDragBars: () => tap == null && !rhythmEditor.isTapping,
  });
  const loopBtn = button(tr('選んだ行をくり返し聞く', 'Loop the selected line'), () => toggleLoop(), 'tab-button lyrics-toggle');
  // 歌詞の空白 (何も出さない / 間奏の動き)。core/lyrics/blanks.ts
  const blankBtn = button(tr('再生位置から空白を作る', 'Make a blank from the playhead'), () => makeBlank());
  blankBtn.dataset.lyrics = 'blank-make';
  blankBtn.title = tr('再生位置から次の行の始まりまでを空白にします (行の途中なら、その行はそこで終わります)', 'Makes a blank from the playhead to the next line (a line in progress ends there)');
  const blankMode = el('select', { className: 'select' });
  blankMode.dataset.lyrics = 'blank-mode';
  for (const [v, label] of [
    ['none', tr('何も出さない', 'Show nothing')],
    ['interlude', tr('間奏の動き (飾り・効果だけ)', 'Interlude motion (decorations only)')],
  ] as const) {
    const o = el('option', { textContent: label });
    o.value = v;
    blankMode.appendChild(o);
  }
  blankMode.addEventListener('change', () => {
    const blanks = [...(currentLyrics().timing.blanks ?? [])];
    if (!blanks[selectedBlank]) return;
    blanks[selectedBlank] = { ...blanks[selectedBlank]!, mode: blankMode.value === 'interlude' ? 'interlude' : 'none' };
    setBlanks(blanks);
  });
  const blankDelBtn = button(tr('この空白を消す (Delete)', 'Remove this blank (Delete)'), () => removeBlank());
  blankDelBtn.dataset.lyrics = 'blank-delete';
  const blankInfo = el('span', { className: 'param-label' });
  const blankRow = el('div', { className: 'row-gap lyrics-row-wrap' }, [blankBtn, blankInfo, blankMode, blankDelBtn]);
  blankRow.dataset.lyrics = 'blanks';
  const snapCheck = el('input');
  snapCheck.type = 'checkbox';
  snapCheck.checked = timelineSnap;
  snapCheck.dataset.lyrics = 'timeline-snap';
  snapCheck.addEventListener('change', () => (timelineSnap = snapCheck.checked));
  const snapLabel = el('label', { className: 'row-gap param-label' }, [
    snapCheck,
    tr('ドラッグで吸着する (歌い出しの候補・拍に合わせる。Shift を押している間は逆)', 'Snap while dragging (to vocal entries / beats; hold Shift to invert)'),
  ]);
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
  // 時刻だけを変えたときは、歌詞の動きを「反映」ボタンで作り直す (自動で作り直すと、そのたびに画面が少し止まるため)
  const applyNotices = [createMotionApplyNotice()];
  const timelineCard = el('div', { className: 'lyrics-card' }, [
    el('h3', { className: 'lyrics-h3', textContent: tr('タイムライン (細かい調整)', 'Timeline (fine tuning)') }),
    timeline.element,
    applyNotices[0]!.element,
    blankRow,
    el('div', { className: 'row-gap lyrics-row-wrap' }, [snapLabel]),
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

  // ------------------------------------------------------------ タップ同期
  const tapCard = el('div', { className: 'lyrics-tap-controls' });
  const startFirstBtn = button(tr('1 行目からタップ', 'Tap from line 1'), () => startTap(0), 'lyrics-big-button');
  const startSelBtn = button(tr('選んだ行からタップ', 'Tap from selected line'), () => startTap(selectedLine), 'lyrics-big-button');
  const stopBtn = button(touchFirst ? tr('タップを中止して停止', 'Stop tapping and pause') : tr('タップを中止して停止 (Esc)', 'Stop tapping and pause (Esc)'), () => stopTap(true), 'lyrics-big-button');
  const resumeBtn = button(tr('続きから再開', 'Resume tapping'), () => { if (resumeLine != null) startTap(resumeLine); }, 'lyrics-big-button');
  const restartLine = el('select', { className: 'select' });
  restartLine.style.maxWidth = '100%';
  restartLine.setAttribute('aria-label', tr('やり直す行', 'Line to re-tap'));
  restartLine.addEventListener('change', () => selectLine(Number(restartLine.value), false));
  const tapStatus = el('div', { className: 'param-label', textContent: tr('中止しても記録済みの時刻は残ります。戻ってやり直すときは行を選んで再開。', 'Recorded times remain after stopping. Select a line to re-tap from there.') });
  let restartText = '';
  const tapInfo = el('div', { className: 'lyrics-tap-info' });
  const tapButton = el('button', { className: 'lyrics-tap-button', textContent: touchFirst ? tr('ここで叩く', 'Tap here') : tr('ここで叩く (Space / Enter)', 'Tap here (Space / Enter)') });
  tapButton.type = 'button';
  // マウス・指で押したとき: 触れた瞬間 (pointerdown) に叩く。click は指を離したあとに届くので、スマホではその分だけ遅れる
  // (2026-10-03 スマホ表示 M3)。pointerdown で叩いたあとに来る click は、二重に記録しないよう 1 回だけ無視する。
  // キーボードで押したときの click (detail = 0) は keydown 側で処理済みなので、これも叩かない
  let tappedByPointer = false;
  tapButton.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    tappedByPointer = true;
    doTap();
  });
  tapButton.addEventListener('click', (e) => {
    if (tappedByPointer) {
      tappedByPointer = false;
      return;
    }
    if (e.detail > 0) doTap();
  });
  const tapBackBtn = button(touchFirst ? tr('1 つ戻る', 'Undo one') : tr('1 つ戻る (Backspace)', 'Undo one (Backspace)'), () => doBack());
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
  // タップの始め方と、タップ中の操作は、大きな歌詞の表示のすぐ下に置く (表示とタイムラインを一緒に見ながら叩けるように)
  tapCard.append(tapStatus, el('div', { className: 'row-gap lyrics-row-wrap' }, [resumeBtn, restartLine, startSelBtn, startFirstBtn]), tapActive);
  playCard.appendChild(tapCard);
  const snapCard = el('div', { className: 'lyrics-card' });
  snapCard.append(
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
  let resumeLine: number | null = null;
  let tapStopped = false;
  let shownLine = -2;
  let shownTime = '';
  let rows: HTMLTableRowElement[] = [];

  // ------------------------------------------------------------ リズム (変拍子, R2)。タイムラインのすぐ下に置く
  const rhythmEditor = createRhythmEditor({ isBusy: () => tap != null, onChange: () => refresh() });
  // 並び: はじめかた → 歌詞の入力 → 大きな歌詞の表示とタップ → タイムライン → リズム → 吸着 → ボーカルだけの音 → 行の一覧
  // (歌詞の動き (JIZURA) は「リリックモーション」タブ。2026-10-01 「歌詞のメニューだけ縦に長い」)
  root.append(stepsCard, inputCard, playCard, timelineCard, rhythmEditor.element, snapCard, stemCard.element, listCard);

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
      sections: view.sections,
      blanks: lyrics.timing.blanks ?? [],
      selectedBlank,
    });
    const blank = (lyrics.timing.blanks ?? [])[selectedBlank];
    if (!blank) selectedBlank = -1;
    blankMode.hidden = !blank;
    blankDelBtn.hidden = !blank;
    blankBtn.disabled = !store.audio.isLoaded || tap != null;
    blankInfo.textContent = blank
      ? tr(`選んだ空白: ${formatTime(blank.start)} 〜 ${formatTime(blank.end)}`, `Selected blank: ${formatTime(blank.start)} – ${formatTime(blank.end)}`)
      : tr('空白の間は、歌詞の動きを出しません (長い間奏など)。端をドラッグして長さを変えられます', 'No lyric motion during a blank (long interludes etc.). Drag its edges to resize');
    shownLine = -2; // 次のフレームでプレビューを描き直す
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
    startSelBtn.textContent = tr(`選んだ ${selectedLine + 1} 行目からやり直す`, `Re-tap from line ${selectedLine + 1}`);
    if (restartText !== currentLyrics().text || restartLine.options.length !== view.parsed.lines.length) {
      if (restartText && restartText !== currentLyrics().text) resumeLine = null;
      restartText = currentLyrics().text;
      restartLine.replaceChildren(...view.parsed.lines.map((line, i) => {
        const option = el('option', { textContent: `${i + 1}. ${line.interlude ? '〔間奏〕' : line.text}` });
        option.value = String(i);
        return option;
      }));
    }
    restartLine.value = String(selectedLine);
    restartLine.disabled = tap != null || !hasLines;
    resumeBtn.hidden = resumeLine == null || resumeLine >= view.parsed.lines.length;
    resumeBtn.disabled = !loaded || tap != null || barTapping;
    resumeBtn.textContent = tr(`続き (${(resumeLine ?? 0) + 1} 行目) から再開`, `Resume from line ${(resumeLine ?? 0) + 1}`);
    tapActive.hidden = tap == null;
    tapCard.hidden = mode !== 'tap';
    nowBox.classList.toggle('mode-check', mode === 'check');
    tapModeBtn.setAttribute('aria-pressed', String(mode === 'tap'));
    checkModeBtn.setAttribute('aria-pressed', String(mode === 'check'));
    modeHelp.textContent =
      mode === 'tap'
        ? touchFirst
          ? tr('再生中に下の大きなボタンを叩くと、「次の行」の歌い出しを記録します。', 'While playing, tap the big button below to record the start of the next line.')
          : tr('再生中に Space で「次の行」の歌い出しを記録します。止まっているときの Space は再生、Esc でタップを中止して停止。', 'While playing, Space records the start of the next line. Space while stopped plays, Esc pauses.')
        : tr('歌詞が歌と合っているかを見るモードです (記録はしません)。Space で再生 / 一時停止、一覧の行を押すとその 1 秒前から再生します。', 'Check whether the lyrics match the singing (nothing is recorded). Space plays / pauses; clicking a line plays from 1 second before it.');
    if (mode === 'tap' && tapStopped) modeHelp.textContent = tr('再開ボタンを押すまでは記録しません。Space は再生 / 一時停止です。', 'No recording until you resume tapping. Space plays / pauses.');
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
    refreshSteps();
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
    tapStopped = false;
    resumeLine = null;
    loopOn = false;
    tapStatus.textContent = tr('タップ中です。「タップを中止して停止」で曲も停止し、記録済みの時刻は残ります。', 'Tapping. Stop tapping and pause keeps recorded times.');
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
    // 大きな歌詞の表示とタイムラインが一緒に見える所まで動かす
    playCard.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }

  function stopTap(pause = false): void {
    if (tap) {
      resumeLine = tap.line;
      selectedLine = Math.min(tap.line, Math.max(0, view.parsed.lines.length - 1));
      tapStopped = true;
      tapStatus.textContent = tr(`タップを中止しました。記録済みの時刻は残っています。続きは ${tap.line + 1} 行目から再開できます。`, `Tapping stopped. Recorded times remain. Resume from line ${tap.line + 1}.`);
    }
    if (pause) store.audio.pause();
    tap?.stop();
    tap = null;
    refreshControls();
  }

  /** 今の行の開始として、聞こえている位置をそのまま記録する (吸着は叩き終えてから「吸着」ボタンでまとめて)。 */
  function doTap(): void {
    if (!tap || !tap.isActive || !store.audio.isPlaying) return;
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
      resumeLine = null;
      tapStopped = true;
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

  /** 歌詞の空白を書き換える (並べ直し・重なりはまとめる)。歌詞の動きの作り直しは要らない (描くかどうかだけ) */
  function setBlanks(blanks: LyricBlank[]): void {
    const dur = store.audio.isLoaded ? store.audio.duration : Infinity;
    const sel = blanks[selectedBlank];
    const next = normalizeBlanks(blanks, dur);
    store.updateLyricsTiming({ blanks: next });
    selectedBlank = sel ? next.findIndex((b) => b.start <= sel.start + 1e-6 && b.end >= sel.end - 1e-6) : -1;
    refresh();
  }

  /** 再生位置から空白を作る。行の途中なら、その行はそこで終わらせる (取り消しの履歴にも積む) */
  function makeBlank(): void {
    if (!store.audio.isLoaded) return;
    const t = store.audio.heardTime;
    const made = blankFromPlayhead(t, view.times.starts, view.times.ends, store.audio.duration);
    if (!made) {
      blankInfo.textContent = tr('ここには空白を作れません (次の行まで 0.5 秒もありません)', 'Cannot make a blank here (less than 0.5 s to the next line)');
      return;
    }
    if (made.cut) {
      const cut = made.cut;
      applyEdit((c, tm) => moveLineEnd(c, tm, cut.line, cut.end));
    }
    const blanks = [...(currentLyrics().timing.blanks ?? []), made.blank];
    selectedBlank = blanks.length - 1;
    setBlanks(blanks);
  }

  function removeBlank(): void {
    const blanks = [...(currentLyrics().timing.blanks ?? [])];
    if (!blanks[selectedBlank]) return;
    blanks.splice(selectedBlank, 1);
    selectedBlank = -1;
    setBlanks(blanks);
  }

  function selectLine(i: number, playFromBefore: boolean): void {
    if (i < 0 || i >= view.parsed.lines.length) return;
    selectedLine = i;
    if (selectedBlank >= 0) {
      selectedBlank = -1;
      refresh();
    }
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
      if (tap) {
        if (store.audio.isPlaying) doTap();
        else store.audio.play();
      }
      else if (!tapStopped && store.audio.isPlaying && view.parsed.lines.length > 0) {
        // 再生中に叩いたら、その場でタップを始めて「次に叩く行」の頭として記録する
        beginTapAt(nextLineToTap(store.audio.heardTime));
        doTap();
      } else if (store.audio.isPlaying) store.audio.pause();
      else store.audio.play();
      return;
    }
    if (tap) {
      if (e.key === 'Backspace') {
        e.preventDefault();
        doBack();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        stopTap(true);
      }
      return;
    }
    if (e.key === 'Escape' && store.audio.isPlaying) {
      e.preventDefault();
      store.audio.pause();
      return;
    }
    if (!mod && e.key === 'Delete' && selectedBlank >= 0) {
      e.preventDefault();
      removeBlank();
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
    if (tap && !playing) stopTap();
    // ループ試聴: 選んだ行の終わりまで来たら、行の少し前へ戻す
    const region = loopRegion();
    if (region && playing && t >= region.end) store.audio.seek(region.start);
    timeline.setSelection(selectedLine, region);
    timeline.draw(t, playing);
    // 歌詞の動きの見本はリリックモーションのタブだが、時刻を変えたときの「反映」ボタンのために、ここでも今の設定を伝える。
    // 作り直しはしない (作り直しの間は画面が止まるので、打ち込みやドラッグの邪魔になる。ほかのタブか「反映」で作る)
    previewMotionNow({ build: false });
    for (const n of applyNotices) n.update();
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
