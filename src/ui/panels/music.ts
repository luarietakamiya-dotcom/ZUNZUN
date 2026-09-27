import { store } from '../../core/store';

export function renderMusicPanel(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel';

  const h2 = document.createElement('h2');
  h2.textContent = 'Music';
  el.appendChild(h2);

  const p = document.createElement('p');
  p.textContent = '音源を読み込みます。読み込んだ音は外部には送信されません。';
  el.appendChild(p);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*';
  el.appendChild(fileInput);

  const status = document.createElement('div');
  status.className = 'placeholder-card';
  el.appendChild(status);

  const controls = document.createElement('div');
  controls.className = 'row-gap';

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'tab-button';
  playBtn.textContent = '再生';

  const pauseBtn = document.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.className = 'tab-button';
  pauseBtn.textContent = '一時停止';

  controls.appendChild(playBtn);
  controls.appendChild(pauseBtn);
  el.appendChild(controls);

  const refreshStatus = (): void => {
    const { audio } = store;
    if (!audio.isLoaded) {
      status.textContent = store.expectedAudio
        ? `音源が読み込まれていません (読み込んだプロジェクトは「${store.expectedAudio.name}」を参照しています)`
        : '音源が読み込まれていません';
      playBtn.disabled = true;
      pauseBtn.disabled = true;
      return;
    }
    const bpmText = audio.bpm > 0 ? `${audio.bpm} BPM` : 'BPM検出できず';
    let text = `${audio.fileName} — ${audio.duration.toFixed(1)}秒 / ${bpmText}`;
    if (store.expectedAudio) {
      text +=
        store.expectedAudio.sha256 === audio.sha256
          ? ' (プロジェクトが参照する音源と一致しました)'
          : ` (注意: プロジェクトが参照する音源「${store.expectedAudio.name}」とは別のファイルです)`;
    }
    status.textContent = text;
    playBtn.disabled = false;
    pauseBtn.disabled = false;
  };
  refreshStatus();

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    status.textContent = '解析中…';
    playBtn.disabled = true;
    pauseBtn.disabled = true;
    store.audio
      .load(file)
      .then(refreshStatus)
      .catch((err: unknown) => {
        status.textContent = `読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`;
      });
  });

  playBtn.addEventListener('click', () => store.audio.play());
  pauseBtn.addEventListener('click', () => store.audio.pause());

  return el;
}
