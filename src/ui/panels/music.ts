import { store } from '../../core/store';
import { t2, tr } from '../../core/i18n';
import { energyWord, pickOmakase, songFeatures, type OmakaseResult } from '../../core/auto/omakase';
import { defaultLyrics } from '../../core/types';
import { visualizerRegistry } from '../../visualizers';
import { anyFileButton, AUDIO_ACCEPT } from './panel-helpers';

/** 「別のおまかせ」で今何番目か (タブを切り替えても保つ。曲が変わったら 0 から) */
let omakaseIndex = 0;
let omakaseSong = '';

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

  // おまかせで作る (2026-10-04 UI 刷新の段階 5): 曲に合わせて、映像と歌詞のスタイルを 1 クリックで選ぶ
  const omakase = document.createElement('div');
  omakase.className = 'omakase-card';
  omakase.dataset.omakase = 'card';
  const omTitle = document.createElement('h3');
  omTitle.textContent = tr('おまかせで作る', 'Make it for me');
  const omText = document.createElement('p');
  omText.className = 'param-help';
  omText.textContent = tr('曲のテンポ・激しさ・音の高さから、映像の種類と歌詞のスタイルを選びます。あとから手で変えられます。', 'Picks the visuals and lyric style from the tempo, intensity and pitch of the song. You can change them by hand afterwards.');
  const omGo = document.createElement('button');
  omGo.type = 'button';
  omGo.className = 'btn-primary btn-large omakase-go';
  omGo.dataset.omakase = 'go';
  omGo.textContent = tr('おまかせで作る', 'Make it for me');
  const omResult = document.createElement('div');
  omResult.className = 'omakase-result';
  omResult.dataset.omakase = 'result';
  omResult.hidden = true;
  const omRow = document.createElement('div');
  omRow.className = 'omakase-actions';
  const omNext = document.createElement('button');
  omNext.type = 'button';
  omNext.className = 'btn-secondary';
  omNext.dataset.omakase = 'next';
  omNext.textContent = tr('別のおまかせ', 'Another one');
  const omView = document.createElement('button');
  omView.type = 'button';
  omView.className = 'btn-secondary';
  omView.dataset.omakase = 'view';
  omView.textContent = tr('映像を見る', 'See the visuals');
  omRow.append(omNext, omView);
  omakase.append(omTitle, omText, omGo, omResult, omRow);
  omRow.hidden = true;
  el.insertBefore(omakase, playBtn);

  const applyOmakase = (index: number): void => {
    const analysis = store.audio.analysis;
    if (!analysis) return;
    const available = visualizerRegistry.list().map((m) => m.id);
    const features = songFeatures(analysis);
    const r: OmakaseResult | null = pickOmakase(features, index, { hasBackground: store.background != null, availablePresets: available });
    if (!r) return;
    omakaseIndex = index;
    omakaseSong = store.audio.sha256;
    // 映像の種類: 手で選んだ設定の値は変えない (種類だけ替える)
    store.setPresetId(r.presetId);
    // 歌詞のスタイル: 歌詞を入れてあるときだけ (入れていない歌詞の設定を勝手に作らない)
    const lyrics = store.lyrics;
    const hasLyrics = lyrics != null && lyrics.text.trim().length > 0;
    if (hasLyrics) {
      const base = lyrics ?? defaultLyrics();
      store.setLyrics({ ...base, motion: { ...base.motion, enabled: true, style: r.lyricStyle, custom: null } });
    }
    const name = visualizerRegistry.get(r.presetId)?.manifest.name ?? r.presetId;
    const word = energyWord(r.features.energy);
    omResult.hidden = false;
    omResult.replaceChildren();
    const line1 = document.createElement('div');
    line1.className = 'omakase-line';
    line1.textContent = `${tr('映像', 'Visuals')}: ${name}`;
    const line2 = document.createElement('div');
    line2.className = 'omakase-line';
    line2.textContent = hasLyrics ? `${tr('歌詞のスタイル', 'Lyric style')}: ${t2(r.lyricStyleName)}` : tr('歌詞のスタイル: 歌詞を入れると、ここで選びます (「歌詞」タブ)', 'Lyric style: picked here once you add lyrics (Lyrics tab)');
    const line3 = document.createElement('div');
    line3.className = 'param-help';
    line3.textContent = tr(
      `曲の印象: ${Math.round(r.features.bpm)} BPM・${word.ja}・${r.features.bass > 0.55 ? '低音が強い' : r.features.tone > 0.6 ? '音が明るい' : '落ち着いた音'}`,
      `Impression: ${Math.round(r.features.bpm)} BPM, ${word.en}, ${r.features.bass > 0.55 ? 'bass-heavy' : r.features.tone > 0.6 ? 'bright' : 'mellow'}`,
    );
    omResult.append(line1, line2, line3);
    omRow.hidden = false;
  };
  omGo.addEventListener('click', () => applyOmakase(omakaseSong === store.audio.sha256 ? omakaseIndex : 0));
  omNext.addEventListener('click', () => applyOmakase(omakaseIndex + 1));
  omView.addEventListener('click', () => {
    // 映像を見る: PC は「ビジュアライザー」タブ、スマホは「映像」メニューを開く
    const pc = document.querySelector<HTMLButtonElement>('button[data-panel="visualizer"]');
    if (pc) pc.click();
    else document.querySelector<HTMLButtonElement>('.m-nav-button[data-menu="visual"]')?.click();
  });

  const refreshStatus = (): void => {
    const { audio } = store;
    if (!audio.isLoaded) {
      status.textContent = store.expectedAudio
        ? tr(`曲がまだ読み込まれていません (開いたプロジェクトは「${store.expectedAudio.name}」を使っています。同じファイルを選んでください)`, `No song loaded yet (the opened project uses "${store.expectedAudio.name}" — please pick that file)`)
        : tr('曲がまだ読み込まれていません', 'No song loaded yet');
      playBtn.disabled = true;
      omGo.disabled = true;
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
    omGo.disabled = false;
  };
  refreshStatus();

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    status.textContent = tr('曲を調べています…', 'Analyzing the song…');
    playBtn.disabled = true;
    omGo.disabled = true;
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
