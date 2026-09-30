import * as THREE from 'three';
import { shapeAudio, shapeBands } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { MAX_REGIONS, MAX_SPEAKERS, photoById, type Photo } from './photos';
import { createPhotoMaterial } from './shaders';

/**
 * 写真に動き — 用意された写真 (スピーカーと機材ラック・ライブステージ・スピーカーの通路) に、音で動く効果を付ける。
 *
 * 反応の仕組み:
 * - bass: スピーカーのコーンの所がふくらむ (重さのあるばね。強い音で前へ出て、少し行き過ぎて戻る)。
 *   奥のスピーカーほど少し遅れる (photos.ts の delay)。
 * - high: ツイーターが細かく震える。
 * - 帯域 (bands): 写真のスペクトラムの LED のバーが、音の高さごとの強さに合わせて伸び縮みする。
 * - rms (音量): メーター・LED・真空管などの明るい所が光る。
 * - beat: 照明が左右交互に少し強まる。拍の頭で写真がほんの少し震える。bass でスモークが少し濃くなる。
 * 光らせるのは写真の中の明るい画素だけ (暗い所はそのまま) で、強まり方もなめらかにする (光過敏への配慮)。
 *
 * 乱数は使わない (効果の形はすべて写真ごとの決まった位置と、音と時刻だけで決まる)。
 * 写真のファイルは src/assets/library/ (用意された背景と同じもの)。
 */

const SPECTRUM_BARS = 32;

/** 写真を読む (テストでは差し替える)。色は sRGB として読む */
export type TextureLoaderFn = (url: string) => Promise<THREE.Texture>;
const defaultLoader: TextureLoaderFn = async (url) => {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
};

export interface PhotoMotionInspection {
  photo: string;
  loaded: boolean;
  /** スピーカーごとのふくらみ */
  speakers: number[];
  /** 光る所ごとの強さ */
  regions: number[];
  globalGlow: number;
  haze: number;
  /** スペクトラムのバーの平均 (0..1) */
  spectrum: number;
  shake: number;
}

const fin = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const safeDt = (dt: number): number => (Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0);
function follow(cur: number, target: number, dt: number, up: number, down: number): number {
  const v = fin(target);
  return cur + (v - cur) * (1 - Math.exp(-(v > cur ? up : down) * dt));
}

export class PhotoMotionPreset implements VisualizerPreset {
  /** 写真の読み方 (テストで差し替える) */
  static loadTexture: TextureLoaderFn = defaultLoader;

  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private readonly material: THREE.ShaderMaterial;
  private readonly plane: THREE.Mesh;
  private readonly placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private readonly bandTexture: THREE.DataTexture;
  private readonly bandData = new Uint8Array(SPECTRUM_BARS * 4);
  private texture: THREE.Texture | null = null;
  private photo: Photo = photoById('speaker-rack');
  private wanted = '';
  private generation = 0;
  private aspect = 16 / 9;
  private t = 0;

  // 音の動き
  private spring = { x: 0, v: 0 };
  /** 低音のばねの動きの記録 (遅れて動くスピーカー用。1/120 秒ごと) */
  private readonly history = new Float32Array(64);
  private historyHead = 0;
  private historyAcc = 0;
  private highEnv = 0;
  private rmsEnv = 0;
  private beatEnv = 0;
  private bassSlow = 0;
  private shake = 0;
  private lastBeat = -1;
  private side = 0;
  private readonly bands = new Float32Array(64);
  private readonly bars = new Float32Array(SPECTRUM_BARS);

  constructor() {
    this.placeholder.needsUpdate = true;
    this.bandTexture = new THREE.DataTexture(this.bandData, SPECTRUM_BARS, 1);
    this.bandTexture.magFilter = THREE.LinearFilter;
    this.bandTexture.minFilter = THREE.LinearFilter;
    this.bandTexture.needsUpdate = true;
    this.material = createPhotoMaterial(this.placeholder, this.bandTexture);
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.plane.frustumCulled = false;
    this.scene.add(this.plane);
    this.scene.background = new THREE.Color(0x000000);
  }

  async init(ctx: VisualizerInitContext): Promise<void> {
    this.resize(ctx.width, ctx.height);
    // 最初の写真は、読み終わってから描き始める (書き出しの最初のフレームから写真が出るように)
    await this.selectPhoto(ctx.params.photo);
    this.writeUniforms(ctx.params);
  }

  update(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void {
    const dt = safeDt(frame.dt);
    this.t += dt;
    if ((typeof params.photo === 'string' ? params.photo : '') !== this.wanted) void this.selectPhoto(params.photo);

    const a = shapeAudio(frame, params);
    const k = fin(params.intensity);
    // 低音のばね (細かい刻みで進める)
    let left = dt;
    while (left > 0) {
      const h = Math.min(left, 1 / 240);
      const acc = 700 * (fin(a.bass) * k - this.spring.x) - 30 * this.spring.v;
      this.spring.v += acc * h;
      this.spring.x += this.spring.v * h;
      left -= h;
    }
    if (!Number.isFinite(this.spring.x) || !Number.isFinite(this.spring.v)) this.spring = { x: 0, v: 0 };
    this.historyAcc += dt;
    while (this.historyAcc >= 1 / 120) {
      this.historyAcc -= 1 / 120;
      this.historyHead = (this.historyHead + 1) % this.history.length;
      this.history[this.historyHead] = this.spring.x;
    }
    this.highEnv = follow(this.highEnv, fin(a.high) * k, dt, 30, 8);
    this.rmsEnv = follow(this.rmsEnv, fin(a.rms), dt, 12, 3);
    this.beatEnv = follow(this.beatEnv, fin(a.beat), dt, 20, 5);
    this.bassSlow = follow(this.bassSlow, fin(a.bass), dt, 3, 1);
    if (frame.beatIndex !== this.lastBeat && frame.beatIndex >= 0) {
      this.lastBeat = frame.beatIndex;
      this.side = frame.beatIndex % 2;
      this.shake = Math.max(this.shake, fin(a.beat) * k);
    }
    this.shake *= Math.exp(-dt * 10);

    // 帯域 → スペクトラムのバー (低い音の帯域を細かく、上をまとめる)
    shapeBands(frame.bands ?? new Float32Array(64), params, this.bands);
    const total = 56;
    for (let i = 0; i < SPECTRUM_BARS; i++) {
      const s0 = Math.floor(Math.pow(i / SPECTRUM_BARS, 1.6) * total);
      const s1 = Math.max(s0 + 1, Math.floor(Math.pow((i + 1) / SPECTRUM_BARS, 1.6) * total));
      let s = 0;
      for (let j = s0; j < s1; j++) s += fin(this.bands[j]!);
      const target = fin((s / (s1 - s0)) * (1 + (i / SPECTRUM_BARS) * 0.8) * (0.35 + 0.65 * k));
      this.bars[i] = follow(this.bars[i]!, target, dt, 40, 7);
      const v = Math.round(this.bars[i]! * 255);
      this.bandData[i * 4] = v;
      this.bandData[i * 4 + 1] = v;
      this.bandData[i * 4 + 2] = v;
      this.bandData[i * 4 + 3] = 255;
    }
    this.bandTexture.needsUpdate = true;
    this.writeUniforms(params);
  }

  resize(width: number, height: number): void {
    this.aspect = Math.max(1, width) / Math.max(1, height);
  }

  dispose(): void {
    this.generation++;
    this.texture?.dispose();
    this.texture = null;
    this.placeholder.dispose();
    this.bandTexture.dispose();
    this.material.dispose();
    this.plane.geometry.dispose();
    this.scene.clear();
  }

  /** テスト用 */
  inspect(): PhotoMotionInspection {
    const u = this.material.uniforms;
    return {
      photo: this.photo.id,
      loaded: this.texture != null,
      speakers: (u.speakers!.value as THREE.Vector4[]).slice(0, this.photo.speakers.length).map((s) => s.w),
      regions: (u.regionLevel!.value as THREE.Vector2[]).slice(0, this.photo.regions.length).map((r) => r.x),
      globalGlow: u.globalGlow!.value as number,
      haze: u.hazeAmount!.value as number,
      spectrum: this.bars.reduce((s, v) => s + v, 0) / SPECTRUM_BARS,
      shake: this.shake,
    };
  }

  // ----------------------------------------------------------------

  /** 写真を選ぶ。読み終わるまでは前の写真のまま (位置も前のまま)。途中で別の写真を選んだら、古い方は捨てる */
  private async selectPhoto(id: unknown): Promise<void> {
    this.wanted = typeof id === 'string' ? id : '';
    const photo = photoById(id);
    if (photo.id === this.photo.id && this.texture) return;
    const my = ++this.generation;
    let tex: THREE.Texture | null = null;
    try {
      tex = await PhotoMotionPreset.loadTexture(photo.url);
    } catch {
      tex = null;
    }
    if (my !== this.generation) {
      tex?.dispose();
      return;
    }
    if (!tex) return;
    this.texture?.dispose();
    this.texture = tex;
    this.photo = photo;
    this.material.uniforms.map!.value = tex;
    this.material.uniforms.photoAspect!.value = photo.aspect;
  }

  /** 遅れ (秒) の分だけ前の、低音のばねの動き */
  private delayed(delay: number): number {
    const n = Math.min(this.history.length - 1, Math.round(Math.max(0, delay) * 120));
    return n === 0 ? this.spring.x : this.history[(this.historyHead - n + this.history.length) % this.history.length]!;
  }

  private writeUniforms(params: CommonParams & Record<string, unknown>): void {
    const u = this.material.uniforms;
    const p = this.photo;
    const k = fin(params.intensity);
    const pump = typeof params.pump === 'number' ? fin(params.pump) : 0.7;
    const glowK = (typeof params.glowAmount === 'number' ? fin(params.glowAmount) : 0.7) * (0.3 + 0.7 * k);

    // 画面いっぱいに収める (はみ出した所を切る)。Camera Motion でゆっくり寄って、少し動く
    const cm = fin(params.cameraMotion);
    const zoom = 1 + 0.05 * cm * (0.5 + 0.5 * Math.sin(this.t * 0.05));
    let sx = 1;
    let sy = 1;
    if (this.aspect > p.aspect) sy = p.aspect / this.aspect;
    else sx = this.aspect / p.aspect;
    sx /= zoom;
    sy /= zoom;
    const shake = this.shake * 0.003;
    const ox = (1 - sx) / 2 + Math.sin(this.t * 0.07) * (1 - sx) * 0.3 + Math.sin(this.t * 57) * shake;
    const oy = (1 - sy) / 2 + Math.sin(this.t * 0.05) * (1 - sy) * 0.2 + Math.sin(this.t * 43) * shake;
    (u.uvScale!.value as THREE.Vector2).set(sx, sy);
    (u.uvOffset!.value as THREE.Vector2).set(ox, oy);

    // スピーカー (写真の y は上が 0 なので、下が 0 の uv に直す)
    const speakers = u.speakers!.value as THREE.Vector4[];
    for (let i = 0; i < MAX_SPEAKERS; i++) {
      const s = p.speakers[i];
      if (!s) {
        speakers[i]!.set(0, 0, 0, 0);
        continue;
      }
      const amount = s.band === 'bass' ? this.delayed(s.delay) * pump : this.highEnv * pump * 0.7 * Math.abs(Math.sin(this.t * 71 + i));
      speakers[i]!.set(s.x, 1 - s.y, s.r, Math.min(1.2, Math.max(-0.3, amount)));
    }
    // 光る所
    const regions = u.regions!.value as THREE.Vector4[];
    const levels = u.regionLevel!.value as THREE.Vector2[];
    const glow = (0.12 + 0.55 * this.rmsEnv) * glowK;
    for (let i = 0; i < MAX_REGIONS; i++) {
      const r = p.regions[i];
      if (!r) {
        regions[i]!.set(0, 0, 0, 0);
        levels[i]!.set(0, 0);
        continue;
      }
      regions[i]!.set(r.x, 1 - (r.y + r.h), r.x + r.w, 1 - r.y);
      let level = glow;
      if (r.kind === 'tubes') level = glow * (0.9 + 0.1 * Math.sin(this.t * 2.3) * Math.sin(this.t * 0.7)) + 0.1 * glowK;
      else if (r.kind === 'lightsL' || r.kind === 'lightsR') {
        const mine = (r.kind === 'lightsL' ? 0 : 1) === this.side;
        level = (0.08 + (mine ? 0.5 : 0.12) * this.beatEnv) * glowK;
      } else if (r.kind === 'spectrum') level = 0.5 * glowK;
      levels[i]!.set(level, r.kind === 'spectrum' ? 1 : 0);
    }
    u.globalGlow!.value = 0.04 * glowK;
    if (p.haze) {
      (u.hazeRect!.value as THREE.Vector4).set(p.haze.x, 1 - (p.haze.y + p.haze.h), p.haze.x + p.haze.w, 1 - p.haze.y);
      (u.hazeColor!.value as THREE.Color).setRGB(...p.haze.color);
      u.hazeAmount!.value = (0.05 + 0.08 * this.bassSlow) * (0.5 + 0.5 * glowK);
    } else {
      u.hazeAmount!.value = 0;
    }
    u.time!.value = this.t;
  }
}
