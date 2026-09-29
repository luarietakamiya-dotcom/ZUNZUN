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
import type { CommonParams, ExportSettings, OverlayLayer } from '../../core/types';
import { visualizerRegistry } from '../../visualizers';

const QUALITY_OPTIONS: { value: ExportSettings['quality']; label: string }[] = [
  { value: 'draft', label: 'ドラフト (軽量・確認用)' },
  { value: 'high', label: '高画質 (標準)' },
  { value: 'max', label: '最高画質 (ファイル大)' },
];

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
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
  if (!audioBuffer || !timeline) throw new Error('音源が読み込まれていません (Music タブで読み込んでください)');

  const presetId = store.presetId ?? visualizerRegistry.list()[0]?.id ?? '';
  const preset = visualizerRegistry.get(presetId);
  if (!preset) throw new Error('プリセットが選ばれていません (Visualizer タブで選んでください)');

  const settings = { ...store.exportSettings };
  const params = { ...store.params } as CommonParams & Record<string, unknown>;
  const overlays = store.overlays
    .map((config) => ({ config: { ...config }, file: store.getOverlayFile(config.id) }))
    .filter((e): e is { config: OverlayLayer; file: File } => e.file != null);
  const fileName = suggestExportFileName(audio.fileName, preset.manifest.id);
  // 歌詞: 書き出し開始時点の設定を複製して渡す (書き出し中に Lyrics タブで直しても影響しない)
  const lyrics = store.lyrics ? (JSON.parse(JSON.stringify(store.lyrics)) as typeof store.lyrics) : null;
  const analysis = audio.analysis;
  const rhythm = store.rhythm ? (JSON.parse(JSON.stringify(store.rhythm)) as typeof store.rhythm) : null;
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
        fileName,
      },
      ctx,
    );
}

export function renderExportPanel(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel';

  const h2 = document.createElement('h2');
  h2.textContent = 'Export';
  el.appendChild(h2);

  const p = document.createElement('p');
  p.textContent =
    '現在の音源・プリセット・パラメータ・オーバーレイで、曲の頭から最後までを MP4 (H.264 + AAC) に書き出します。' +
    '処理はすべてこのブラウザの中で行われ、外部には送信されません。書き出し中に別のタブへ移動しても処理は続きます。';
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
    opt.textContent = preset.label;
    sizeSelect.appendChild(opt);
  }
  const currentSize = EXPORT_SIZE_PRESETS.find(
    (s) => s.width === store.exportSettings.width && s.height === store.exportSettings.height,
  );
  if (!currentSize) {
    // プロジェクトから一覧に無いサイズが読み込まれた場合も、そのサイズのまま選べるようにする
    const opt = document.createElement('option');
    opt.value = 'custom';
    opt.textContent = `${store.exportSettings.width}×${store.exportSettings.height} (プロジェクトの設定)`;
    sizeSelect.appendChild(opt);
  }
  sizeSelect.value = currentSize?.id ?? 'custom';
  sizeSelect.addEventListener('change', () => {
    const preset = EXPORT_SIZE_PRESETS.find((s) => s.id === sizeSelect.value);
    if (preset) store.setExportSettings({ width: preset.width, height: preset.height });
  });
  settingsGrid.appendChild(labeledRow('サイズ', sizeSelect));

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
  settingsGrid.appendChild(labeledRow('フレームレート', fpsSelect));

  const qualitySelect = document.createElement('select');
  qualitySelect.className = 'select';
  for (const q of QUALITY_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = q.value;
    opt.textContent = q.label;
    qualitySelect.appendChild(opt);
  }
  qualitySelect.value = store.exportSettings.quality;
  qualitySelect.addEventListener('change', () =>
    store.setExportSettings({ quality: qualitySelect.value as ExportSettings['quality'] }),
  );
  settingsGrid.appendChild(labeledRow('画質', qualitySelect));

  const formatInfo = document.createElement('span');
  formatInfo.className = 'select';
  formatInfo.textContent = 'MP4 (H.264 + AAC)';
  settingsGrid.appendChild(labeledRow('形式 (WebM / PNG連番は今後対応)', formatInfo));

  // --- 実行・進捗 --------------------------------------------------------
  const prereq = document.createElement('div');
  prereq.className = 'placeholder-card';
  el.appendChild(prereq);

  const controls = document.createElement('div');
  controls.className = 'row-gap';
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'tab-button';
  startBtn.textContent = '書き出し開始';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'tab-button';
  cancelBtn.textContent = 'キャンセル';
  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'tab-button';
  downloadBtn.textContent = 'MP4 をダウンロード';
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
      prereq.textContent = '音源が読み込まれていません。Music タブで音源を読み込むと書き出せます。';
    } else {
      const missing = store.overlays.filter((o) => !store.getOverlayFile(o.id)).length;
      prereq.style.display = missing > 0 ? '' : 'none';
      prereq.textContent =
        missing > 0
          ? `画像がまだ選び直されていないオーバーレイが ${missing} 個あります (Overlay タブ)。それらは書き出しに含まれません。`
          : '';
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
          statusText.textContent = '準備中… (エンコーダの確認・プリセットの初期化)';
        } else {
          const elapsed = performance.now() - status.startedAt;
          const remaining = estimateRemainingMs(elapsed, status.done, status.total);
          const pct = ((status.done / status.total) * 100).toFixed(1);
          statusText.textContent =
            `${status.done} / ${status.total} フレーム (${pct}%) — 経過 ${formatDuration(elapsed)}` +
            (remaining != null ? ` / 残り約 ${formatDuration(remaining)}` : '');
        }
        break;
      }
      case 'done': {
        progress.style.display = '';
        progress.max = 1;
        progress.value = 1;
        const { result, elapsedMs } = status;
        statusText.textContent =
          `書き出し完了: ${result.fileName} (${result.videoCodec} / ${result.audioCodec}, ` +
          `${result.frames} フレーム, ${formatBytes(result.blob.size)}, ${formatDuration(elapsedMs)})`;
        break;
      }
      case 'cancelled':
        progress.style.display = 'none';
        statusText.textContent = '書き出しをキャンセルしました。';
        break;
      case 'error':
        progress.style.display = 'none';
        statusText.textContent = `書き出しに失敗しました: ${status.message}`;
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
