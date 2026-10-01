import * as THREE from 'three';
import { shapeAudio, shapeBands } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { CANVAS_ASPECT, MAX_REGIONS, MAX_SPEAKERS, photoById, type Layer, type Region, type Scene } from './photos';
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
 * - beat: 照明が左右交互に少し強まる。bass でスモークが少し濃くなる。
 *   (拍の頭で写真全体を震わせていたが、コーンの動きが見えにくくなるのでやめた。2026-10-01 ユーザーの実機確認)
 * - 明かりの消えた絵には光を描き足す: VU の針は音量で振れ (針らしく、上がりは速く戻りはゆっくり)、LED の列も同じ高さまで点く。
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
  /** 層の数 */
  layers: number;
  /** 照明の層の濃さ (照明の層が無ければ -1) */
  lights: number;
  /** スピーカーごとのふくらみ (全部の層を下から順に) */
  speakers: number[];
  /** 光る所ごとの強さ (全部の層を下から順に) */
  regions: number[];
  globalGlow: number;
  haze: number;
  /** スペクトラムのバーの平均 (0..1) */
  spectrum: number;
  /** VU の針の振れ (左, 右。0..1) */
  needles: [number, number];
}

const fin = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const fin2 = (v: number): number => (Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : 0);

/** 光る所の種類 → シェーダーの番号 (shaders.ts の regionLevel.y) */
const REGION_KIND: Record<Region['kind'], number> = { glow: 0, tubes: 0, lightsL: 0, lightsR: 0, spectrum: 1, vu: 2, tubeGlow: 3, vent: 4, ventSpectrum: 5, meter: 6 };
const safeDt = (dt: number): number => (Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0);
function follow(cur: number, target: number, dt: number, up: number, down: number): number {
  const v = fin(target);
  return cur + (v - cur) * (1 - Math.exp(-(v > cur ? up : down) * dt));
}

/**
 * 曲の音の大きさに合わせる (オートレベル)。最近のいちばん大きい値に対する割合を返す。大きい音はすぐ覚え、静かな間はゆっくり下げる。
 * 高音・音量・帯域は解析で小さく出るので、これで動くようにする (Speaker Rack の AutoLevel と同じ考え。プリセット同士は部品を共有しない約束)
 */
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

/** 描いている層 1 枚 */
interface LayerState {
  def: Layer;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  texture: THREE.Texture;
}

export class PhotoMotionPreset implements VisualizerPreset {
  /** 写真の読み方 (テストで差し替える) */
  static loadTexture: TextureLoaderFn = defaultLoader;

  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /** どの層も、画面いっぱいのこの板で描く */
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly bandTexture: THREE.DataTexture;
  private readonly bandData = new Uint8Array(SPECTRUM_BARS * 4);
  private layers: LayerState[] = [];
  private photo: Scene = photoById('speaker-rack');
  private loaded = false;
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
  /** VU の針 (左, 右) */
  private readonly needle = [0, 0];
  private lastBeat = -1;
  private side = 0;
  private readonly bands = new Float32Array(64);
  private readonly bars = new Float32Array(SPECTRUM_BARS);
  private readonly autoBass = new AutoLevel(0.25);
  private readonly autoHigh = new AutoLevel(0.006);
  private readonly autoRms = new AutoLevel(0.03);
  private readonly autoBands = new AutoLevel(0.05);

  constructor() {
    this.bandTexture = new THREE.DataTexture(this.bandData, SPECTRUM_BARS, 1);
    this.bandTexture.magFilter = THREE.LinearFilter;
    this.bandTexture.minFilter = THREE.LinearFilter;
    this.bandTexture.needsUpdate = true;
    this.scene.background = new THREE.Color(0x000000);
  }

  async init(ctx: VisualizerInitContext): Promise<void> {
    this.resize(ctx.width, ctx.height);
    // 最初の場面は、絵を全部読み終わってから描き始める (書き出しの最初のフレームから絵が出るように)
    await this.selectPhoto(ctx.params.photo);
    this.writeUniforms(ctx.params);
  }

  update(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void {
    const dt = safeDt(frame.dt);
    this.t += dt;
    if ((typeof params.photo === 'string' ? params.photo : '') !== this.wanted) void this.selectPhoto(params.photo);

    const a = shapeAudio(frame, params);
    const k = fin(params.intensity);
    // 曲の音の大きさに合わせてから使う (AutoLevel)
    const bassN = this.autoBass.update(fin(a.bass), dt);
    const highN = this.autoHigh.update(fin(a.high), dt);
    const rmsN = this.autoRms.update(fin(a.rms), dt);
    // 低音のばね (細かい刻みで進める)
    let left = dt;
    while (left > 0) {
      const h = Math.min(left, 1 / 240);
      const acc = 700 * (bassN * k - this.spring.x) - 30 * this.spring.v;
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
    this.highEnv = follow(this.highEnv, highN * k, dt, 30, 8);
    this.rmsEnv = follow(this.rmsEnv, rmsN, dt, 12, 3);
    this.beatEnv = follow(this.beatEnv, fin(a.beat), dt, 20, 5);
    this.bassSlow = follow(this.bassSlow, bassN, dt, 3, 1);
    if (frame.beatIndex !== this.lastBeat && frame.beatIndex >= 0) {
      this.lastBeat = frame.beatIndex;
      this.side = frame.beatIndex % 2;
    }
    // VU の針: 上がりは速く、戻りはゆっくり。右は少し高音寄り (曲は 1 本の音なので、左右に差を付ける)
    this.needle[0] = follow(this.needle[0]!, rmsN * (0.35 + 0.65 * k), dt, 14, 3.5);
    this.needle[1] = follow(this.needle[1]!, (0.75 * rmsN + 0.25 * highN) * (0.35 + 0.65 * k), dt, 14, 3.5);

    // 帯域 → スペクトラムのバー (低い音の帯域を細かく、上をまとめる)
    shapeBands(frame.bands ?? new Float32Array(64), params, this.bands);
    let bandMax = 0;
    for (let i = 0; i < this.bands.length; i++) bandMax = Math.max(bandMax, fin(this.bands[i]!));
    const bandGain = bandMax > 0 ? this.autoBands.update(bandMax, dt) / bandMax : 0;
    for (let i = 0; i < this.bands.length; i++) this.bands[i] = fin(fin(this.bands[i]!) * bandGain);
    const total = 56;
    for (let i = 0; i < SPECTRUM_BARS; i++) {
      const s0 = Math.floor(Math.pow(i / SPECTRUM_BARS, 1.6) * total);
      const s1 = Math.max(s0 + 1, Math.floor(Math.pow((i + 1) / SPECTRUM_BARS, 1.6) * total));
      let s = 0;
      for (let j = s0; j < s1; j++) s += fin(this.bands[j]!);
      // 耳の感じ方に近づける (小さい値を持ち上げる)
      // (2026-10-01: 伸びが悪いとの声で、持ち上げを強めて上まで届くようにした)
      const target = fin(Math.pow(fin((s / (s1 - s0)) * (1 + (i / SPECTRUM_BARS) * 0.8)), 0.5) * 1.15 * (0.45 + 0.55 * k));
      this.bars[i] = follow(this.bars[i]!, target, dt, 40, 6);
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
    this.clearLayers();
    this.bandTexture.dispose();
    this.geometry.dispose();
    this.scene.clear();
  }

  /** テスト用 */
  inspect(): PhotoMotionInspection {
    const speakers: number[] = [];
    const regions: number[] = [];
    let haze = 0;
    let lights = -1;
    let globalGlow = 0;
    for (const l of this.layers) {
      const u = l.material.uniforms;
      speakers.push(...(u.speakers!.value as THREE.Vector4[]).slice(0, l.def.speakers.length).map((s) => s.w));
      regions.push(...(u.regionLevel!.value as THREE.Vector2[]).slice(0, l.def.regions.length).map((r) => r.x));
      haze = Math.max(haze, u.hazeAmount!.value as number);
      globalGlow = Math.max(globalGlow, u.globalGlow!.value as number);
      if (l.def.lights) lights = u.layerOpacity!.value as number;
    }
    return {
      photo: this.photo.id,
      loaded: this.loaded,
      layers: this.layers.length,
      lights,
      speakers,
      regions,
      globalGlow,
      haze,
      spectrum: this.bars.reduce((s, v) => s + v, 0) / SPECTRUM_BARS,
      needles: [this.needle[0]!, this.needle[1]!],
    };
  }

  // ----------------------------------------------------------------

  /**
   * 場面を選ぶ。絵を全部読み終わるまでは前の場面のまま。途中で別の場面を選んだら、古い方は捨てる。
   * 読めなかった絵の層は飛ばす (ほかの層は描く)。1 枚も読めなければ前の場面のまま
   */
  private async selectPhoto(id: unknown): Promise<void> {
    this.wanted = typeof id === 'string' ? id : '';
    const photo = photoById(id);
    if (photo.id === this.photo.id && this.loaded) return;
    const my = ++this.generation;
    const textures = await Promise.all(photo.layers.map((l) => PhotoMotionPreset.loadTexture(l.url).catch(() => null)));
    if (my !== this.generation) {
      for (const t of textures) t?.dispose();
      return;
    }
    if (textures.every((t) => t == null)) return;
    this.clearLayers();
    this.photo = photo;
    this.loaded = true;
    (this.scene.background as THREE.Color).setRGB(...photo.background);
    photo.layers.forEach((def, i) => {
      const texture = textures[i];
      if (!texture) return;
      const material = createPhotoMaterial(texture, this.bandTexture);
      material.uniforms.photoAspect!.value = def.aspect;
      material.uniforms.offDim!.value = def.offDim;
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = i;
      this.scene.add(mesh);
      this.layers.push({ def, mesh, material, texture });
    });
  }

  private clearLayers(): void {
    for (const l of this.layers) {
      this.scene.remove(l.mesh);
      l.material.dispose();
      l.texture.dispose();
    }
    this.layers = [];
  }

  /** 遅れ (秒) の分だけ前の、低音のばねの動き */
  private delayed(delay: number): number {
    const n = Math.min(this.history.length - 1, Math.round(Math.max(0, delay) * 120));
    return n === 0 ? this.spring.x : this.history[(this.historyHead - n + this.history.length) % this.history.length]!;
  }

  private writeUniforms(params: CommonParams & Record<string, unknown>): void {
    const k = fin(params.intensity);
    const pump = typeof params.pump === 'number' ? fin(params.pump) : 0.7;
    const glowK = (typeof params.glowAmount === 'number' ? fin(params.glowAmount) : 0.7) * (0.3 + 0.7 * k);

    // 画面いっぱいに画用紙を収める (はみ出した所を切る)。Camera Motion でゆっくり寄って、少し動く
    const cm = fin(params.cameraMotion);
    const zoom = 1 + 0.05 * cm * (0.5 + 0.5 * Math.sin(this.t * 0.05));
    let sx = 1;
    let sy = 1;
    if (this.aspect > CANVAS_ASPECT) sy = CANVAS_ASPECT / this.aspect;
    else sx = this.aspect / CANVAS_ASPECT;
    sx /= zoom;
    sy /= zoom;
    const ox = (1 - sx) / 2 + Math.sin(this.t * 0.07) * (1 - sx) * 0.3;
    const oy = (1 - sy) / 2 + Math.sin(this.t * 0.05) * (1 - sy) * 0.2;

    // 照明の層の濃さ: 静かなときはほぼ消え、音量と拍で点く (なめらかに。拍で強まる幅は控えめ)
    const lights = Math.min(1, 0.1 + (0.75 * this.rmsEnv + 0.35 * this.beatEnv) * glowK * 1.4);
    let speakerIndex = 0;
    for (const l of this.layers) {
      const u = l.material.uniforms;
      const def = l.def;
      (u.uvScale!.value as THREE.Vector2).set(sx, sy);
      (u.uvOffset!.value as THREE.Vector2).set(ox, oy);
      // 層の置き場所 (画用紙の上。下が 0 の uv に直す)
      if (def.place === 'cover') (u.partRect!.value as THREE.Vector4).set(0, 0, 1, 1);
      else {
        const h = def.place.h;
        const w = (h * def.aspect) / CANVAS_ASPECT;
        (u.partRect!.value as THREE.Vector4).set(def.place.x - w / 2, 1 - (def.place.y + h / 2), def.place.x + w / 2, 1 - (def.place.y - h / 2));
      }
      u.layerOpacity!.value = def.lights ? lights : 1;

      // スピーカー (絵の y は上が 0 なので、下が 0 の uv に直す)
      const speakers = u.speakers!.value as THREE.Vector4[];
      for (let i = 0; i < MAX_SPEAKERS; i++) {
        const s = def.speakers[i];
        if (!s) {
          speakers[i]!.set(0, 0, 0, 0);
          continue;
        }
        const amount = s.band === 'bass' ? this.delayed(s.delay) * pump : this.highEnv * pump * 0.7 * Math.abs(Math.sin(this.t * 71 + speakerIndex));
        speakers[i]!.set(s.x, 1 - s.y, s.r, Math.min(1.2, Math.max(-0.3, amount)));
        speakerIndex++;
      }
      // 光る所。明かりの消える層 (offDim > 0) は、静かなときは 0 (消える)、大きい音で 1 (点く) まで
      const regions = u.regions!.value as THREE.Vector4[];
      const levels = u.regionLevel!.value as THREE.Vector4[];
      const glow = def.offDim > 0 ? Math.min(1, (0.1 + 1.0 * this.rmsEnv) * glowK * 1.3) : (0.12 + 0.55 * this.rmsEnv) * glowK;
      for (let i = 0; i < MAX_REGIONS; i++) {
        const r = def.regions[i];
        if (!r) {
          regions[i]!.set(0, 0, 0, 0);
          levels[i]!.set(0, 0, 0, 0);
          continue;
        }
        regions[i]!.set(r.x, 1 - (r.y + r.h), r.x + r.w, 1 - r.y);
        const kindCode = REGION_KIND[r.kind];
        const needle = this.needle[r.ch ?? 0]!;
        let level = glow;
        let extra = 0;
        if (r.kind === 'vu') {
          // 盤面の灯りはいつも点いていて、音量で少し明るく
          level = (0.4 + 0.45 * this.rmsEnv) * glowK;
          extra = needle;
        } else if (r.kind === 'meter') {
          level = 0.6 + 0.4 * glowK;
          extra = needle;
        } else if (r.kind === 'tubeGlow') level = (0.35 + 0.55 * this.rmsEnv) * glowK * (0.94 + 0.06 * Math.sin(this.t * 2.3) * Math.sin(this.t * 0.7));
        else if (r.kind === 'vent') level = (0.12 + 0.6 * this.rmsEnv) * glowK;
        else if (r.kind === 'ventSpectrum') level = 0.4 + 0.6 * glowK;
        else if (r.kind === 'tubes') level = glow * (0.9 + 0.1 * Math.sin(this.t * 2.3) * Math.sin(this.t * 0.7)) + 0.1 * glowK;
        else if (r.kind === 'lightsL' || r.kind === 'lightsR') {
          const mine = (r.kind === 'lightsL' ? 0 : 1) === this.side;
          level = (0.08 + (mine ? 0.5 : 0.12) * this.beatEnv) * glowK;
        } else if (r.kind === 'spectrum') level = 0.5 * glowK;
        levels[i]!.set(Math.min(def.offDim > 0 ? 1 : 2, fin2(level)), kindCode, fin(extra), 0);
      }
      u.globalGlow!.value = def.offDim > 0 || def.lights ? 0 : 0.04 * glowK;
      if (def.haze) {
        (u.hazeRect!.value as THREE.Vector4).set(def.haze.x, 1 - (def.haze.y + def.haze.h), def.haze.x + def.haze.w, 1 - def.haze.y);
        (u.hazeColor!.value as THREE.Color).setRGB(...def.haze.color);
        u.hazeAmount!.value = (0.05 + 0.08 * this.bassSlow) * (0.5 + 0.5 * glowK);
      } else {
        u.hazeAmount!.value = 0;
      }
      u.time!.value = this.t;
    }
  }
}
