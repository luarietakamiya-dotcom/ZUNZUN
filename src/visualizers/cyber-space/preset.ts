import * as THREE from 'three';
import { shapeAudio } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { sceneById, SCENES, type CyberScene } from './scenes';
import { createCyberMaterial, createWarpMaterial, MAX_RINGS } from './shaders';

/**
 * サイバー空間 — 用意したネオンの空間の絵 3 枚を、音で光らせて派手にする。ユーザー要望 (2026-10-02)
 * 「サイバー空間！とりあえず光らせて派手にするビジュアライザー」。
 *
 * 反応の仕組み:
 * - ネオン (明るくて色の濃い所): 音量で 1 より明るくなり、ブルームでにじむ。拍で少しだけ強まる。
 * - 光の波: 拍ごとに、奥の消失点から輪が広がる (最大 4 本。1.6 秒で消える)。
 * - 寄る: 低音のばね (強い音で奥へ寄り、少し行き過ぎて戻る) + 放射状のブレ。
 * - ワープの線: 奥から外へ飛ぶ光の線。音量で速く・明るくなる。
 * - 色ずれ: 低音で大きくなる。色の移り変わり: ネオンの色がゆっくり回る (時刻だけで決まる)。
 * 画面全体を点滅させない (明るさの変化はなめらかに。光るのはネオンの所と輪の通る所だけ)。光過敏の見張り (flash-safety) に入れている。
 *
 * 乱数は init() の ctx.rng だけ (ワープの線の向き・速さ)。輪は拍の時刻から決まる。
 */

export const MAX_WARP = 160;

export type TextureLoaderFn = (url: string) => Promise<THREE.Texture>;
const defaultLoader: TextureLoaderFn = async (url) => {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
};

export interface CyberSpaceInspection {
  scene: string;
  loaded: boolean;
  zoom: number;
  zoomBlur: number;
  split: number;
  neon: number;
  hue: number;
  energy: number;
  /** 出ている輪の強さ (0 = 出ていない) */
  rings: number[];
  warpCount: number;
  warpBrightness: number;
}

const fin = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? fin(v) : d);
const safeDt = (dt: number): number => (Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0);
function follow(cur: number, target: number, dt: number, up: number, down: number): number {
  const v = fin(target);
  return cur + (v - cur) * (1 - Math.exp(-(v > cur ? up : down) * dt));
}

/** 曲の音の大きさに合わせる (オートレベル。プリセット同士は部品を共有しない約束なので、ここにも持つ) */
class AutoLevel {
  private ref: number;
  constructor(
    private readonly floor: number,
    private readonly release = 4,
  ) {
    this.ref = floor;
  }
  update(value: number, dt: number): number {
    const v = Number.isFinite(value) ? Math.max(0, value) : 0;
    if (v > this.ref) this.ref = v;
    else this.ref += (v - this.ref) * (1 - Math.exp(-dt / this.release));
    this.ref = Math.max(this.floor, this.ref);
    return Math.min(1, v / this.ref);
  }
}

/** 輪が消えるまでの秒数と、広がる速さ (絵の高さ = 1 として 1 秒に) */
const RING_LIFE = 1.6;
const RING_SPEED = 1.1;

export class CyberSpacePreset implements VisualizerPreset {
  /** 絵の読み方 (テストで差し替える) */
  static loadTexture: TextureLoaderFn = defaultLoader;

  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly bgGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly bgMaterial = createCyberMaterial();
  private readonly wGeometry = new THREE.InstancedBufferGeometry();
  private readonly wMaterial = createWarpMaterial();
  private readonly warp: THREE.Mesh;

  private texture: THREE.Texture | null = null;
  private current: CyberScene = SCENES[0]!;
  private loaded = false;
  private wanted = '';
  private generation = 0;
  private aspect = 16 / 9;

  private time = 0;
  private warpTime = 0;
  private spring = { x: 0, v: 0 };
  private rmsEnv = 0;
  private beatEnv = 0;
  private bassEnv = 0;
  private lastBeat = -1;
  /** 輪ごとの経過秒 (負 = 出ていない) */
  private readonly ringAge = new Array<number>(MAX_RINGS).fill(-1);
  private ringNext = 0;
  private readonly autoBass = new AutoLevel(0.25);
  private readonly autoRms = new AutoLevel(0.03);

  constructor() {
    const bg = new THREE.Mesh(this.bgGeometry, this.bgMaterial);
    bg.frustumCulled = false;
    bg.renderOrder = 0;
    this.scene.add(bg);

    const quad = new THREE.PlaneGeometry(1, 1);
    this.wGeometry.index = quad.index;
    this.wGeometry.setAttribute('position', quad.getAttribute('position'));
    this.wGeometry.setAttribute('seed', new THREE.InstancedBufferAttribute(new Float32Array(MAX_WARP * 4), 4));
    this.wGeometry.instanceCount = 0;
    quad.dispose();
    this.warp = new THREE.Mesh(this.wGeometry, this.wMaterial);
    this.warp.frustumCulled = false;
    this.warp.renderOrder = 1;
    this.scene.add(this.warp);
    this.scene.background = new THREE.Color(0x000000);
  }

  async init(ctx: VisualizerInitContext): Promise<void> {
    this.resize(ctx.width, ctx.height);
    const seed = this.wGeometry.getAttribute('seed') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < MAX_WARP; i++) seed.setXYZW(i, ctx.rng(), ctx.rng(), ctx.rng(), ctx.rng());
    seed.needsUpdate = true;
    await this.selectScene(ctx.params.scene);
    this.writeUniforms(ctx.params);
  }

  update(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void {
    const dt = safeDt(frame.dt);
    if ((typeof params.scene === 'string' ? params.scene : '') !== this.wanted) void this.selectScene(params.scene);
    const a = shapeAudio(frame, params);
    const k = fin(params.intensity);
    const bassN = this.autoBass.update(fin(a.bass), dt);
    const rmsN = this.autoRms.update(fin(a.rms), dt);
    this.rmsEnv = follow(this.rmsEnv, rmsN, dt, 8, 2.5);
    this.beatEnv = follow(this.beatEnv, fin(a.beat), dt, 18, 4);
    this.bassEnv = follow(this.bassEnv, bassN, dt, 20, 5);
    // 低音のばね (細かい刻みで進める)
    let left = dt;
    while (left > 0) {
      const h = Math.min(left, 1 / 240);
      const acc = 260 * (bassN * k - this.spring.x) - 18 * this.spring.v;
      this.spring.v += acc * h;
      this.spring.x += this.spring.v * h;
      left -= h;
    }
    if (!Number.isFinite(this.spring.x) || !Number.isFinite(this.spring.v)) this.spring = { x: 0, v: 0 };
    // 拍で輪を出す
    if (frame.beatIndex !== this.lastBeat && frame.beatIndex >= 0) {
      this.lastBeat = frame.beatIndex;
      this.ringAge[this.ringNext] = 0;
      this.ringNext = (this.ringNext + 1) % MAX_RINGS;
    }
    for (let i = 0; i < MAX_RINGS; i++) {
      const age = this.ringAge[i]!;
      if (age >= 0) this.ringAge[i] = age + dt > RING_LIFE ? -1 : age + dt;
    }
    this.time += dt;
    this.warpTime += dt * (0.6 + 1.4 * this.rmsEnv * (0.4 + 0.6 * fin(params.motion)));
    this.writeUniforms(params);
  }

  resize(width: number, height: number): void {
    this.aspect = Math.max(1, width) / Math.max(1, height);
  }

  dispose(): void {
    this.generation++;
    this.texture?.dispose();
    this.texture = null;
    this.bgMaterial.dispose();
    this.bgGeometry.dispose();
    this.wMaterial.dispose();
    this.wGeometry.dispose();
    this.scene.clear();
  }

  /** テスト用 */
  inspect(): CyberSpaceInspection {
    const u = this.bgMaterial.uniforms;
    return {
      scene: this.current.id,
      loaded: this.loaded,
      zoom: u.zoom!.value as number,
      zoomBlur: u.zoomBlur!.value as number,
      split: u.split!.value as number,
      neon: u.neon!.value as number,
      hue: u.hue!.value as number,
      energy: u.energy!.value as number,
      rings: (u.rings!.value as THREE.Vector2[]).map((r) => r.y),
      warpCount: this.warp.visible ? this.wGeometry.instanceCount : 0,
      warpBrightness: this.wMaterial.uniforms.brightness!.value as number,
    };
  }

  // ----------------------------------------------------------------

  /** 場面を選ぶ。絵を読み終わるまでは前の場面のまま。途中で別の場面を選んだら、古い方は捨てる */
  private async selectScene(id: unknown): Promise<void> {
    this.wanted = typeof id === 'string' ? id : '';
    const next = sceneById(id);
    if (next.id === this.current.id && this.loaded) return;
    const my = ++this.generation;
    const tex = await CyberSpacePreset.loadTexture(next.url).catch(() => null);
    if (my !== this.generation) {
      tex?.dispose();
      return;
    }
    if (!tex) return;
    this.texture?.dispose();
    this.texture = tex;
    this.current = next;
    this.loaded = true;
    this.bgMaterial.uniforms.map!.value = tex;
  }

  private writeUniforms(params: CommonParams & Record<string, unknown>): void {
    const k = fin(params.intensity);
    const u = this.bgMaterial.uniforms;
    const sc = this.current;
    // 画面いっぱいに収める (はみ出した所を切る)
    const fx = Math.min(1, this.aspect / sc.aspect);
    const fy = Math.min(1, sc.aspect / this.aspect);
    (u.fit!.value as THREE.Vector2).set(fx, fy);
    const vpx = sc.vp[0];
    const vpy = 1 - sc.vp[1];
    (u.vp!.value as THREE.Vector2).set(vpx, vpy);
    u.imgAspect!.value = sc.aspect;

    // 寄る: 低音のばね + ゆっくりした呼吸 (Camera Motion)
    const zoomK = num(params.zoom, 0.6);
    const kick = Math.max(-0.2, Math.min(1.3, this.spring.x));
    const breath = 0.015 * fin(params.cameraMotion) * (1 - Math.cos(this.time * 0.25));
    u.zoom!.value = 1 + breath + 0.07 * zoomK * kick;
    u.zoomBlur!.value = 0.04 * zoomK * Math.max(0, kick) * (0.4 + 0.6 * k);
    u.split!.value = num(params.rgbSplit, 0.4) * (0.002 + 0.012 * this.bassEnv * k);
    const neonK = num(params.neon, 0.8);
    u.neon!.value = neonK * sc.gain * (0.2 + 1.0 * this.rmsEnv * (0.4 + 0.6 * k) + 0.2 * this.beatEnv * k);
    // 色の移り変わり: 1 で 1 周およそ 40 秒
    u.hue!.value = num(params.colorShift, 0) * ((this.time * Math.PI * 2) / 40);
    u.energy!.value = this.rmsEnv * k;
    const ringK = num(params.rings, 0.7) * (0.4 + 0.6 * k) * (0.5 + 0.5 * sc.gain);
    const rings = u.rings!.value as THREE.Vector2[];
    for (let i = 0; i < MAX_RINGS; i++) {
      const age = this.ringAge[i]!;
      if (age < 0 || ringK <= 0) {
        rings[i]!.set(0, 0);
        continue;
      }
      const life = age / RING_LIFE;
      rings[i]!.set(age * RING_SPEED, ringK * 0.9 * (1 - life) * (1 - life) * Math.min(1, age / 0.06));
    }

    // ワープの線
    const warpK = num(params.warp, 0.6);
    const n = Math.round(MAX_WARP * warpK);
    this.warp.visible = n > 0;
    this.wGeometry.instanceCount = n;
    const w = this.wMaterial.uniforms;
    w.time!.value = this.warpTime;
    w.aspect!.value = this.aspect;
    (w.vpScreen!.value as THREE.Vector2).set(0.5 + (vpx - 0.5) / fx, 0.5 + (vpy - 0.5) / fy);
    w.stretch!.value = 0.7 + 0.8 * this.rmsEnv;
    w.brightness!.value = 0.5 + 1.5 * this.rmsEnv * (0.4 + 0.6 * k);
  }
}
