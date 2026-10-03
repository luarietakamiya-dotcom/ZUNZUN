import { formatTime } from '../core/lyrics';
import { store } from '../core/store';
import { onLangChange, tr } from '../core/i18n';

/**
 * ヘッダーに置く共通の再生欄 (どのタブでも使える)。再生/一時停止・−5 秒/+5 秒・シークバー・時刻・曲名。
 * ヘッダーはタブを切り替えても作り直されないので、この欄はアプリを開いている間ずっと同じもの (シェルが 1 度だけ作る)。
 * Space キーでも再生/一時停止できる。ただし Lyrics タブでは Space がタップ (記録) なので、そのタブの処理に任せる
 * (spaceHandledByPanel が true を返す間は何もしない)。入力欄にフォーカスがあるときも何もしない。
 * 画面から外れたら (PC 表示とスマホ表示を切り替えて枠組みを作り直したとき)、キーの受け付けと更新を止める
 * (残すと、Space 1 回で古い欄と新しい欄の両方が動き、再生してすぐ止まる)。
 */

export interface TransportOptions {
  /** 今のタブが Space を自分で使うか (Lyrics タブ) */
  spaceHandledByPanel(): boolean;
}

const SKIP_SEC = 5;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tab-button transport-button';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

export function createTransport(opts: TransportOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'transport';
  const life = new AbortController();
  const audio = store.audio;

  const playBtn = button('▶', '', () => toggle());
  playBtn.classList.add('transport-play');
  const backBtn = button('', '', () => audio.seek(Math.max(0, audio.currentTime - SKIP_SEC)));
  const fwdBtn = button('', '', () => audio.seek(Math.min(audio.duration, audio.currentTime + SKIP_SEC)));
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.className = 'transport-seek';
  seek.min = '0';
  seek.step = '0.01';
  const time = document.createElement('span');
  time.className = 'transport-time';
  const name = document.createElement('span');
  name.className = 'transport-name';
  root.append(playBtn, backBtn, fwdBtn, seek, time, name);

  // 言語で変わる文字 (切り替えたら付け直し、下の表示の更新もやり直す)
  const applyTexts = (): void => {
    playBtn.title = tr('再生 / 一時停止 (Space キー)', 'Play / Pause (Space)');
    backBtn.textContent = tr('−5秒', '−5s');
    backBtn.title = tr('5 秒戻る', 'Back 5 seconds');
    fwdBtn.textContent = tr('+5秒', '+5s');
    fwdBtn.title = tr('5 秒進む', 'Forward 5 seconds');
    seek.title = tr('再生する位置 (つまんで動かす)', 'Playback position (drag to seek)');
  };
  applyTexts();

  function toggle(): void {
    if (!audio.isLoaded) return;
    if (audio.isPlaying) audio.pause();
    else audio.play();
  }

  // シークバーをつかんでいる間は、表示の更新で位置を上書きしない
  let dragging = false;
  seek.addEventListener('pointerdown', () => (dragging = true));
  window.addEventListener('pointerup', () => (dragging = false), { signal: life.signal });
  seek.addEventListener('input', () => {
    if (audio.isLoaded) audio.seek(parseFloat(seek.value));
  });
  seek.addEventListener('change', () => (dragging = false));

  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (opts.spaceHandledByPanel() || isEditable(e.target)) return;
    // ボタンにフォーカスがあると、ブラウザの標準動作でそのボタンも押されてしまうので止める
    e.preventDefault();
    if (!e.repeat) toggle();
  }, { signal: life.signal });

  let shown = '';
  let mounted = false;
  const tick = (): void => {
    if (!root.isConnected) {
      // 作った直後 (画面に載る前) は待つ。載ったあとに外れたら片づける
      if (mounted) {
        life.abort();
        offLang();
        return;
      }
      requestAnimationFrame(tick);
      return;
    }
    mounted = true;
    const loaded = audio.isLoaded;
    const playing = audio.isPlaying;
    // 表示は「いまスピーカーから聞こえている位置」(Lyrics タブと同じ)
    const t = loaded ? audio.heardTime : 0;
    const dur = loaded ? audio.duration : 0;
    const key = `${loaded}|${playing}|${t.toFixed(2)}|${dur}|${audio.fileName}`;
    if (key !== shown) {
      shown = key;
      for (const b of [playBtn, backBtn, fwdBtn]) b.disabled = !loaded;
      seek.disabled = !loaded;
      playBtn.textContent = playing ? '❚❚' : '▶';
      playBtn.setAttribute('aria-label', playing ? tr('一時停止', 'Pause') : tr('再生', 'Play'));
      // 今の位置と全体の長さ (スマホ表示では、長さは隠して今の位置だけ。style.css の .transport-total)
      time.textContent = '';
      if (!loaded) time.textContent = '--:--';
      else {
        const total = document.createElement('span');
        total.className = 'transport-total';
        total.textContent = ` / ${formatTime(dur)}`;
        time.append(formatTime(t), total);
      }
      name.textContent = loaded ? audio.fileName : tr('曲がまだありません (「音楽」タブで読み込みます)', 'No song yet (load one in the Music tab)');
      name.title = name.textContent;
      if (seek.max !== String(dur)) seek.max = String(dur || 1);
      if (!dragging) seek.value = String(t);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const offLang = onLangChange(() => {
    applyTexts();
    shown = '';
  });
  return root;
}
