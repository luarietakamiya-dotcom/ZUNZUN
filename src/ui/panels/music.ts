import { store } from '../../core/store';
import { tr } from '../../core/i18n';
import { anyFileButton, AUDIO_ACCEPT } from './panel-helpers';

export function renderMusicPanel(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel';

  const h2 = document.createElement('h2');
  h2.textContent = tr('音楽', 'Music');
  el.appendChild(h2);

  const p = document.createElement('p');
  p.textContent = tr('曲のファイルを読み込みます。テンポ (BPM) や音の強さを自動で調べます。読み込んだ曲がほかの場所へ送られることはありません。', 'Load a song file. Tempo (BPM) and loudness are analyzed automatically. The song never leaves your computer.');
  el.appendChild(p);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = AUDIO_ACCEPT;
  el.appendChild(fileInput);
  const anyBtn = anyFileButton(fileInput);
  const anyRow = document.createElement('div');
  anyRow.append(anyBtn);
  el.appendChild(anyRow);

  const status = document.createElement('div');
  status.className = 'placeholder-card';
  el.appendChild(status);

  // 再生 ⇄ 一時停止 (1 つの大きなボタン。上の再生ボタンと同じ動き)
  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'btn-primary btn-large music-play';
  playBtn.dataset.music = 'play';
  el.appendChild(playBtn);
  const setPlayLabel = (): void => {
    const playing = store.audio.isPlaying;
    playBtn.classList.toggle('btn-icon-pause', playing);
    playBtn.classList.toggle('btn-icon-play', !playing);
    playBtn.textContent = playing ? tr('一時停止', 'Pause') : tr('再生', 'Play');
  };
  setPlayLabel();
  // 上の再生ボタンや Space キーで変わったときも合わせる (パネルが外れたら止める)
  let seen = store.audio.isPlaying;
  let mounted = false;
  const watch = (): void => {
    if (!playBtn.isConnected) {
      if (mounted) return;
      requestAnimationFrame(watch);
      return;
    }
    mounted = true;
    if (store.audio.isPlaying !== seen) {
      seen = store.audio.isPlaying;
      setPlayLabel();
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);

  const refreshStatus = (): void => {
    const { audio } = store;
    if (!audio.isLoaded) {
      status.textContent = store.expectedAudio
        ? tr(`曲がまだ読み込まれていません (開いたプロジェクトは「${store.expectedAudio.name}」を使っています。同じファイルを選んでください)`, `No song loaded yet (the opened project uses "${store.expectedAudio.name}" — please pick that file)`)
        : tr('曲がまだ読み込まれていません', 'No song loaded yet');
      playBtn.disabled = true;
      return;
    }
    const bpmText = audio.bpm > 0 ? `${audio.bpm} BPM` : tr('テンポ (BPM) を見つけられませんでした', 'Tempo (BPM) not detected');
    let text = `${audio.fileName} — ${audio.duration.toFixed(1)}${tr('秒', 's')} / ${bpmText}`;
    if (store.expectedAudio) {
      text +=
        store.expectedAudio.sha256 === audio.sha256
          ? tr(' (プロジェクトの曲と同じファイルです)', ' (matches the project\'s song)')
          : tr(` (注意: プロジェクトの曲「${store.expectedAudio.name}」とは別のファイルです)`, ` (Note: this is not the project's song "${store.expectedAudio.name}")`);
    }
    status.textContent = text;
    playBtn.disabled = false;
  };
  refreshStatus();

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    status.textContent = tr('曲を調べています…', 'Analyzing the song…');
    playBtn.disabled = true;
    store.audio
      .load(file)
      .then(refreshStatus)
      .catch((err: unknown) => {
        status.textContent = `${tr('読み込めませんでした', 'Could not load')}: ${err instanceof Error ? err.message : String(err)}`;
      });
  });

  playBtn.addEventListener('click', () => {
    if (!store.audio.isLoaded) return;
    if (store.audio.isPlaying) store.audio.pause();
    else store.audio.play();
    seen = store.audio.isPlaying;
    setPlayLabel();
  });

  return el;
}
