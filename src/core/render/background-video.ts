import * as THREE from 'three';

/**
 * 背景の動画 (docs/ARCHITECTURE.md「背景（一枚絵・動画）の方針」)。動画の音は使わない (無音で扱う)。
 * - プレビュー (PreviewVideo): ブラウザの <video> を曲の再生位置に合わせて流す (ずれたら合わせ直す、曲が止まったら止める)。
 *   軽いが、コマの位置は厳密ではない
 * - 書き出し (ExactVideo): Mediabunny (すでに書き出しで使っている) で、書き出す各フレームの時刻ちょうどの絵を取り出す。
 *   同じ動画・同じ設定なら、書き出す映像は毎回同じになる
 * 動画が曲より短いときは、くり返す (loop) か、最後の絵で止める。
 */

/** 曲の時刻 t に出す動画の時刻 (0 始まり)。loop ならくり返し、そうでなければ最後の絵で止める */
export function videoTimeAt(t: number, duration: number, loop: boolean): number {
  if (!Number.isFinite(t) || t < 0) return 0;
  if (!(duration > 0)) return 0;
  if (loop) return t % duration;
  // 最後の絵を指すように、終わりのほんの少し手前にする
  return Math.min(t, Math.max(0, duration - 0.001));
}

/** プレビューで、動画の位置がこれ以上ずれたら合わせ直す (秒)。合わせ直すとコマが飛ぶので、少しのずれは許す */
const PREVIEW_DRIFT = 0.15;

export class PreviewVideo {
  readonly texture: THREE.VideoTexture;
  private lastT = -1;

  private constructor(
    private readonly el: HTMLVideoElement,
    private readonly url: string,
    readonly aspect: number,
    readonly duration: number,
    private readonly loop: boolean,
  ) {
    this.texture = new THREE.VideoTexture(el);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
  }

  static async open(file: Blob, loop: boolean): Promise<PreviewVideo> {
    const url = URL.createObjectURL(file);
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.loop = loop;
    el.src = url;
    try {
      await new Promise<void>((resolve, reject) => {
        el.addEventListener('loadeddata', () => resolve(), { once: true });
        el.addEventListener('error', () => reject(new Error('この動画はブラウザで再生できません (MP4 (H.264) か WebM を使ってください)')), { once: true });
      });
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
    const aspect = el.videoWidth > 0 && el.videoHeight > 0 ? el.videoWidth / el.videoHeight : 16 / 9;
    return new PreviewVideo(el, url, aspect, Number.isFinite(el.duration) ? el.duration : 0, loop);
  }

  /** 毎フレーム呼ぶ。t = 曲の時刻。t が進んでいれば再生、止まっていれば一時停止して位置を合わせる */
  sync(t: number): void {
    const target = videoTimeAt(t, this.duration, this.loop);
    const advancing = this.lastT >= 0 && t > this.lastT && t - this.lastT < 0.5;
    this.lastT = t;
    const el = this.el;
    // くり返しの境目では、動画側が先に頭へ戻ることがあるので、差は一周ぶんを考えて測る
    let drift = Math.abs(el.currentTime - target);
    if (this.loop && this.duration > 0) drift = Math.min(drift, this.duration - drift);
    if (advancing) {
      if (el.paused) {
        el.currentTime = target;
        void el.play().catch(() => {});
      } else if (drift > PREVIEW_DRIFT) el.currentTime = target;
    } else {
      if (!el.paused) el.pause();
      if (drift > 0.03) el.currentTime = target;
    }
  }

  dispose(): void {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    URL.revokeObjectURL(this.url);
    this.texture.dispose();
  }
}

/** 書き出しで取り出す動画の絵の、長い辺の上限 (px)。大きすぎる動画は縮めて取り出す (メモリと速さのため) */
const MAX_EXACT_SIDE = 2560;

export class ExactVideo {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private frames: AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null, void, unknown> | null = null;

  private constructor(
    private readonly sink: { canvasesAtTimestamps(ts: Iterable<number>): AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null, void, unknown> },
    private readonly dispose_: () => void,
    width: number,
    height: number,
    private readonly firstTimestamp: number,
    readonly duration: number,
    private readonly loop: boolean,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('背景の動画を描けませんでした (2D canvas が使えません)');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
  }

  get aspect(): number {
    return this.canvas.width / this.canvas.height;
  }

  static async open(file: Blob, loop: boolean): Promise<ExactVideo> {
    const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('動画の映像が見つかりませんでした');
    if (!(await track.canDecode())) throw new Error('このブラウザではこの動画を読めません (MP4 (H.264) か WebM を使ってください)');
    const first = await track.getFirstTimestamp();
    const end = await track.computeDuration();
    const k = Math.min(1, MAX_EXACT_SIDE / Math.max(track.displayWidth, track.displayHeight));
    const width = Math.max(1, Math.round(track.displayWidth * k));
    const height = Math.max(1, Math.round(track.displayHeight * k));
    const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 2 });
    return new ExactVideo(sink, () => input.dispose(), width, height, first, Math.max(0, end - first), loop);
  }

  /** 書き出しを始める前に、書き出す全フレームの曲の時刻を渡す (その順に取り出す) */
  begin(songTimes: readonly number[]): void {
    const mapped = songTimes.map((t) => this.firstTimestamp + videoTimeAt(t, this.duration, this.loop));
    this.frames = this.sink.canvasesAtTimestamps(mapped);
  }

  /** 次のフレームの絵を取り出してテクスチャに写す (begin で渡した順に 1 つずつ) */
  async next(): Promise<void> {
    if (!this.frames) return;
    const r = await this.frames.next();
    const c = r.done ? null : r.value;
    if (c) {
      this.ctx.drawImage(c.canvas, 0, 0, this.canvas.width, this.canvas.height);
      this.texture.needsUpdate = true;
    }
  }

  dispose(): void {
    void this.frames?.return(undefined);
    this.frames = null;
    this.texture.dispose();
    this.dispose_();
  }
}
