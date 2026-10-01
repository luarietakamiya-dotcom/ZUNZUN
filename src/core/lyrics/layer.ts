import * as THREE from 'three';
import type { LyricBlank } from '../types';
import { blankAlpha } from './blanks';
import type { LyricMotion } from './jizura-adapter';

/**
 * 歌詞モーションの層 (docs/ARCHITECTURE.md の Compositor「中 = lyric texture」)。
 * VisualizerHost が、プリセット + PostFX (Bloom) を描いたあと・オーバーレイ画像の前にこれを重ねる。
 * Bloom を通さないので、文字はにじまずにくっきり出る (オーバーレイと同じ扱い)。
 *
 * JIZURA は Canvas 2D で描くので、DOM に載せない 2D canvas に透過で描き、それを 1 枚の板のテクスチャにして
 * 正射影カメラで重ねる。JIZURA の画面比率 (plan.W : plan.H) を保ったまま、画面の中に収まる大きさで中央に置く
 * (書き出しサイズと同じ比率なら画面いっぱい)。
 */
export interface LyricLayerOptions {
  /** 2D canvas の解像度の倍率 (1 = 画面と同じ px 数) */
  resolutionScale?: number;
  /** 軽い描画 (ぼかしなどを省く)。プレビュー向け。書き出しでは false */
  fast?: boolean;
}

export class LyricLayer {
  readonly scene = new THREE.Scene();
  /** 画面全体を -0.5..0.5 の正方形として扱う (縦横比は板の大きさ側で合わせる) */
  readonly camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);
  private readonly canvas2d: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;
  private texture: THREE.CanvasTexture | null = null;
  private motion: LyricMotion | null = null;
  private width = 1;
  private height = 1;
  private readonly resolutionScale: number;
  private readonly fast: boolean;
  /** 歌詞の濃さ (レイヤーの設定) と、歌詞の空白 (何も出さない時間) */
  private baseOpacity = 1;
  private blanks: readonly LyricBlank[] = [];

  constructor(opts: LyricLayerOptions = {}) {
    this.resolutionScale = opts.resolutionScale ?? 1;
    this.fast = opts.fast ?? false;
    this.canvas2d = document.createElement('canvas');
    this.ctx = this.canvas2d.getContext('2d');
    this.material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  /** 歌詞の濃さ (0..1) */
  setOpacity(opacity: number): void {
    const o = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    this.baseOpacity = o;
    this.material.opacity = o;
  }

  /** 歌詞の空白 (core/lyrics/blanks.ts)。何も出さない空白の間は描かない (端はなめらかに消える・戻る) */
  setBlanks(blanks: readonly LyricBlank[] | undefined): void {
    this.blanks = blanks ?? [];
  }

  get currentMotion(): LyricMotion | null {
    return this.motion;
  }

  /** 描く歌詞モーションを差し替える (null で歌詞を出さない)。同じものを渡したときは何もしない */
  setMotion(motion: LyricMotion | null): void {
    if (motion === this.motion) return;
    this.motion = motion;
    this.layout();
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.layout();
  }

  /** 時刻 t のコマを描いて重ねる。呼び出し側で canvas を持つ renderer を渡す (オーバーレイと同じく autoClear を止めて描く) */
  render(renderer: THREE.WebGLRenderer, t: number): void {
    if (!this.motion || !this.ctx || !this.texture) return;
    const a = blankAlpha(this.blanks, t);
    if (a <= 0.001) return;
    this.material.opacity = this.baseOpacity * a;
    this.motion.render(this.ctx, t, { fast: this.fast });
    this.texture.needsUpdate = true;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.texture?.dispose();
    this.texture = null;
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.scene.clear();
    this.motion = null;
  }

  /** 板の大きさと 2D canvas の解像度を、画面の大きさと JIZURA の画面比率から決め直す */
  private layout(): void {
    const plan = this.motion?.plan;
    if (!plan) {
      this.mesh.visible = false;
      return;
    }
    const screenAspect = this.width / this.height;
    const planAspect = plan.W / plan.H;
    // 画面の中に収まる大きさ (正規化: 画面全体 = 1 × 1)
    const sx = planAspect >= screenAspect ? 1 : planAspect / screenAspect;
    const sy = planAspect >= screenAspect ? screenAspect / planAspect : 1;
    this.mesh.scale.set(sx, sy, 1);
    const w = Math.max(2, Math.round(this.width * sx * this.resolutionScale));
    const h = Math.max(2, Math.round(this.height * sy * this.resolutionScale));
    if (!this.texture || this.canvas2d.width !== w || this.canvas2d.height !== h) {
      this.canvas2d.width = w;
      this.canvas2d.height = h;
      // テクスチャの大きさは作った時点で決まる (WebGL2 の texStorage) ので、大きさが変わったら作り直す
      this.texture?.dispose();
      this.texture = new THREE.CanvasTexture(this.canvas2d);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.generateMipmaps = false;
      this.material.map = this.texture;
      this.material.needsUpdate = true;
    }
    this.mesh.visible = true;
  }
}
