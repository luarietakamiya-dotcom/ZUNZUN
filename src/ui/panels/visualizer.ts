import { store } from '../../core/store';
import type { AudioFrame, CommonParams, OverlayLayer } from '../../core/types';
import { BAND_COUNT } from '../../core/audio';
import { previewMotionProvider } from '../../core/lyrics/motion-provider';
import { VisualizerHost } from '../../core/visualizer/host';
import { visualizerRegistry } from '../../visualizers';

const NUMERIC_PARAMS: { key: keyof CommonParams; label: string; min: number; max: number; step: number }[] = [
  { key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01 },
  { key: 'sensitivity', label: 'Sensitivity', min: 0, max: 1, step: 0.01 },
  { key: 'bass', label: 'Bass', min: 0, max: 2, step: 0.01 },
  { key: 'mid', label: 'Mid', min: 0, max: 2, step: 0.01 },
  { key: 'high', label: 'High', min: 0, max: 2, step: 0.01 },
  { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.01 },
  { key: 'motion', label: 'Motion', min: 0, max: 1, step: 0.01 },
  { key: 'cameraMotion', label: 'Camera Motion', min: 0, max: 1, step: 0.01 },
];

const COLOR_THEMES = ['default', 'gold', 'ice', 'neon', 'mono'];

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

export function renderVisualizerPanel(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel';

  const h2 = document.createElement('h2');
  h2.textContent = 'Visualizer';
  el.appendChild(h2);

  const p = document.createElement('p');
  p.textContent =
    '完成済みの世界観プリセットをサムネイルから選びます (現在はデバッグ用の帯域表示のみ)。音源が未読み込みの間はダミーの動きを表示します。';
  el.appendChild(p);

  const presetSelect = document.createElement('select');
  presetSelect.className = 'select';
  for (const m of visualizerRegistry.list()) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    presetSelect.appendChild(opt);
  }
  el.appendChild(presetSelect);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'visualizer-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'visualizer-canvas';
  canvasWrap.appendChild(canvas);
  el.appendChild(canvasWrap);

  const paramsWrap = document.createElement('div');
  paramsWrap.className = 'param-grid';
  el.appendChild(paramsWrap);

  for (const def of NUMERIC_PARAMS) {
    const row = document.createElement('label');
    row.className = 'param-row';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'param-label';
    const updateLabel = (v: number): void => {
      labelSpan.textContent = `${def.label}: ${v.toFixed(2)}`;
    };
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    const initial = store.params[def.key] as number;
    input.value = String(initial);
    updateLabel(initial);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      store.setParam(def.key, v as CommonParams[typeof def.key]);
      updateLabel(v);
    });
    row.appendChild(labelSpan);
    row.appendChild(input);
    paramsWrap.appendChild(row);
  }

  const colorRow = document.createElement('label');
  colorRow.className = 'param-row';
  const colorLabel = document.createElement('span');
  colorLabel.className = 'param-label';
  colorLabel.textContent = 'Color Theme';
  const colorSelect = document.createElement('select');
  colorSelect.className = 'select';
  for (const theme of COLOR_THEMES) {
    const opt = document.createElement('option');
    opt.value = theme;
    opt.textContent = theme;
    colorSelect.appendChild(opt);
  }
  colorSelect.value = store.params.colorTheme;
  colorSelect.addEventListener('change', () => store.setParam('colorTheme', colorSelect.value));
  colorRow.appendChild(colorLabel);
  colorRow.appendChild(colorSelect);
  paramsWrap.appendChild(colorRow);

  // 歌詞モーションはプレビューでは軽く描く (書き出しでは全部描く)
  const host = new VisualizerHost(canvas, { fastLyrics: true });

  // Overlay タブで設定されたレイヤーを、その時点の store の状態から一括で読み込む。
  // 画像本体はタブをまたいで保持されないため (core/store.ts 参照)、まだ再選択されていない
  // レイヤー (getOverlayFile が undefined) は読み込まずスキップする。
  const overlayEntries = store.overlays
    .map((config) => ({ config, file: store.getOverlayFile(config.id) }))
    .filter((e): e is { config: OverlayLayer; file: File } => e.file != null);
  void host.overlay.loadFrom(overlayEntries);

  const applyPreset = (id: string): void => {
    const mod = visualizerRegistry.get(id);
    if (!mod) return;
    store.setPresetId(id);
    void host.setPreset(mod, store.seed, store.params as CommonParams & Record<string, unknown>);
  };

  const firstId = visualizerRegistry.list()[0]?.id;
  presetSelect.value = store.presetId ?? firstId ?? '';
  if (presetSelect.value) applyPreset(presetSelect.value);
  presetSelect.addEventListener('change', () => applyPreset(presetSelect.value));

  const resizeObserver = new ResizeObserver(() => {
    const rect = canvasWrap.getBoundingClientRect();
    host.resize(rect.width, rect.height);
  });
  resizeObserver.observe(canvasWrap);

  // このパネルが DOM から外れたら (別タブへ切り替わったら) WebGL リソースを解放する。
  // shell.ts はタブ切り替え時に body.innerHTML を丸ごと差し替えるだけなので、各フレームで
  // canvas.isConnected を見て自分で後片付けする。
  let prevT = performance.now() / 1000;
  const tick = (): void => {
    if (!canvas.isConnected) {
      resizeObserver.disconnect();
      host.dispose();
      return;
    }
    const t = performance.now() / 1000;
    const frame = store.audio.isLoaded ? store.audio.currentFrame() : syntheticIdleFrame(t, prevT);
    prevT = t;
    // 歌詞モーション: 音源があるときだけ重ねる (音源が無いとダミーの時刻になるため)。
    // 設定が変わってから作り直すまでの間は、ひとつ前の歌詞モーションが表示され続ける
    host.lyrics.setMotion(
      store.audio.isLoaded
        ? previewMotionProvider.get({
            lyrics: store.lyrics,
            analysis: store.audio.analysis,
            projectSeed: store.seed,
            width: store.exportSettings.width,
            height: store.exportSettings.height,
            fps: store.exportSettings.fps,
            rhythm: store.rhythm,
          })
        : null,
    );
    if (frame) host.render(frame, store.params as CommonParams & Record<string, unknown>);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return el;
}
