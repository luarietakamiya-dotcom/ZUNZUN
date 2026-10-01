import * as THREE from 'three';
import type { BackgroundSettings, VisualizerBlend } from '../types';
import { ExactVideo, PreviewVideo } from './background-video';
import { slideAt, type SlideCue } from './slideshow';
import { tr } from '../i18n';

/**
 * 背景の一枚絵 (のちに動画) と、ビジュアライザーとの合成 (docs/ARCHITECTURE.md「背景」)。
 * 見た目の順番: 背景 → ビジュアライザー (blend で重ねる) → 歌詞 → オーバーレイ。
 *
 * プリセットは背景を不透明な黒で塗るので、下に絵を敷いただけでは見えない。プリセットには手を入れず
 * (「プリセットは自分のフォルダに閉じる」)、合成で解決する。スクリーン合成なら、黒い部分は透けて光っている部分だけが背景に乗る。
 *
 * 描き方: **ビジュアライザーは今までどおり画面へ直接描き、その上から背景を重ねる** (スクリーン合成と加算は、どちらが上でも
 * 結果が同じなので)。最初はビジュアライザーを画面外に描いてから背景の上に重ねていたが、PostFX の最後の UnrealBloomPass は
 * 画面へ写すときに「元の絵だけ リニア → sRGB に変換し、Bloom の光は変換せずに足す」ので、まとめて変換すると
 * Bloom の強いプリセットで色が合わなかった (E2E で差が最大 144)。この描き方なら、ビジュアライザーの見た目は背景なしと完全に同じ。
 * - 濃さ (レイヤーの設定の visualizerOpacity) < 1: 先に黒を重ねてビジュアライザーを薄くしてから、背景を重ねる
 * - 'over' (そのまま上に): 背景に (1 − 濃さ) を掛けて足す = ビジュアライザー × 濃さ + 背景 × (1 − 濃さ)
 * 背景の画像はファイルの値 (sRGB) をそのまま出す (色の変換をしない)。背景には Bloom をかけない (明るい写真が白飛びしないように)。
 *
 * スライドショー (settings.slides。core/render/slideshow.ts の切り替え表 setSlideCues): 今の画像と、じわっと切り替える間は
 * ひとつ前の画像を重ねて描く (map / map2 と mixAmt)。画像は全部を一度に持たず、今・前・次の画像だけを読み込む
 * (長い辺 SLIDE_MAX_SIDE まで縮める。使わなくなったものは捨てる)。プレビューは読み終わるまで前の絵のまま、
 * 書き出しは advanceExact でそのフレームに要る画像を読み終わるまで待つ。
 */

/** 背景の絵の uv の拡大率。'cover' は画面いっぱい (はみ出しは切る)、'contain' は全体を収める (余りは黒) */
export function backgroundUvScale(srcAspect: number, dstAspect: number, fit: BackgroundSettings['fit']): [number, number] {
  if (!(srcAspect > 0) || !(dstAspect > 0)) return [1, 1];
  const wider = srcAspect > dstAspect;
  if (fit === 'cover') return wider ? [dstAspect / srcAspect, 1] : [1, srcAspect / dstAspect];
  return wider ? [1, srcAspect / dstAspect] : [dstAspect / srcAspect, 1];
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BG_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec2 uvScale;
/** スライドショーで、じわっと切り替える間のひとつ前の画像 (mixAmt = 今の画像の割合。1 なら map だけ) */
uniform sampler2D map2;
uniform vec2 uvScale2;
uniform float mixAmt;
/** 暗さと、'over' のときの (1 − 濃さ) を掛けたもの */
uniform float brightness;
varying vec2 vUv;
vec3 sampleFit(sampler2D tex, vec2 scale) {
  vec2 uv = (vUv - 0.5) * scale + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
  return texture2D(tex, uv).rgb;
}
void main() {
  vec3 col = sampleFit(map, uvScale);
  if (mixAmt < 1.0) col = mix(sampleFit(map2, uvScale2), col, mixAmt);
  gl_FragColor = vec4(col * brightness, 1.0);
}
`;

const FADE_FRAG = /* glsl */ `
uniform float fade;
void main() {
  gl_FragColor = vec4(0.0, 0.0, 0.0, fade);
}
`;

/** 背景をビジュアライザー (画面に描いてある絵 = dst) の上に重ねる合成 */
function blendFor(material: THREE.ShaderMaterial, blend: VisualizerBlend): void {
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  // screen: src + dst × (1 − src)。add と over: src + dst (over は src に (1 − 濃さ) を掛け、dst は先に薄くしてある)
  material.blendDst = blend === 'screen' ? THREE.OneMinusSrcColorFactor : THREE.OneFactor;
  material.needsUpdate = true;
}

/** ぼかしの半径 (画像の長い辺に対する割合)。blur = 1 で 3% */
const BLUR_MAX = 0.03;
/** 背景の画像の長い辺の上限 (px)。大きすぎる写真は縮めてから使う (GPU のテクスチャの上限とメモリのため) */
const MAX_IMAGE_SIDE = 4096;
/** スライドショーの画像の長い辺の上限 (px。何枚も持つので小さめ) */
const SLIDE_MAX_SIDE = 2048;
/** スライドショーで同時に持つ画像の数の上限 (今・前・次と、その少し先) */
const SLIDE_CACHE = 5;

/**
 * 画像ファイルを背景用のテクスチャにする。ぼかしはここで一度だけかける (canvas の filter)。
 * ぼかすと端が透けて暗くなるので、少し大きく描いてから切り取る。
 */
export async function loadBackgroundImage(file: Blob, blur01: number, maxSide = MAX_IMAGE_SIDE): Promise<{ texture: THREE.Texture; aspect: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(tr('背景の画像を描けませんでした (2D canvas が使えません)', 'Could not draw the background image (2D canvas unavailable)'));
    const radius = Math.max(0, Math.min(1, blur01)) * BLUR_MAX * Math.max(w, h);
    if (radius >= 0.5) {
      ctx.filter = `blur(${radius.toFixed(1)}px)`;
      const pad = radius * 2;
      ctx.drawImage(bitmap, -pad, -pad, w + pad * 2, h + pad * 2);
      ctx.filter = 'none';
    } else {
      ctx.drawImage(bitmap, 0, 0, w, h);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return { texture, aspect: bitmap.width / bitmap.height };
  } finally {
    bitmap.close();
  }
}

export class BackgroundCompositor {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly bgMaterial: THREE.ShaderMaterial;
  private readonly fadeMaterial: THREE.ShaderMaterial;
  private readonly bgMesh: THREE.Mesh;
  private readonly fadeMesh: THREE.Mesh;
  private texture: THREE.Texture | null = null;
  /** 背景が動画のとき (プレビュー用か書き出し用のどちらか)。テクスチャは動画の持ち物 */
  private video: PreviewVideo | ExactVideo | null = null;
  private srcAspect = 1;
  private dstAspect = 1;
  private settings: BackgroundSettings | null = null;
  /** ビジュアライザーの重ね方と濃さ (レイヤーの設定から。setVisualizerBlend) */
  private vBlend: VisualizerBlend = 'screen';
  private vOpacity = 1;
  /** load() の呼び出し世代 (読み込み中に別の読み込みが来たら古い方を捨てる) */
  private generation = 0;
  /** スライドショー: 画像ごとのファイル (選び直していないものは null)・切り替え表・読み込んだ画像 */
  private slideFiles: (File | null)[] | null = null;
  private slideCues: readonly SlideCue[] = [];
  private readonly slideTex = new Map<number, Promise<{ texture: THREE.Texture; aspect: number } | null>>();
  private readonly slideReady = new Map<number, { texture: THREE.Texture; aspect: number }>();
  /** いま描いている画像 (読み込み中の画像に切り替わるまでは前のまま) */
  private shown: { cur: number; prev: number; mix: number } = { cur: -1, prev: -1, mix: 1 };
  /** 書き出しの各フレームの時刻 (スライドショー用) と、次に描くフレームの番号 */
  private exactTimes: readonly number[] | null = null;
  private exactFrame = 0;

  constructor() {
    this.fadeMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FADE_FRAG,
      uniforms: { fade: { value: 0 } },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.NormalBlending,
    });
    this.bgMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BG_FRAG,
      uniforms: {
        map: { value: null },
        uvScale: { value: new THREE.Vector2(1, 1) },
        map2: { value: null },
        uvScale2: { value: new THREE.Vector2(1, 1) },
        mixAmt: { value: 1 },
        brightness: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.fadeMesh = new THREE.Mesh(this.geometry, this.fadeMaterial);
    this.bgMesh = new THREE.Mesh(this.geometry, this.bgMaterial);
    for (const m of [this.fadeMesh, this.bgMesh]) m.frustumCulled = false;
    this.fadeMesh.renderOrder = 0;
    this.bgMesh.renderOrder = 1;
    this.scene.add(this.fadeMesh, this.bgMesh);
  }

  /** 背景を使っているか (使っていなければ何もしない) */
  get active(): boolean {
    if (this.slideFiles) return this.settings != null && this.shown.cur >= 0 && this.slideReady.has(this.shown.cur);
    return this.texture != null && this.settings != null;
  }

  /** スライドショーか (テスト・UI 用) */
  get isSlideshow(): boolean {
    return this.slideFiles != null;
  }

  /** スライドショーの切り替え表 (core/render/slideshow.ts)。プレビューは変わるたび、書き出しは最初に 1 回 */
  setSlideCues(cues: readonly SlideCue[]): void {
    this.slideCues = cues;
  }

  /**
   * 設定とファイルから背景を読み込む (どちらかが無ければ背景なし)。
   * 動画は、exact = false (プレビュー) ならブラウザの動画を曲の位置に合わせて流し、exact = true (書き出し) なら
   * beginExact / advanceExact で各フレームの時刻ちょうどの絵を取り出す
   */
  async load(settings: BackgroundSettings | null, file: Blob | null, opts: { exact?: boolean; slideFiles?: readonly (File | null)[] } = {}): Promise<void> {
    const my = ++this.generation;
    this.clearSlides();
    if (settings?.slides && opts.slideFiles && opts.slideFiles.some((f) => f != null)) {
      this.setTexture(null, 1);
      this.settings = settings;
      this.slideFiles = settings.slides.items.map((_, i) => opts.slideFiles![i] ?? null);
      this.apply();
      return;
    }
    if (!settings || !file) {
      this.setTexture(null, 1);
      this.settings = null;
      return;
    }
    if (settings.kind === 'video') {
      const video = opts.exact ? await ExactVideo.open(file, settings.loop) : await PreviewVideo.open(file, settings.loop);
      if (my !== this.generation) {
        video.dispose();
        return;
      }
      this.settings = settings;
      this.setTexture(null, 1);
      this.video = video;
      this.texture = video.texture;
      this.srcAspect = video.aspect;
      this.bgMaterial.uniforms.map!.value = video.texture;
      this.apply();
      return;
    }
    const { texture, aspect } = await loadBackgroundImage(file, settings.blur);
    if (my !== this.generation) {
      texture.dispose();
      return;
    }
    this.settings = settings;
    this.setTexture(texture, aspect);
    this.apply();
  }

  /** 毎フレーム、描く前に呼ぶ (プレビューの動画を曲の時刻 t に合わせる。スライドショーは今の画像を選ぶ。書き出しでは何もしない) */
  update(t: number): void {
    if (this.video instanceof PreviewVideo) this.video.sync(t);
    if (this.slideFiles && !this.exactTimes) void this.showSlidesAt(t, false);
  }

  /** 書き出しの前に、書き出す全フレームの曲の時刻を渡す (背景が書き出し用の動画・スライドショーのときだけ意味がある) */
  beginExact(songTimes: readonly number[]): void {
    if (this.video instanceof ExactVideo) this.video.begin(songTimes);
    if (this.slideFiles) {
      this.exactTimes = songTimes;
      this.exactFrame = 0;
    }
  }

  /** 書き出しで、各フレームを描く前に呼ぶ (次のフレームの動画の絵・スライドショーの画像を用意する) */
  async advanceExact(): Promise<void> {
    if (this.video instanceof ExactVideo) await this.video.next();
    if (this.slideFiles && this.exactTimes) {
      const t = this.exactTimes[Math.min(this.exactFrame, this.exactTimes.length - 1)] ?? 0;
      this.exactFrame++;
      await this.showSlidesAt(t, true);
    }
  }

  /**
   * 時刻 t の画像を選んで描けるようにする。wait = true (書き出し) なら読み終わるまで待つ。
   * プレビューは読み込みを始めるだけで、読み終わるまでは前に描いていた画像のまま
   */
  private async showSlidesAt(t: number, wait: boolean): Promise<void> {
    const files = this.slideFiles;
    const s = this.settings?.slides;
    if (!files || !s) return;
    const { index, prev, since } = slideAt(this.slideCues, t);
    const cur = index >= 0 ? index : files.findIndex((f) => f != null);
    if (cur < 0) return;
    const fade = s.transition === 'fade' ? Math.max(0.05, s.fadeSec) : 0;
    const mixAmt = prev >= 0 && fade > 0 ? Math.min(1, since / fade) : 1;
    // 次に出る画像も先に読んでおく
    const next = this.slideCues.find((c) => c.t > t)?.index ?? -1;
    const want = [cur, ...(mixAmt < 1 ? [prev] : []), ...(next >= 0 ? [next] : [])];
    const loads = want.map((i) => this.loadSlide(i));
    if (wait) await Promise.all(loads);
    this.evictSlides(new Set([...want, this.shown.cur, this.shown.prev]));
    if (!this.slideReady.has(cur)) return; // 読み込み中 (プレビュー): 前の絵のまま
    const usePrev = mixAmt < 1 && this.slideReady.has(prev);
    this.shown = { cur, prev: usePrev ? prev : -1, mix: usePrev ? mixAmt : 1 };
    this.applySlides();
  }

  private loadSlide(i: number): Promise<{ texture: THREE.Texture; aspect: number } | null> {
    const file = this.slideFiles?.[i];
    if (!file) return Promise.resolve(null);
    let p = this.slideTex.get(i);
    if (!p) {
      const my = this.generation;
      p = loadBackgroundImage(file, this.settings?.blur ?? 0, SLIDE_MAX_SIDE)
        .then((r) => {
          if (my !== this.generation || this.slideTex.get(i) !== p) {
            r.texture.dispose();
            return null;
          }
          this.slideReady.set(i, r);
          return r;
        })
        .catch(() => null);
      this.slideTex.set(i, p);
    }
    return p;
  }

  /** 使わなくなった画像を捨てる (上限を超えたときだけ。keep は残す) */
  private evictSlides(keep: Set<number>): void {
    if (this.slideTex.size <= SLIDE_CACHE) return;
    for (const i of [...this.slideTex.keys()]) {
      if (this.slideTex.size <= SLIDE_CACHE) break;
      if (keep.has(i)) continue;
      this.slideReady.get(i)?.texture.dispose();
      this.slideReady.delete(i);
      this.slideTex.delete(i);
    }
  }

  private clearSlides(): void {
    for (const r of this.slideReady.values()) r.texture.dispose();
    this.slideReady.clear();
    this.slideTex.clear();
    this.slideFiles = null;
    this.slideCues = [];
    this.shown = { cur: -1, prev: -1, mix: 1 };
    this.exactTimes = null;
    this.exactFrame = 0;
    this.bgMaterial.uniforms.map2!.value = null;
    this.bgMaterial.uniforms.mixAmt!.value = 1;
  }

  /** いま描く画像 (shown) をシェーダーに渡す */
  private applySlides(): void {
    const s = this.settings;
    const cur = this.slideReady.get(this.shown.cur);
    if (!s || !cur) return;
    const u = this.bgMaterial.uniforms;
    u.map!.value = cur.texture;
    const [sx, sy] = backgroundUvScale(cur.aspect, this.dstAspect, s.fit);
    (u.uvScale!.value as THREE.Vector2).set(sx, sy);
    const prev = this.slideReady.get(this.shown.prev);
    if (prev && this.shown.mix < 1) {
      u.map2!.value = prev.texture;
      const [px, py] = backgroundUvScale(prev.aspect, this.dstAspect, s.fit);
      (u.uvScale2!.value as THREE.Vector2).set(px, py);
      u.mixAmt!.value = this.shown.mix;
    } else {
      u.map2!.value = null;
      u.mixAmt!.value = 1;
    }
  }

  resize(width: number, height: number): void {
    this.dstAspect = Math.max(1, width) / Math.max(1, height);
    this.apply();
  }

  /** ビジュアライザーを背景にどう重ねるか (レイヤーの設定。変わったときだけ作り直す) */
  setVisualizerBlend(blend: VisualizerBlend, opacity: number): void {
    const o = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    if (blend === this.vBlend && o === this.vOpacity) return;
    this.vBlend = blend;
    this.vOpacity = o;
    this.apply();
  }

  /**
   * 背景だけを、下に何も無い画面へ不透明に描く (レイヤーの順番を組み替えたとき用。ビジュアライザーはこのあと別に重ねる)
   */
  drawOpaque(renderer: THREE.WebGLRenderer): void {
    if (!this.active || !this.settings) return;
    const brightness = this.bgMaterial.uniforms.brightness!;
    const before = brightness.value as number;
    brightness.value = 1 - Math.max(0, Math.min(1, this.settings.dim));
    const { blending } = this.bgMaterial;
    this.bgMaterial.blending = THREE.NoBlending;
    renderer.setRenderTarget(null);
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.bgMesh, this.camera);
    renderer.autoClear = prevAutoClear;
    this.bgMaterial.blending = blending;
    brightness.value = before;
  }

  /**
   * 画面に描いてあるビジュアライザーの上から背景を重ねる (ビジュアライザーを描いた直後、歌詞・オーバーレイの前に呼ぶ)。
   * ビジュアライザーを描いていなければ、先に画面を黒で消してから呼ぶこと
   */
  composeOver(renderer: THREE.WebGLRenderer): void {
    if (!this.active) return;
    renderer.setRenderTarget(null);
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.generation++;
    this.clearSlides();
    this.setTexture(null, 1);
    this.bgMaterial.dispose();
    this.fadeMaterial.dispose();
    this.geometry.dispose();
    this.scene.clear();
  }

  private setTexture(texture: THREE.Texture | null, aspect: number): void {
    // 動画のテクスチャは動画ごと片づける
    if (this.video) {
      this.video.dispose();
      this.video = null;
    } else this.texture?.dispose();
    this.texture = texture;
    this.srcAspect = aspect;
    this.bgMaterial.uniforms.map!.value = texture;
  }

  private apply(): void {
    const s = this.settings;
    if (!s) return;
    if (this.slideFiles) this.applySlides();
    else {
      const [sx, sy] = backgroundUvScale(this.srcAspect, this.dstAspect, s.fit);
      (this.bgMaterial.uniforms.uvScale!.value as THREE.Vector2).set(sx, sy);
    }
    const opacity = this.vOpacity;
    const bright = 1 - Math.max(0, Math.min(1, s.dim));
    this.bgMaterial.uniforms.brightness!.value = this.vBlend === 'over' ? bright * (1 - opacity) : bright;
    // ビジュアライザーを (1 − 濃さ) だけ黒へ寄せる = ビジュアライザー × 濃さ
    this.fadeMaterial.uniforms.fade!.value = 1 - opacity;
    this.fadeMesh.visible = opacity < 1;
    blendFor(this.bgMaterial, this.vBlend);
  }
}
