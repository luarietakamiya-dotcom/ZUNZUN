import * as THREE from 'three';
import { hashString } from '../random';
import type { AudioFrame, OverlayLayer } from '../types';

interface InternalLayer {
  config: OverlayLayer;
  sprite: THREE.Sprite;
  glowSprite: THREE.Sprite;
  texture: THREE.Texture;
  /** 画像の width/height (px)。正規化スケールを画面のアスペクト比に合わせて歪ませないために使う */
  naturalAspect: number;
  /** float アニメーションの位相をレイヤーごとにずらすためのオフセット (レイヤー id から決定論的に作る) */
  phase: number;
}

const GLOW_TEXTURE_SIZE = 128;
let glowTextureCache: THREE.Texture | null = null;

/** 柔らかい放射状グラデーションのテクスチャを 1 度だけ作って使い回す (glow スプライト用)。 */
function getGlowTexture(): THREE.Texture {
  if (glowTextureCache) return glowTextureCache;
  const canvas = document.createElement('canvas');
  canvas.width = GLOW_TEXTURE_SIZE;
  canvas.height = GLOW_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const r = GLOW_TEXTURE_SIZE / 2;
    const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GLOW_TEXTURE_SIZE, GLOW_TEXTURE_SIZE);
  }
  glowTextureCache = new THREE.CanvasTexture(canvas);
  return glowTextureCache;
}

/**
 * オーバーレイ画像 (PNG/WebP/JPG) を Visualizer プリセットの上に重ねて描く。
 * docs/ARCHITECTURE.md の Compositor 「前 = overlay」にあたる部分。
 *
 * プリセットの Scene とは別の Scene + 正射影カメラを持ち、VisualizerHost が
 * PostFX (Bloom) の描画が終わったあとに renderer.autoClear=false でこれを重ね描きする。
 * こうすることで、オーバーレイ画像自体は Bloom の影響を受けずにくっきり表示される
 * (glow はここで個別に加算合成のスプライトとして表現する)。
 *
 * このクラスはレイアウト設定 (OverlayLayer[]) を「持たない」— 設定の唯一の保持者は
 * core/store.ts であり、ここは Visualizer タブが (再) マウントされるたびに、その時点の
 * store の状態から一括で読み込まれる (loadFrom)。Three.js のリソースはタブ切り替えのたびに
 * 作り直される他のプリセットと同じ寿命を持つ。
 */
export class OverlayManager {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
  private readonly layers: InternalLayer[] = [];
  private width = 1;
  private height = 1;
  private t = 0;

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    // カメラ自体は常に 0..1 の正規化空間 (x=0.5,y=0.5 が中央)。歪み補正は各レイヤーの scale 計算側で行う
    this.camera.updateProjectionMatrix();
    for (const layer of this.layers) this.applyTransform(layer);
  }

  /**
   * Store が持つ (config, file) の組から、一括でオーバーレイ Sprite を作る。
   * 画像デコードに失敗したレイヤーはスキップし、他のレイヤーの表示には影響させない。
   */
  async loadFrom(entries: { config: OverlayLayer; file: File }[]): Promise<void> {
    const sorted = [...entries].sort((a, b) => a.config.z - b.config.z);
    for (const { config, file } of sorted) {
      try {
        // three.js は ImageBitmap ソースの場合、WebGL の UNPACK_FLIP_Y_WEBGL を設定できない
        // (ブラウザの仕様上 ImageBitmap には効かない) ため、texture.flipY ではなく
        // createImageBitmap() 自体に imageOrientation: 'flipY' を渡して上下を補正する必要がある。
        // これを忘れると画像が上下反転して表示される。
        const bitmap = await createImageBitmap(file, { imageOrientation: 'flipY' });
        const texture = new THREE.Texture(bitmap);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;

        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
        const sprite = new THREE.Sprite(material);

        const glowMaterial = new THREE.SpriteMaterial({
          map: getGlowTexture(),
          transparent: true,
          depthTest: false,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const glowSprite = new THREE.Sprite(glowMaterial);

        const internal: InternalLayer = {
          config,
          sprite,
          glowSprite,
          texture,
          naturalAspect: bitmap.width / Math.max(1, bitmap.height),
          // Math.random() だとプレビューと書き出しで揺れ方が変わってしまうので、id のハッシュから決める
          phase: ((hashString(config.id) % 10000) / 10000) * Math.PI * 2,
        };
        this.layers.push(internal);
        this.scene.add(glowSprite);
        this.scene.add(sprite);
      } catch {
        // 壊れた/読めない画像は無視する (他のオーバーレイ・プリセット本体には影響させない)
      }
    }
    this.layers.sort((a, b) => a.config.z - b.config.z);
    for (const layer of this.layers) this.applyTransform(layer);
  }

  /** 読み込んだ画像を全部片づける (読み込み直す前に呼ぶ。loadFrom は足していくだけなので) */
  clear(): void {
    this.dispose();
  }

  /**
   * 位置・大きさ・濃さなどの設定だけを差し替える (画像は読み込み直さない。毎フレーム呼んでよい)。
   * 「背景と素材」タブのプレビューで、つまみを動かすたびに画像を読み直さないように
   */
  setConfigs(configs: readonly OverlayLayer[]): void {
    const byId = new Map(configs.map((c) => [c.id, c]));
    let changed = false;
    for (const layer of this.layers) {
      const c = byId.get(layer.config.id);
      if (c && c !== layer.config) {
        layer.config = c;
        changed = true;
      }
    }
    if (!changed) return;
    this.layers.sort((a, b) => a.config.z - b.config.z);
    for (const layer of this.layers) this.applyTransform(layer);
  }

  /** 毎フレーム呼ぶ。float (上下浮遊) と beat (ビート反応の拡縮) をアニメーションさせる。 */
  animate(frame: AudioFrame): void {
    this.t += frame.dt > 0 ? frame.dt : 1 / 60;
    for (const layer of this.layers) this.applyTransform(layer, frame.beat);
  }

  /** PostFX (Bloom) を通さず、現在の描画結果の上に直接重ね描きする。呼び出し側で canvas を持つ renderer を渡す。 */
  render(renderer: THREE.WebGLRenderer): void {
    if (this.layers.length === 0) return;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.sprite.material.dispose();
      layer.glowSprite.material.dispose();
      layer.texture.dispose();
    }
    this.layers.length = 0;
    this.scene.clear();
  }

  private applyTransform(layer: InternalLayer, beat = 0): void {
    const { config } = layer;
    const floatOffset = config.float > 0 ? Math.sin(this.t * 1.6 + layer.phase) * 0.02 * config.float : 0;
    const beatBump = 1 + beat * config.beat * 0.25;

    layer.sprite.position.set(config.x, config.y + floatOffset, 0);
    layer.sprite.material.opacity = THREE.MathUtils.clamp(config.opacity, 0, 1);
    layer.sprite.material.rotation = config.rotation;
    layer.sprite.renderOrder = config.z * 2;

    // Sprite の scale はワールド単位 = 正規化スクリーン座標の単位。カメラは 0..1 の正方形空間なので、
    // canvas が正方形でない場合にそのまま使うと画像が歪む。画像自身のアスペクト比 (naturalAspect) と
    // canvas のアスペクト比の両方で補正し、見た目のアスペクト比が保たれるようにする。
    const canvasAspect = this.width / this.height;
    const baseHeight = config.scale * beatBump;
    const baseWidth = (baseHeight * layer.naturalAspect) / canvasAspect;
    layer.sprite.scale.set(baseWidth, baseHeight, 1);

    layer.glowSprite.position.copy(layer.sprite.position);
    layer.glowSprite.renderOrder = config.z * 2 - 1;
    layer.glowSprite.visible = config.glow > 0;
    if (config.glow > 0) {
      const glowScale = Math.max(baseWidth, baseHeight) * (1.4 + config.glow * 1.2);
      layer.glowSprite.scale.set(glowScale, glowScale, 1);
      layer.glowSprite.material.opacity = THREE.MathUtils.clamp(config.glow * config.opacity, 0, 1);
    }
  }
}
