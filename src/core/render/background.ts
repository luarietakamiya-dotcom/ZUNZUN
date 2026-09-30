import * as THREE from 'three';
import type { BackgroundSettings, VisualizerBlend } from '../types';
import { ExactVideo, PreviewVideo } from './background-video';
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
/** 暗さと、'over' のときの (1 − 濃さ) を掛けたもの */
uniform float brightness;
varying vec2 vUv;
void main() {
  vec2 uv = (vUv - 0.5) * uvScale + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  gl_FragColor = vec4(texture2D(map, uv).rgb * brightness, 1.0);
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

/**
 * 画像ファイルを背景用のテクスチャにする。ぼかしはここで一度だけかける (canvas の filter)。
 * ぼかすと端が透けて暗くなるので、少し大きく描いてから切り取る。
 */
export async function loadBackgroundImage(file: Blob, blur01: number): Promise<{ texture: THREE.Texture; aspect: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
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
      uniforms: { map: { value: null }, uvScale: { value: new THREE.Vector2(1, 1) }, brightness: { value: 1 } },
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
    return this.texture != null && this.settings != null;
  }

  /**
   * 設定とファイルから背景を読み込む (どちらかが無ければ背景なし)。
   * 動画は、exact = false (プレビュー) ならブラウザの動画を曲の位置に合わせて流し、exact = true (書き出し) なら
   * beginExact / advanceExact で各フレームの時刻ちょうどの絵を取り出す
   */
  async load(settings: BackgroundSettings | null, file: Blob | null, opts: { exact?: boolean } = {}): Promise<void> {
    const my = ++this.generation;
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

  /** 毎フレーム、描く前に呼ぶ (プレビューの動画を曲の時刻 t に合わせる。画像・書き出しでは何もしない) */
  update(t: number): void {
    if (this.video instanceof PreviewVideo) this.video.sync(t);
  }

  /** 書き出しの前に、書き出す全フレームの曲の時刻を渡す (背景が書き出し用の動画のときだけ意味がある) */
  beginExact(songTimes: readonly number[]): void {
    if (this.video instanceof ExactVideo) this.video.begin(songTimes);
  }

  /** 書き出しで、各フレームを描く前に呼ぶ (次のフレームの動画の絵を用意する) */
  async advanceExact(): Promise<void> {
    if (this.video instanceof ExactVideo) await this.video.next();
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
    const [sx, sy] = backgroundUvScale(this.srcAspect, this.dstAspect, s.fit);
    (this.bgMaterial.uniforms.uvScale!.value as THREE.Vector2).set(sx, sy);
    const opacity = this.vOpacity;
    const bright = 1 - Math.max(0, Math.min(1, s.dim));
    this.bgMaterial.uniforms.brightness!.value = this.vBlend === 'over' ? bright * (1 - opacity) : bright;
    // ビジュアライザーを (1 − 濃さ) だけ黒へ寄せる = ビジュアライザー × 濃さ
    this.fadeMaterial.uniforms.fade!.value = 1 - opacity;
    this.fadeMesh.visible = opacity < 1;
    blendFor(this.bgMaterial, this.vBlend);
  }
}
