import { BAND_COUNT } from '../../core/audio';
import { slidePlan, slidePlanKey } from '../../core/render/slideshow';
import { store } from '../../core/store';
import type { AudioFrame, BackgroundSettings, CommonParams, OverlayLayer } from '../../core/types';
import { VisualizerHost } from '../../core/visualizer/host';
import { resolvePresetParams } from '../../core/visualizer/preset-params';
import { visualizerRegistry } from '../../visualizers';
import { layoutMode, MOBILE_PREVIEW_PIXEL_RATIO } from '../layout';
import { previewMotionNow } from './motion-apply';

/**
 * 映像のプレビュー (ビジュアライザー・背景・素材・歌詞・重ねる画像を、書き出しと同じ順で重ねる)。
 * 「ビジュアライザー」タブと「背景と素材」タブ (2026-10-01 「グリーンバックの素材をプレビューを見ながら調整したい」) で使う。
 * 設定は毎フレーム store から読む。ファイル (背景・素材・重ねる画像) が変わったときだけ読み込み直し、
 * 位置や暗さなどの設定だけの変化は読み込み直さずに当てる (つまみを動かしても重くならないように)。
 * パネルが画面から外れたら (タブを切り替えたら) 自分で片づける (shell.ts にはタブを外すときの合図が無いため)。
 */

/** 音源未読み込みのとき、プリセットが動いているのを確認できるようにするダミーの AudioFrame。 */
function syntheticIdleFrame(t: number, prevT: number): AudioFrame {
  const bands = new Float32Array(BAND_COUNT);
  for (let i = 0; i < BAND_COUNT; i++) bands[i] = 0.08 + 0.05 * Math.sin(t * 1.3 + i * 0.35);
  return {
    t,
    dt: t - prevT,
    bass: 0.15,
    mid: 0.12,
    high: 0.1,
    rms: 0.1,
    peak: 0.15,
    beat: Math.max(0, Math.sin(t * 2)) ** 8,
    beatIndex: -1,
    spectralEnergy: 0.1,
    flux: 0,
    bands,
  };
}

/** 共通の設定 + 今のビジュアライザーだけの設定 (プリセットの update() に渡す) */
export function renderParamsNow(): CommonParams & Record<string, unknown> {
  const id = store.presetId ?? '';
  return { ...store.params, ...resolvePresetParams(visualizerRegistry.get(id)?.manifest.controls, store.presetParams(id)) };
}

/** 背景を読み込み直す要る変化か (ファイル・種類・ぼかし・スライドショーの画像の並び) を見分けるキー */
function backgroundLoadKey(bg: BackgroundSettings | null, file: File | null, slideFiles: readonly (File | null)[]): unknown[] {
  return [bg?.ref, bg?.sha256, bg?.kind, bg?.blur, bg?.slides?.items, file, ...slideFiles];
}
const sameKey = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

export interface LivePreview {
  element: HTMLElement;
  host: VisualizerHost;
}

/** onFrame: 毎フレーム、描く前に呼ぶ (パネルごとの表示の更新用) */
export function createLivePreview(opts: { onFrame?: () => void } = {}): LivePreview {
  const wrap = document.createElement('div');
  wrap.className = 'visualizer-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'visualizer-canvas';
  wrap.appendChild(canvas);
  // 歌詞モーションはプレビューでは軽く描く (書き出しでは全部描く)
  // スマホ表示のプレビューは小さいので、描く解像度は 1.5 倍までにする (スマホは画面の密度が 2〜3 倍で、min(2, 密度) だと
  // 小さい画面にしては 4 倍の画素を毎フレーム描くことになり、重く・電池も使う。1 倍だと細い線 (Solar Gate の輪など) が
  // 階段状に見えたので 1.5 倍。画素は 2 倍の約 56%。2026-10-03 スマホ表示 M4)。書き出しは別の Host で影響しない
  const host = new VisualizerHost(canvas, { fastLyrics: true, ...(layoutMode() === 'mobile' ? { pixelRatio: Math.min(MOBILE_PREVIEW_PIXEL_RATIO, window.devicePixelRatio || 1) } : {}) });

  // ビジュアライザーの種類 (store の presetId に合わせる)
  let presetId = '';
  const syncPreset = (): void => {
    const id = store.presetId ?? visualizerRegistry.list()[0]?.id ?? '';
    if (id === presetId) return;
    const mod = visualizerRegistry.get(id);
    if (!mod) return;
    presetId = id;
    void host.setPreset(mod, store.seed, renderParamsNow());
  };

  // プリセットに渡す画像 (ファイルが変わったときだけ読み込み直す)
  let imageFile: File | null | undefined;
  const syncPresetImage = (): void => {
    const f = store.presetImageFile;
    if (f === imageFile) return;
    imageFile = f;
    void host.setPresetImage(f).catch(() => {});
  };

  // 背景 (ファイルが変わったときだけ読み込み直す。暗さなどは設定だけ当てる)
  let bgKey: unknown[] = [Symbol('none')];
  let bgSettings: BackgroundSettings | null = null;
  let libraryAsked = false;
  const syncBackground = (): void => {
    const bg = store.background;
    const key = backgroundLoadKey(bg, store.backgroundFile, store.slideFiles);
    if (!sameKey(key, bgKey)) {
      bgKey = key;
      bgSettings = bg;
      slideKey = '';
      void host.background.load(bg, store.backgroundFile, { slideFiles: store.slideFiles }).catch(() => {});
      // 用意された背景 (core/library.ts) をプロジェクトを開いたあとに読み込み中なら、読めたところで当たる (キーが変わる)
      if (bg && !store.backgroundFile && !libraryAsked) {
        libraryAsked = true;
        store.restoreLibraryBackground().catch(() => {});
      }
    } else if (bg && bg !== bgSettings) {
      bgSettings = bg;
      host.background.updateSettings(bg);
    }
  };

  // スライドショーの切り替え表 (歌詞の区切り・拍・枚数から。材料が変わったときだけ作り直す)
  let slideKey = '';
  const syncSlides = (): void => {
    const slides = store.background?.slides;
    if (!slides || !store.audio.isLoaded) return;
    const input = {
      names: slides.items.map((it) => it.ref),
      pace: slides.pace,
      lyrics: store.lyrics,
      beats: store.audio.analysis?.beats ?? [],
      rhythm: store.rhythm,
      duration: store.audio.duration,
    };
    const key = slidePlanKey(input);
    if (key === slideKey) return;
    slideKey = key;
    host.background.setSlideCues(slidePlan(input), input.beats);
  };

  // 素材レイヤー・重ねる画像 (ファイルを選び直していないものは飛ばす。ファイルが変わったときだけ読み込み直す)
  let mediaKey: unknown[] = [Symbol('none')];
  const syncMedia = (): void => {
    const entries = store.media.flatMap((m) => {
      const file = store.getMediaFile(m.id);
      return file ? [{ config: m, file }] : [];
    });
    const key = entries.flatMap((e) => [e.config.id, e.config.kind, e.config.loop, e.file]);
    if (!sameKey(key, mediaKey)) {
      mediaKey = key;
      void host.media.load(entries);
    }
    host.media.setConfigs(store.media);
    host.media.setMatteView(store.chromaPreviewId);
  };
  let overlayKey: unknown[] = [Symbol('none')];
  const syncOverlays = (): void => {
    const entries = store.overlays
      .map((config) => ({ config, file: store.getOverlayFile(config.id) }))
      .filter((e): e is { config: OverlayLayer; file: File } => e.file != null);
    const key = entries.flatMap((e) => [e.config.id, e.file]);
    if (!sameKey(key, overlayKey)) {
      overlayKey = key;
      host.overlay.clear();
      void host.overlay.loadFrom(entries);
    }
    host.overlay.setConfigs(store.overlays);
  };

  const resizeObserver = new ResizeObserver(() => {
    const rect = wrap.getBoundingClientRect();
    host.resize(rect.width, rect.height);
  });
  resizeObserver.observe(wrap);

  let prevT = performance.now() / 1000;
  let mounted = false;
  const tick = (): void => {
    if (!canvas.isConnected) {
      // まだ画面に載る前 (作った直後) は待つ。載ったあとに外れたら (タブを切り替えたら) 片づける
      if (mounted) {
        resizeObserver.disconnect();
        host.dispose();
        return;
      }
      requestAnimationFrame(tick);
      return;
    }
    mounted = true;
    opts.onFrame?.();
    syncPreset();
    syncBackground();
    syncPresetImage();
    syncSlides();
    syncMedia();
    syncOverlays();
    const t = performance.now() / 1000;
    const frame = store.audio.isLoaded ? store.audio.currentFrame() : syntheticIdleFrame(t, prevT);
    prevT = t;
    // 歌詞モーション: 音源があるときだけ重ねる。設定が変わってから作り直すまでの間は、ひとつ前のものが出る
    host.lyrics.setMotion(previewMotionNow());
    host.lyrics.setBlanks(store.lyrics?.timing.blanks);
    host.view = store.view;
    host.composition = store.composition;
    if (frame) host.render(frame, renderParamsNow());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { element: wrap, host };
}
