import {
  EXPORT_FPS_OPTIONS,
  EXPORT_SIZE_PRESETS,
  EXPORT_WARN_MB,
  EXPORT_WARN_MB_MOBILE,
  estimateExportMB,
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
import { buildLyricsView } from '../../core/lyrics/view';
import { sectionCuesFrom } from '../../core/lyrics/section-cues';
import { checkExportSupport } from '../../core/export/support';
import { layoutMode } from '../layout';
import { sizeOptionText } from '../size-select';

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

/**
 * 書き出した動画の保存先。Chrome / Edge は「書き出しを始める」を押したときに保存する場所を選んでもらい、
 * 終わったらそこへ自動で書き込む (2026-10-01 レビューの声「終わったらそのまま保存場所を選ぶ窓を開くといい」)。
 * 終わってから窓を開くことはできない (ブラウザは、押した直後でないと保存の窓を開かせない。長い書き出しのあとでは断られる)。
 * 窓が無いブラウザ (Firefox・Safari など) は、終わったら自動でダウンロードを始める
 */
type SaveTarget = { kind: 'file'; handle: SaveFileHandle } | { kind: 'download' };
interface SaveFileHandle {
  name: string;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}
type SavePicker = (opts: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveFileHandle>;

/** 保存する場所を選んでもらう。やめたら null。窓が使えなければダウンロード */
async function pickSaveTarget(fileName: string): Promise<SaveTarget | null> {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (typeof picker !== 'function') return { kind: 'download' };
  try {
    const handle = await picker.call(window, { suggestedName: fileName, types: [{ description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }] });
    return { kind: 'file', handle };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    return { kind: 'download' };
  }
}

/** 書き出しが終わったあとの保存の結果 (タブを切り替えても出せるように、モジュールに置く) */
let saveNote = '';

/** 書き出した動画を、選んだ場所 (かダウンロード) に保存する */
async function saveResult(target: SaveTarget, blob: Blob, fileName: string): Promise<string> {
  if (target.kind === 'file') {
    try {
      const w = await target.handle.createWritable();
      await w.write(blob);
      await w.close();
      return tr(`「${target.handle.name}」に保存しました。`, `Saved to "${target.handle.name}".`);
    } catch (err) {
      downloadBlob(blob, fileName);
      return tr(
        `選んだ場所に保存できなかったので (${err instanceof Error ? err.message : String(err)})、ダウンロードに保存しました。`,
        `Could not save to the chosen place (${err instanceof Error ? err.message : String(err)}), so it was downloaded instead.`,
      );
    }
  }
  downloadBlob(blob, fileName);
  return tr('ダウンロードに保存しました (ブラウザの設定によっては、保存する場所を聞かれます)。', 'Downloaded (depending on your browser settings, it may ask where to save).');
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
function createRunnerFromStore(): { runner: ExportRunner; fileName: string } {
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
  const background = store.background && store.backgroundFile ? { config: { ...store.background }, file: store.backgroundFile, slideFiles: [...store.slideFiles] } : null;
  const seed = store.seed;
  // 区間の境目は書き出し開始時点の歌詞の見出しで固定する (書き出し中に歌詞を直しても、途中から変わらない)
  const exportTimeline = timeline.withCues(lyrics ? sectionCuesFrom(buildLyricsView(lyrics, timeline.duration).sections) : null);

  const runner: ExportRunner = (ctx) =>
    renderMp4(
      {
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        quality: settings.quality,
        audioBuffer,
        timeline: exportTimeline,
        preset,
        seed,
        params,
        overlays,
        lyrics,
        analysis,
        rhythm,
        background,
        presetImage: preset.manifest.imageSlot ? store.presetImageFile : null,
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
  return { runner, fileName };
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

  // 画面の大きさは上のメニュー (ヘッダーのプルダウン) で選ぶ。ここには今の大きさだけを見せる
  const sizeText = document.createElement('span');
  sizeText.dataset.export = 'size-text';
  const showSize = (): void => {
    const { width, height } = store.exportSettings;
    const p = EXPORT_SIZE_PRESETS.find((x) => x.width === width && x.height === height);
    const hint = document.createElement('span');
    hint.className = 'param-help';
    hint.textContent = tr('上のメニューで選べます', 'Choose it in the top menu');
    sizeText.replaceChildren(p ? sizeOptionText(p) : `${width}×${height}`, hint);
  };
  showSize();
  settingsGrid.appendChild(labeledRow(tr('画面の大きさ', 'Size'), sizeText));

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

  // ファイルの大きさの目安と、大きいときの注意 (書き出しは動画を最後までブラウザのメモリに置くので、長い曲・高画質・スマホでは止まりやすい)
  const sizeNote = document.createElement('div');
  sizeNote.className = 'param-help export-size-note';
  sizeNote.dataset.export = 'size-note';
  const refreshSizeNote = (): void => {
    const s = store.exportSettings;
    const dur = store.audio.isLoaded ? store.audio.duration : 0;
    if (dur <= 0) {
      sizeNote.textContent = '';
      sizeNote.hidden = true;
      return;
    }
    const mb = estimateExportMB(s.width, s.height, s.fps, dur, s.quality);
    const mobile = layoutMode() === 'mobile';
    const limit = mobile ? EXPORT_WARN_MB_MOBILE : EXPORT_WARN_MB;
    const size = mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`;
    const warn = mb > limit;
    sizeNote.hidden = false;
    sizeNote.classList.toggle('export-size-warn', warn);
    sizeNote.textContent =
      tr(`書き出したファイルは約 ${size} になる見込みです (目安)。`, `The exported file will be about ${size} (rough estimate).`) +
      (warn
        ? mobile
          ? tr(' スマホでは、動画を最後まで本体のメモリに置くので、止まることがあります。「画質」を下げる・大きさを 1280×720 にする・30 fps にすると軽くなります。', ' On a phone the video is kept in memory until the end, so it may stop. Lower the quality, use 1280×720 or 30 fps to make it lighter.')
          : tr(' 動画を最後までメモリに置くので、重いときは「画質」や大きさを下げてください。', ' The video is kept in memory until the end; lower the quality or size if it is heavy.')
        : '');
  };
  for (const c of [fpsSelect, qualitySelect]) c.addEventListener('change', refreshSizeNote);
  refreshSizeNote();
  // 上のメニューで大きさが変わったら、ここの表示とファイルの大きさの目安も追従する (パネルが外れたら購読をやめる)
  const unsubscribeSize = store.subscribe(() => {
    if (!sizeText.isConnected) {
      unsubscribeSize();
      return;
    }
    showSize();
    refreshSizeNote();
  });
  el.appendChild(sizeNote);

  // --- 実行・進捗 --------------------------------------------------------
  const prereq = document.createElement('div');
  prereq.className = 'placeholder-card';
  el.appendChild(prereq);

  // 素材の復元忘れで、キャラクターなどが黙って抜けた動画を作らない。
  const missingMedia = () => store.media.filter((m) => !store.getMediaFile(m.id) && !store.composition.hidden.includes(`media:${m.id}`));
  const missingSignature = () => JSON.stringify(missingMedia().map((m) => [m.id, m.ref, m.sha256]));
  let approvedMissing: string | null = null;
  const omitRow = document.createElement('label');
  omitRow.className = 'row-gap param-label';
  const omitCheck = document.createElement('input');
  omitCheck.type = 'checkbox';
  const omitLabel = document.createElement('span');
  omitLabel.textContent = tr('不足している素材を除いて書き出す', 'Export without the missing media');
  omitRow.append(omitCheck, omitLabel);
  el.appendChild(omitRow);

  const controls = document.createElement('div');
  controls.className = 'export-controls';
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'btn-primary btn-large btn-icon-export';
  startBtn.textContent = tr('書き出しを始める', 'Start export');
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = tr('やめる', 'Cancel');
  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'btn-secondary';
  downloadBtn.textContent = tr('もう一度保存する', 'Save again');
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

  const settingControls: HTMLSelectElement[] = [fpsSelect, qualitySelect];

  const render = (status: ExportStatus): void => {
    const running = status.kind === 'running';
    const audioReady = store.audio.isLoaded && store.audio.audioBuffer != null;
    const mediaMissing = missingMedia();
    const signature = missingSignature();
    if (approvedMissing !== signature) approvedMissing = null;
    omitCheck.checked = approvedMissing === signature;
    omitCheck.disabled = running;
    omitRow.style.display = mediaMissing.length > 0 ? '' : 'none';

    const support = checkExportSupport();
    if (!support.ok) {
      // このブラウザには書き出しに必要な機能 (WebCodecs) が無い。始める前に案内する
      prereq.style.display = '';
      prereq.textContent = tr(
        `このブラウザでは MP4 を書き出せません (${support.missing.join('・')} が使えません)。最新の Chrome / Edge で開いてください。プレビューと編集は、このブラウザでも使えます。`,
        `This browser cannot export MP4 (${support.missing.join(', ')} is not available). Please open this page in the latest Chrome or Edge. Preview and editing still work here.`,
      );
    } else if (!audioReady) {
      prereq.style.display = '';
      prereq.textContent = tr('曲が読み込まれていません。「音楽」タブで曲を読み込むと書き出せます。', 'No song loaded. Load one in the Music tab to export.');
    } else {
      const missing = store.overlays.filter((o) => !store.getOverlayFile(o.id)).length;
      const bgMissing = store.background != null && store.backgroundFile == null;
      const imgSlot = visualizerRegistry.get(store.presetId ?? '')?.manifest.imageSlot;
      const imgMissing = imgSlot != null && store.presetImage != null && store.presetImageFile == null;
      const notes = [
        mediaMissing.length > 0 ? tr(`まだ選び直していない素材が ${mediaMissing.length} 個あります: ${mediaMissing.map((m) => m.ref).join('、')}。「背景と素材」タブで選び直すか、不足した素材を除いて書き出す場合は下のチェックを入れてください。`, `${mediaMissing.length} media file(s) have not been picked again: ${mediaMissing.map((m) => m.ref).join(', ')}. Pick them in Background & Media, or check below to export without them.`) : '',
        imgMissing ? tr(`ビジュアライザーの画像「${store.presetImage!.ref}」をまだ選び直していません (「ビジュアライザー」タブ)。画像なしで書き出します。`, `The visualizer image "${store.presetImage!.ref}" has not been picked again (Visualizer tab). Exporting without it.`) : '',
        missing > 0 ? tr(`まだ選び直していない重ねる画像が ${missing} 個あります (「背景と素材」タブ)。それらは書き出しに入りません。`, `${missing} overlay image(s) have not been picked again (Overlay tab) and will be left out.`) : '',
        bgMissing ? tr(`背景「${store.background!.ref}」をまだ選び直していません (「背景と素材」タブ)。背景なしで書き出します。`, `The background "${store.background!.ref}" has not been picked again (Overlay tab). Exporting without it.`) : '',
      ].filter(Boolean);
      prereq.style.display = notes.length > 0 ? '' : 'none';
      prereq.textContent = notes.join(' ');
    }

    startBtn.disabled = running || !audioReady || !support.ok || (mediaMissing.length > 0 && approvedMissing !== signature);
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
          `${result.frames} ${tr('コマ', 'frames')}, ${formatBytes(result.blob.size)}, ${formatDuration(elapsedMs)})` +
          (saveNote ? ` ${saveNote}` : '');
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

  omitCheck.addEventListener('change', () => {
    approvedMissing = omitCheck.checked ? missingSignature() : null;
    render(exportController.status);
  });

  startBtn.addEventListener('click', () => {
    if (missingMedia().length > 0 && approvedMissing !== missingSignature()) {
      render(exportController.status);
      return;
    }
    let job: { runner: ExportRunner; fileName: string };
    try {
      job = createRunnerFromStore();
    } catch (err) {
      statusText.textContent = err instanceof Error ? err.message : String(err);
      return;
    }
    // 押した直後に保存する場所を選んでもらう (終わってからでは、ブラウザが保存の窓を開かせない)
    void (async () => {
      const target = await pickSaveTarget(job.fileName);
      if (!target) {
        statusText.textContent = tr('保存する場所を選ばなかったので、書き出しを始めませんでした。', 'No save location was chosen, so the export was not started.');
        return;
      }
      saveNote = '';
      // 状態の変化は subscribe 経由で render() に届く。終わったら、タブを切り替えていても保存する
      await exportController.start(job.runner);
      const status = exportController.status;
      if (status.kind !== 'done') return;
      saveNote = tr('保存しています…', 'Saving…');
      exportController.notify();
      saveNote = await saveResult(target, status.result.blob, status.result.fileName);
      exportController.notify();
    })();
  });

  cancelBtn.addEventListener('click', () => exportController.cancel());

  // もう一度保存する (別の場所にも残したいとき。押した直後なので保存の窓を開ける)
  downloadBtn.addEventListener('click', () => {
    const status = exportController.status;
    if (status.kind !== 'done') return;
    void (async () => {
      const target = await pickSaveTarget(status.result.fileName);
      if (!target) return;
      saveNote = await saveResult(target, status.result.blob, status.result.fileName);
      exportController.notify();
    })();
  });

  // shell.ts はタブ切り替えで body を丸ごと差し替えるだけなので、DOM から外れた時点で購読をやめる
  const unsubscribe = exportController.subscribe(() => {
    if (!el.isConnected) {
      unsubscribe();
      return;
    }
    render(exportController.status);
  });
  const unsubscribeStore = store.subscribe(() => {
    if (!el.isConnected) {
      unsubscribeStore();
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
