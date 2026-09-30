import {
  EXPORT_FPS_OPTIONS,
  EXPORT_SIZE_PRESETS,
  estimateRemainingMs,
  exportController,
  renderMp4,
  suggestExportFileName,
  type ExportRunner,
  type ExportStatus,
} from '../../core/export';
import { store } from '../../core/store';
import { resolvePresetParams } from '../../core/visualizer/preset-params';
import { t2, tr, type Text2 } from '../../core/i18n';
import type { CommonParams, ExportSettings, OverlayLayer } from '../../core/types';
import { visualizerRegistry } from '../../visualizers';

const QUALITY_OPTIONS: { value: ExportSettings['quality']; label: Text2 }[] = [
  { value: 'draft', label: { ja: '下書き (軽い・確認用)', en: 'Draft (small, for checking)' } },
  { value: 'high', label: { ja: '高画質 (ふつうはこれ)', en: 'High (standard)' } },
  { value: 'max', label: { ja: '最高画質 (ファイルが大きい)', en: 'Max (large file)' } },
];

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? tr(`${m}分${s}秒`, `${m}m ${s}s`) : tr(`${s}秒`, `${s}s`);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // クリック直後に revoke すると一部ブラウザでダウンロードが始まらないため、少し待ってから解放する
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function labeledRow(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('label');
  row.className = 'param-row';
  const span = document.createElement('span');
  span.className = 'param-label';
  span.textContent = label;
  row.appendChild(span);
  row.appendChild(control);
  return row;
}

/**
 * 書き出し開始時点の store の状態から runner を作る。
 * 書き出し中に他のタブでパラメータを触っても、書き出し結果には影響しない (スナップショットを使う)。
 */
function createRunnerFromStore(): ExportRunner {
  const audio = store.audio;
  const audioBuffer = audio.audioBuffer;
  const timeline = audio.timeline;
  if (!audioBuffer || !timeline) throw new Error(tr('曲が読み込まれていません (「音楽」タブで読み込んでください)', 'No song loaded (load one in the Music tab)'));

  const presetId = store.presetId ?? visualizerRegistry.list()[0]?.id ?? '';
  const preset = visualizerRegistry.get(presetId);
  if (!preset) throw new Error(tr('映像の種類が選ばれていません (「ビジュアライザー」タブで選んでください)', 'No visual preset selected (choose one in the Visualizer tab)'));

  const settings = { ...store.exportSettings };
  // 共通の設定 + このビジュアライザーだけの設定
  const params = { ...store.params, ...resolvePresetParams(preset.manifest.controls, store.presetParams(preset.manifest.id)) } as CommonParams & Record<string, unknown>;
  const overlays = store.overlays
    .map((config) => ({ config: { ...config }, file: store.getOverlayFile(config.id) }))
    .filter((e): e is { config: OverlayLayer; file: File } => e.file != null);
  const fileName = suggestExportFileName(audio.fileName, preset.manifest.id);
  // 歌詞: 書き出し開始時点の設定を複製して渡す (書き出し中に Lyrics タブで直しても影響しない)
  const lyrics = store.lyrics ? (JSON.parse(JSON.stringify(store.lyrics)) as typeof store.lyrics) : null;
  const analysis = audio.analysis;
  const rhythm = store.rhythm ? (JSON.parse(JSON.stringify(store.rhythm)) as typeof store.rhythm) : null;
  const background = store.background && store.backgroundFile ? { config: { ...store.background }, file: store.backgroundFile } : null;
  const seed = store.seed;

  return (ctx) =>
    renderMp4(
      {
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        quality: settings.quality,
        audioBuffer,
        timeline,
        preset,
        seed,
        params,
        overlays,
        lyrics,
        analysis,
        rhythm,
        background,
        view: { ...store.view },
        composition: JSON.parse(JSON.stringify(store.composition)),
        media: store.media.flatMap((m) => {
          const file = store.getMediaFile(m.id);
          return file ? [{ config: { ...m, chroma: { ...m.chroma } }, file }] : [];
        }),
        fileName,
      },
      ctx,
    );
}

export function renderExportPanel(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel';

  const h2 = document.createElement('h2');
  h2.textContent = tr('書き出し', 'Export');
  el.appendChild(h2);

  const p = document.createElement('p');
  p.textContent =
    tr(
      '今の曲・映像・設定・歌詞・背景・重ねた画像で、曲の最初から最後までを動画ファイル (MP4、H.264 + AAC) にします。処理はすべてこのブラウザの中で行い、ほかの場所へは送りません。書き出し中に別のタブへ移っても続きます。',
      'Renders the whole song with the current song, visuals, settings, lyrics, background and overlays to a video file (MP4, H.264 + AAC). Everything runs inside this browser and nothing is uploaded. Switching tabs does not stop the export.',
    );
  el.appendChild(p);

  // --- 設定 -------------------------------------------------------------
  const settingsGrid = document.createElement('div');
  settingsGrid.className = 'param-grid';
  el.appendChild(settingsGrid);

  const sizeSelect = document.createElement('select');
  sizeSelect.className = 'select';
  for (const preset of EXPORT_SIZE_PRESETS) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = t2(preset.label);
    sizeSelect.appendChild(opt);
  }
  const currentSize = EXPORT_SIZE_PRESETS.find(
    (s) => s.width === store.exportSettings.width && s.height === store.exportSettings.height,
  );
  if (!currentSize) {
    // プロジェクトから一覧に無いサイズが読み込まれた場合も、そのサイズのまま選べるようにする
    const opt = document.createElement('option');
    opt.value = 'custom';
    opt.textContent = `${store.exportSettings.width}×${store.exportSettings.height} ${tr('(プロジェクトの設定)', '(project setting)')}`;
    sizeSelect.appendChild(opt);
  }
  sizeSelect.value = currentSize?.id ?? 'custom';
  sizeSelect.addEventListener('change', () => {
    const preset = EXPORT_SIZE_PRESETS.find((s) => s.id === sizeSelect.value);
    if (preset) store.setExportSettings({ width: preset.width, height: preset.height });
  });
  settingsGrid.appendChild(labeledRow(tr('画面の大きさ', 'Size'), sizeSelect));

  const fpsSelect = document.createElement('select');
  fpsSelect.className = 'select';
  const fpsChoices = EXPORT_FPS_OPTIONS.includes(store.exportSettings.fps)
    ? EXPORT_FPS_OPTIONS
    : [...EXPORT_FPS_OPTIONS, store.exportSettings.fps];
  for (const fps of fpsChoices) {
    const opt = document.createElement('option');
    opt.value = String(fps);
    opt.textContent = `${fps} fps`;
    fpsSelect.appendChild(opt);
  }
  fpsSelect.value = String(store.exportSettings.fps);
  fpsSelect.addEventListener('change', () => store.setExportSettings({ fps: parseInt(fpsSelect.value, 10) }));
  settingsGrid.appendChild(labeledRow(tr('なめらかさ (1 秒あたりのコマ数)', 'Frame rate (frames per second)'), fpsSelect));

  const qualitySelect = document.createElement('select');
  qualitySelect.className = 'select';
  for (const q of QUALITY_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = q.value;
    opt.textContent = t2(q.label);
    qualitySelect.appendChild(opt);
  }
  qualitySelect.value = store.exportSettings.quality;
  qualitySelect.addEventListener('change', () =>
    store.setExportSettings({ quality: qualitySelect.value as ExportSettings['quality'] }),
  );
  settingsGrid.appendChild(labeledRow(tr('画質', 'Quality'), qualitySelect));

  const formatInfo = document.createElement('span');
  formatInfo.className = 'select';
  formatInfo.textContent = 'MP4 (H.264 + AAC)';
  settingsGrid.appendChild(labeledRow(tr('ファイルの形式 (WebM・連番の画像は今後対応)', 'Format (WebM / image sequence coming later)'), formatInfo));

  // --- 実行・進捗 --------------------------------------------------------
  const prereq = document.createElement('div');
  prereq.className = 'placeholder-card';
  el.appendChild(prereq);

  const controls = document.createElement('div');
  controls.className = 'row-gap';
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'tab-button';
  startBtn.textContent = tr('書き出しを始める', 'Start export');
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'tab-button';
  cancelBtn.textContent = tr('やめる', 'Cancel');
  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'tab-button';
  downloadBtn.textContent = tr('MP4 を保存する', 'Download MP4');
  controls.appendChild(startBtn);
  controls.appendChild(cancelBtn);
  controls.appendChild(downloadBtn);
  el.appendChild(controls);

  const progress = document.createElement('progress');
  progress.className = 'export-progress';
  progress.max = 1;
  progress.value = 0;
  el.appendChild(progress);

  const statusText = document.createElement('div');
  statusText.className = 'export-status';
  el.appendChild(statusText);

  const settingControls: HTMLSelectElement[] = [sizeSelect, fpsSelect, qualitySelect];

  const render = (status: ExportStatus): void => {
    const running = status.kind === 'running';
    const audioReady = store.audio.isLoaded && store.audio.audioBuffer != null;

    if (!audioReady) {
      prereq.style.display = '';
      prereq.textContent = tr('曲が読み込まれていません。「音楽」タブで曲を読み込むと書き出せます。', 'No song loaded. Load one in the Music tab to export.');
    } else {
      const missing = store.overlays.filter((o) => !store.getOverlayFile(o.id)).length;
      const bgMissing = store.background != null && store.backgroundFile == null;
      const notes = [
        missing > 0 ? tr(`まだ選び直していない重ねる画像が ${missing} 個あります (「背景と素材」タブ)。それらは書き出しに入りません。`, `${missing} overlay image(s) have not been picked again (Overlay tab) and will be left out.`) : '',
        bgMissing ? tr(`背景「${store.background!.ref}」をまだ選び直していません (「背景と素材」タブ)。背景なしで書き出します。`, `The background "${store.background!.ref}" has not been picked again (Overlay tab). Exporting without it.`) : '',
      ].filter(Boolean);
      prereq.style.display = notes.length > 0 ? '' : 'none';
      prereq.textContent = notes.join(' ');
    }

    startBtn.disabled = running || !audioReady;
    cancelBtn.disabled = !running;
    downloadBtn.style.display = status.kind === 'done' ? '' : 'none';
    for (const c of settingControls) c.disabled = running;

    switch (status.kind) {
      case 'idle':
        progress.style.display = 'none';
        statusText.textContent = '';
        break;
      case 'running': {
        progress.style.display = '';
        progress.max = Math.max(1, status.total);
        progress.value = status.done;
        if (status.total === 0) {
          statusText.textContent = tr('準備しています… (動画を作る機能の確認・映像の用意)', 'Preparing… (checking the encoder, setting up the visuals)');
        } else {
          const elapsed = performance.now() - status.startedAt;
          const remaining = estimateRemainingMs(elapsed, status.done, status.total);
          const pct = ((status.done / status.total) * 100).toFixed(1);
          statusText.textContent =
            `${status.done} / ${status.total} ${tr('コマ', 'frames')} (${pct}%) — ${tr('経過', 'elapsed')} ${formatDuration(elapsed)}` +
            (remaining != null ? ` / ${tr('残り約', 'about')} ${formatDuration(remaining)}${tr('', ' left')}` : '');
        }
        break;
      }
      case 'done': {
        progress.style.display = '';
        progress.max = 1;
        progress.value = 1;
        const { result, elapsedMs } = status;
        statusText.textContent =
          `${tr('書き出しが終わりました', 'Export finished')}: ${result.fileName} (${result.videoCodec} / ${result.audioCodec}, ` +
          `${result.frames} ${tr('コマ', 'frames')}, ${formatBytes(result.blob.size)}, ${formatDuration(elapsedMs)})`;
        break;
      }
      case 'cancelled':
        progress.style.display = 'none';
        statusText.textContent = tr('書き出しをやめました。', 'Export cancelled.');
        break;
      case 'error':
        progress.style.display = 'none';
        statusText.textContent = `${tr('書き出しに失敗しました', 'Export failed')}: ${status.message}`;
        break;
    }
  };

  startBtn.addEventListener('click', () => {
    let runner: ExportRunner;
    try {
      runner = createRunnerFromStore();
    } catch (err) {
      statusText.textContent = err instanceof Error ? err.message : String(err);
      return;
    }
    // 状態の変化は subscribe 経由で render() に届くので、ここでは完了を待つだけ
    void exportController.start(runner);
  });

  cancelBtn.addEventListener('click', () => exportController.cancel());

  downloadBtn.addEventListener('click', () => {
    const status = exportController.status;
    if (status.kind === 'done') downloadBlob(status.result.blob, status.result.fileName);
  });

  // shell.ts はタブ切り替えで body を丸ごと差し替えるだけなので、DOM から外れた時点で購読をやめる
  const unsubscribe = exportController.subscribe(() => {
    if (!el.isConnected) {
      unsubscribe();
      return;
    }
    render(exportController.status);
  });

  // running 中は「経過時間/残り時間」を進捗イベントが来ない間も更新する
  const timer = setInterval(() => {
    if (!el.isConnected) {
      clearInterval(timer);
      return;
    }
    if (exportController.status.kind === 'running') render(exportController.status);
  }, 1000);

  render(exportController.status);
  return el;
}
