import * as THREE from 'three';
import { tr } from '../i18n';
import type { MediaLayer } from '../types';
import { ExactVideo, PreviewVideo } from './background-video';
import { CHROMA_GLSL, chromaUniforms } from './chroma';

/**
 * 素材レイヤー (画像・動画。グリーンバックの素材など。docs/ARCHITECTURE.md「レイヤー」)。
 * 1 つの素材 = 1 枚の板。位置・大きさ・回転・濃さ・重ね方・クロマキーを、描くたびに設定 (MediaLayer) から当てる。
 * 色は背景と同じく、ファイルの値をそのまま画面に出す (色の変換をしない)。透明な部分がある PNG・WebM はその透明度も使う。
 * 画面の透明度 (alpha) は 1 のまま触らない (core/render/screen-capture.ts の説明と同じ理由)。
 * 動画は背景の動画と同じ仕組み: プレビューはブラウザの動画を曲の時刻に合わせ、書き出しは各フレームの時刻ちょうどの絵を使う。
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform float opacity;
/** 0 = そのまま上に、1 = スクリーン、2 = 加算 */
uniform float blendMode;
/** 素材の 1 画素の大きさ (uv)。縁を削るときに、まわりの画素を見るのに使う */
uniform vec2 texel;
/** 縁を削る距離 (素材の画素。0 なら削らない) */
uniform float chokePx;
/** 1 = 透け具合を見る (残る所を白、透ける所を黒で描く) */
uniform float matte;
varying vec2 vUv;
${CHROMA_GLSL}
float keyedAlpha(vec2 uv) {
  vec4 t = texture2D(map, uv);
  return t.a * zzChroma(t.rgb).a;
}
void main() {
  vec4 t = texture2D(map, vUv);
  vec4 k = zzChroma(t.rgb);
  float base = t.a * k.a;
  if (chromaOn > 0.5 && chokePx > 0.0) {
    // 縁を削る: まわり 8 方向の透明度のいちばん小さい値 (core/render/chroma.ts の erodeAlpha と同じ)
    vec2 d = texel * chokePx;
    base = min(base, keyedAlpha(vUv + vec2(d.x, 0.0)));
    base = min(base, keyedAlpha(vUv - vec2(d.x, 0.0)));
    base = min(base, keyedAlpha(vUv + vec2(0.0, d.y)));
    base = min(base, keyedAlpha(vUv - vec2(0.0, d.y)));
    base = min(base, keyedAlpha(vUv + d * 0.7071));
    base = min(base, keyedAlpha(vUv - d * 0.7071));
    base = min(base, keyedAlpha(vUv + vec2(d.x, -d.y) * 0.7071));
    base = min(base, keyedAlpha(vUv + vec2(-d.x, d.y) * 0.7071));
  }
  if (matte > 0.5) {
    gl_FragColor = vec4(vec3(base), 1.0);
    return;
  }
  float a = base * opacity;
  gl_FragColor = blendMode < 0.5 ? vec4(k.rgb, a) : vec4(k.rgb * a, 1.0);
}
`;

/** 画像の長い辺の上限 (px) */
const MAX_IMAGE_SIDE = 4096;

async function loadImageTexture(file: Blob): Promise<{ texture: THREE.Texture; aspect: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(tr('素材の画像を描けませんでした (2D canvas が使えません)', 'Could not draw the image (2D canvas unavailable)'));
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return { texture, aspect: bitmap.width / Math.max(1, bitmap.height) };
  } finally {
    bitmap.close();
  }
}

interface Item {
  id: string;
  kind: MediaLayer['kind'];
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  texture: THREE.Texture;
  video: PreviewVideo | ExactVideo | null;
  aspect: number;
}

export class MediaCompositor {
  private readonly items = new Map<string, Item>();
  private configs = new Map<string, MediaLayer>();
  private readonly camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private aspect = 16 / 9;
  private generation = 0;
  /** 透け具合を見る素材 (プレビューだけ。書き出しでは使わない) */
  private matteId: string | null = null;

  /** 透け具合を見る素材を決める (null なら見ない)。プレビューだけで使う */
  setMatteView(id: string | null): void {
    this.matteId = id;
  }

  /** 素材があって描けるか */
  has(id: string): boolean {
    return this.items.has(id) && this.configs.has(id);
  }

  /**
   * 素材を読み込み直す (設定と元のファイルの組)。exact = true (書き出し) なら動画は各フレームの時刻ちょうどの絵を使う。
   * 読めないファイルは飛ばす (ほかの素材・映像には影響させない)
   */
  async load(entries: { config: MediaLayer; file: Blob }[], opts: { exact?: boolean } = {}): Promise<void> {
    const my = ++this.generation;
    const loaded: Item[] = [];
    for (const { config, file } of entries) {
      try {
        let texture: THREE.Texture;
        let aspect: number;
        let video: PreviewVideo | ExactVideo | null = null;
        if (config.kind === 'video') {
          video = opts.exact ? await ExactVideo.open(file, config.loop, { alpha: true }) : await PreviewVideo.open(file, config.loop);
          texture = video.texture;
          aspect = video.aspect;
        } else {
          ({ texture, aspect } = await loadImageTexture(file));
        }
        const material = new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: FRAG,
          uniforms: {
            map: { value: texture },
            opacity: { value: 1 },
            blendMode: { value: 0 },
            chromaOn: { value: 0 },
            chromaMask: { value: new THREE.Vector3(0, 1, 0) },
            chromaKeyness: { value: 1 },
            chromaTol: { value: 0.25 },
            chromaSoft: { value: 0.05 },
            chromaSpill: { value: 0 },
            texel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
            chokePx: { value: 0 },
            matte: { value: 0 },
          },
          depthTest: false,
          depthWrite: false,
          transparent: true,
        });
        const mesh = new THREE.Mesh(this.geometry, material);
        mesh.frustumCulled = false;
        loaded.push({ id: config.id, kind: config.kind, mesh, material, texture, video, aspect });
      } catch {
        // 読めない素材は飛ばす
      }
    }
    if (my !== this.generation) {
      for (const it of loaded) this.disposeItem(it);
      return;
    }
    this.clear();
    for (const it of loaded) this.items.set(it.id, it);
    this.setConfigs([...this.configs.values(), ...entries.map((e) => e.config)]);
  }

  /** 設定を差し替える (位置・大きさ・クロマキーなど。毎フレーム呼んでよい) */
  setConfigs(configs: readonly MediaLayer[]): void {
    this.configs = new Map(configs.map((c) => [c.id, c]));
  }

  resize(width: number, height: number): void {
    this.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.left = -this.aspect / 2;
    this.camera.right = this.aspect / 2;
    this.camera.updateProjectionMatrix();
  }

  /** プレビューの動画を曲の時刻に合わせる (毎フレーム、描く前に) */
  update(t: number): void {
    for (const it of this.items.values()) if (it.video instanceof PreviewVideo) it.video.sync(t);
  }

  /** 書き出しの前に、書き出す全フレームの曲の時刻を渡す */
  beginExact(songTimes: readonly number[]): void {
    for (const it of this.items.values()) if (it.video instanceof ExactVideo) it.video.begin(songTimes);
  }

  /** 書き出しで、各フレームを描く前に呼ぶ */
  async advanceExact(): Promise<void> {
    for (const it of this.items.values()) if (it.video instanceof ExactVideo) await it.video.next();
  }

  /** 素材を 1 つ、画面に描いてある絵の上に重ねる */
  draw(renderer: THREE.WebGLRenderer, id: string): void {
    const it = this.items.get(id);
    const c = this.configs.get(id);
    if (!it || !c) return;
    const u = it.material.uniforms;
    u.opacity!.value = Math.max(0, Math.min(1, c.opacity));
    u.blendMode!.value = c.blend === 'screen' ? 1 : c.blend === 'add' ? 2 : 0;
    const ch = chromaUniforms(c.chroma);
    u.chromaOn!.value = c.chroma.enabled ? 1 : 0;
    (u.chromaMask!.value as THREE.Vector3).set(...ch.mask);
    u.chromaKeyness!.value = ch.keyKeyness;
    u.chromaTol!.value = ch.tol;
    u.chromaSoft!.value = ch.soft;
    u.chromaSpill!.value = ch.spill;
    u.chokePx!.value = ch.chokePx;
    const img = it.texture.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | null;
    const tw = img?.videoWidth || img?.width || 512;
    const th = img?.videoHeight || img?.height || 512;
    (u.texel!.value as THREE.Vector2).set(1 / Math.max(1, tw), 1 / Math.max(1, th));
    const matte = this.matteId === id && c.chroma.enabled;
    u.matte!.value = matte ? 1 : 0;
    const m = it.material;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrcAlpha = THREE.ZeroFactor;
    m.blendDstAlpha = THREE.OneFactor;
    if (c.blend === 'normal' || matte) {
      m.blendSrc = THREE.SrcAlphaFactor;
      m.blendDst = THREE.OneMinusSrcAlphaFactor;
    } else {
      m.blendSrc = THREE.OneFactor;
      m.blendDst = c.blend === 'screen' ? THREE.OneMinusSrcColorFactor : THREE.OneFactor;
    }
    const h = Math.max(0.001, c.scale);
    it.mesh.scale.set(h * it.aspect, h, 1);
    it.mesh.position.set((c.x - 0.5) * this.aspect, c.y - 0.5, 0);
    it.mesh.rotation.z = THREE.MathUtils.degToRad(c.rotation);
    it.mesh.updateMatrixWorld();
    renderer.setRenderTarget(null);
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(it.mesh, this.camera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.generation++;
    this.clear();
    this.geometry.dispose();
  }

  private clear(): void {
    for (const it of this.items.values()) this.disposeItem(it);
    this.items.clear();
  }

  private disposeItem(it: Item): void {
    it.material.dispose();
    if (it.video) it.video.dispose();
    else it.texture.dispose();
  }
}
