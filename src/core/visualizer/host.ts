import * as THREE from 'three';
import { LyricLayer } from '../lyrics/layer';
import { OverlayManager } from '../overlay/manager';
import { deriveSeed, makeRng } from '../random';
import { PostFxStack } from '../render/postfx';
import type { AudioFrame, CommonParams, VisualizerPreset } from '../types';
import type { VisualizerModule } from './registry';

export interface VisualizerHostOptions {
  /** 背景色。プリセット自身の背景描画で上書きされる想定だが、初期状態やエラー時の色として使う */
  clearColor?: number;
  /**
   * 描画解像度の倍率。省略時はプレビュー向けに min(2, devicePixelRatio)。
   * 書き出しでは canvas のピクセル数を書き出しサイズぴったりにしたいので 1 を渡す。
   */
  pixelRatio?: number;
  /**
   * true のとき描画結果をフレームをまたいで保持する (WebGL の preserveDrawingBuffer)。
   * 書き出し時に canvas から VideoFrame を取り込む前に中身が消えないよう、書き出し用 Host でだけ使う。
   */
  preserveDrawingBuffer?: boolean;
  /** 歌詞モーションを軽く描く (ぼかしなどを省く)。プレビュー向け。書き出しでは false (既定) */
  fastLyrics?: boolean;
}

/**
 * 1 つの canvas 上で Visualizer プリセットを生成・切り替え・破棄する。
 * docs/ARCHITECTURE.md の「core/visualizer」「core/render」責務 (Registry / Host / Compositor) の
 * うち Host + Compositor にあたる。実際の描画は PostFxStack (Bloom + Light Rays) を経由する。
 *
 * プリセットは互いに独立 (`init/update/resize/dispose` 以外の外部状態を共有しない) という
 * 設計を守るため、Host はプリセット固有の状態を一切持たず、WebGLRenderer/PostFxStack と
 * 現在のプリセットのライフサイクルだけを管理する。
 */
export class VisualizerHost {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly postfx: PostFxStack;
  /** PNG/WebP/JPG オーバーレイ。Bloom を通さず、プリセット本体の描画のあとに重ね描きする (Compositor の「前」層) */
  readonly overlay = new OverlayManager();
  /**
   * 歌詞モーション (JIZURA)。PostFX のあと・オーバーレイの前に重ねる (Compositor の「中」層)。
   * 描く LyricMotion は呼び出し側が lyrics.setMotion() で渡す (歌詞が無ければ何も描かない)
   */
  readonly lyrics: LyricLayer;
  private current: { preset: VisualizerPreset; moduleId: string } | null = null;
  private width = 1;
  private height = 1;
  /** setPreset() の呼び出し世代。init() が完了する前に別の setPreset() が来た場合に古い方を捨てる */
  private generation = 0;

  constructor(canvas: HTMLCanvasElement, opts: VisualizerHostOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    });
    this.renderer.setPixelRatio(opts.pixelRatio ?? Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(opts.clearColor ?? 0x000000, 1);
    this.postfx = new PostFxStack(this.renderer, this.width, this.height);
    this.lyrics = new LyricLayer({ fast: opts.fastLyrics ?? false });
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get currentPresetId(): string | null {
    return this.current?.moduleId ?? null;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.renderer.setSize(this.width, this.height, false);
    this.postfx.resize(this.width, this.height);
    this.overlay.resize(this.width, this.height);
    // 歌詞の 2D canvas は実際の描画ピクセル数に合わせる (にじまないように)
    const pr = this.renderer.getPixelRatio();
    this.lyrics.resize(this.width * pr, this.height * pr);
    this.current?.preset.resize(this.width, this.height);
  }

  /**
   * プリセットを切り替える。前のプリセットは、新しいプリセットの init() が成功したあとに破棄する
   * (init 中に例外が出ても画面が真っ黒になったまま壊れないようにするため)。
   */
  async setPreset(
    mod: VisualizerModule,
    baseSeed: number,
    params: CommonParams & Record<string, unknown>,
  ): Promise<void> {
    const myGeneration = ++this.generation;
    const preset = mod.create();
    const seed = deriveSeed(baseSeed, mod.manifest.id);
    const rng = makeRng(seed);

    await preset.init({
      renderer: this.renderer,
      width: this.width,
      height: this.height,
      seed,
      params,
      rng,
    });

    if (myGeneration !== this.generation) {
      // 待っている間にさらに別の setPreset() が呼ばれていた場合、この結果は捨てる
      preset.dispose();
      return;
    }

    const previous = this.current;
    this.current = { preset, moduleId: mod.manifest.id };
    this.postfx.setScene(preset.scene, preset.camera);
    this.postfx.configure(mod.manifest.post ?? {});
    previous?.preset.dispose();
  }

  /** 現在のプリセット → 歌詞モーション → オーバーレイ の順に、毎フレーム更新して描画する。 */
  render(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void {
    if (this.current) {
      const { preset } = this.current;
      preset.update(frame, params);
      this.postfx.setGlow(params.glow);
      this.postfx.render();
    }
    this.lyrics.render(this.renderer, frame.t);
    this.overlay.animate(frame);
    this.overlay.render(this.renderer);
  }

  dispose(): void {
    this.generation++; // 進行中の setPreset() の結果を無効化する
    this.current?.preset.dispose();
    this.current = null;
    this.postfx.dispose();
    this.lyrics.dispose();
    this.overlay.dispose();
    this.renderer.dispose();
    // WebGL コンテキストは GC 任せだとしばらく残り、ブラウザの同時コンテキスト数上限 (Chrome は 16) に
    // 近づく。タブ切り替えや書き出しのたびに Host を作り直すので、ここで明示的に手放す。
    this.renderer.forceContextLoss();
  }
}
