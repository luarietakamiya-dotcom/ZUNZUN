import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { shapeAudio, shapeBands } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { speakerRackPalette, type SpeakerRackPalette } from './palette';
import { bandsToBars, follow, makeRadialTexture, PeakMeter, safeDt, stepSpring, type Materials, type Spring } from './parts';
import { EQ_BANDS, RACK_FIT_HALF_HEIGHT, RACK_FIT_HALF_WIDTH, RACK_LOOK_AT, RackScene, SPECTRUM_BARS } from './rack-scene';

/**
 * Speaker Rack — スピーカーと機材ラック (参考画像②)。
 *
 * 反応の仕組み:
 * - bass: 左右のウーファーのコーンが前後に動く (重さのあるばね。強い音で押し出され、少し行き過ぎて戻る)。
 *   ふちのゴムもたわむ。強い拍では箱ごとほんの少し震える。
 * - high: ツイーターが細かく震える。
 * - 帯域 (bands): スペクトラムの LED のバーが伸び、ピークの点がしばらく残ってゆっくり落ちる。イコライザーの LED も光る。
 * - rms (音量): VU メーターの針が慣性を持って振れ、右の赤い域で赤いランプが点く。レベルメーターが伸び、
 *   真空管と文字盤が少し明るくなる。
 * - beat: 足もとの灯りの帯が少し強まる。
 * 光るのは小さな LED・ランプ・真空管・細い帯だけなので、画面の広い範囲は点滅しない。
 *
 * 乱数は ctx.rng (つまみの角度・スライダーの位置・真空管のゆらぎ) だけを使い、Math.random は使わない。
 */

const CAMERA_FOV = 32;
/** ラックのアップのときに収めたい範囲 */
const CLOSEUP_HALF_WIDTH = 4.1;
const CLOSEUP_HALF_HEIGHT = 5.7;

export interface SpeakerRackInspection {
  woofer: number;
  tweeter: number;
  spectrumLit: number;
  levelLit: number;
  vu: number;
  vuLamp: boolean;
  tubeGlow: number;
  shake: number;
  layout: string;
}

export class SpeakerRackPreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 0.1, 200);

  private rng: () => number = () => 0.5;
  private themeName = '';
  private palette: SpeakerRackPalette = speakerRackPalette('default');
  private aspect = 16 / 9;
  private t = 0;
  private framing: 'full' | 'closeup' = 'full';

  private readonly disposables: { dispose(): void }[] = [];
  private materials!: Materials;
  private rack!: RackScene;
  private envTexture: THREE.Texture | null = null;
  private readonly accentLights: THREE.PointLight[] = [];

  // 音の動き
  private readonly woofer: [Spring, Spring] = [
    { x: 0, v: 0 },
    { x: 0, v: 0 },
  ];
  private tweeterEnv = 0;
  private rmsEnv = 0;
  private peakEnv = 0;
  private beatEnv = 0;
  private lastBeat = -1;
  private shake = 0;
  private tubePhase = 0;
  private readonly bands = new Float32Array(64);
  private readonly bars = new Float32Array(SPECTRUM_BARS);
  private readonly spectrum = new PeakMeter(SPECTRUM_BARS);
  private readonly eq = new Float32Array(EQ_BANDS);
  private readonly levels = new PeakMeter(2, 0.4, 0.8);
  private readonly levelValues = new Float32Array(2);
  private readonly vu: [number, number] = [0, 0];

  init(ctx: VisualizerInitContext): void {
    this.rng = ctx.rng;
    const track = <T extends { dispose(): void }>(o: T): T => this.track(o);
    const std = (o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => track(new THREE.MeshStandardMaterial(o));
    this.materials = {
      metal: std({ metalness: 0.85, roughness: 0.32 }),
      darkMetal: std({ metalness: 0.7, roughness: 0.5 }),
      cabinet: std({ metalness: 0.15, roughness: 0.85, side: THREE.DoubleSide }),
      cone: std({ metalness: 0.35, roughness: 0.55, side: THREE.DoubleSide }),
      rubber: std({ metalness: 0.05, roughness: 0.9 }),
      glass: std({ metalness: 0, roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false }),
      tick: track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.015, 0.012, 0.01) })),
      mark: track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.55, 0.55) })),
      glowBasic: track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })),
    };
    const halo = this.track(makeRadialTexture());
    this.rack = new RackScene(this.materials, track, this.rng, halo);
    this.scene.add(this.rack.group);
    this.tubePhase = this.rng() * Math.PI * 2;

    // 照明: ほの暗い全体光、上からの主な光、足もとの灯りの色の点光源 2 つ。金属の映り込みには部屋の環境 (RoomEnvironment)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.03));
    const key = new THREE.DirectionalLight(0xfff1e0, 0.8);
    key.position.set(-4, 9, 10);
    this.scene.add(key, key.target);
    const top = new THREE.SpotLight(0xffe2c0, 30, 30, Math.PI / 5, 0.6, 1.6);
    top.position.set(0, 12, 6);
    top.target.position.set(0, 0, 0);
    this.scene.add(top, top.target);
    for (const x of [-7.5, 7.5]) {
      const l = new THREE.PointLight(0xffffff, 6, 10, 1.8);
      l.position.set(x, -5.0, 2.2);
      this.accentLights.push(l);
      this.scene.add(l);
    }
    this.makeEnvironment(ctx.renderer);

    this.applyTheme(String(ctx.params.colorTheme ?? 'default'));
    this.resize(ctx.width, ctx.height);
    this.applyControls(ctx.params);
    this.updateCamera(ctx.params);
    this.writeScene(0);
  }

  update(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void {
    const dt = safeDt(frame.dt);
    this.t += dt;
    if (params.colorTheme !== this.themeName) this.applyTheme(params.colorTheme);
    this.applyControls(params);

    const a = shapeAudio(frame, params);
    const k = Number.isFinite(params.intensity) ? Math.min(1, Math.max(0, params.intensity)) : 0;
    const bass = fin(a.bass) * k;
    const high = fin(a.high) * k;
    const rms = fin(a.rms);
    const peak = fin(a.peak);

    // ウーファー: 低音でばねを押す。左右で少しだけ違う混ぜ方
    stepSpring(this.woofer[0], bass, dt, 700, 30);
    stepSpring(this.woofer[1], bass * 0.94 + fin(a.mid) * k * 0.06, dt, 700, 30);
    this.tweeterEnv = follow(this.tweeterEnv, high, dt, 30, 8);
    this.rmsEnv = follow(this.rmsEnv, rms, dt, 14, 3);
    this.peakEnv = follow(this.peakEnv, peak, dt, 30, 4);
    // 強い拍 (新しい拍の頭) で箱が少し震える
    if (frame.beatIndex !== this.lastBeat && frame.beatIndex >= 0) {
      this.lastBeat = frame.beatIndex;
      this.shake = Math.max(this.shake, fin(a.beat) * k);
    }
    this.shake *= Math.exp(-dt * 9);
    this.beatEnv = follow(this.beatEnv, fin(a.beat), dt, 25, 5);

    // 帯域 → スペクトラム・イコライザー
    shapeBands(frame.bands ?? new Float32Array(64), params, this.bands);
    for (let i = 0; i < this.bands.length; i++) this.bands[i] = fin(this.bands[i]!) * (0.35 + 0.65 * k);
    bandsToBars(this.bands, SPECTRUM_BARS, this.bars);
    this.spectrum.update(this.bars, dt);
    for (let i = 0; i < EQ_BANDS; i++) {
      const v = this.spectrum.level[Math.floor(((i + 0.5) / EQ_BANDS) * SPECTRUM_BARS)]!;
      this.eq[i] = v > 0.35 ? 1 : 0;
    }
    this.levelValues[0] = rms;
    this.levelValues[1] = Math.max(rms, peak * 0.85);
    this.levels.update(this.levelValues, dt);
    // VU メーター: 左は低音寄り、右は高音寄りを少し混ぜる (左右の振れ方が少し違って見える)
    this.vu[0] = rms * 0.85 + fin(a.bass) * 0.15;
    this.vu[1] = rms * 0.85 + fin(a.high) * 0.15;

    this.updateCamera(params);
    this.writeScene(dt);
  }

  resize(width: number, height: number): void {
    this.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.rack?.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.envTexture?.dispose();
    this.envTexture = null;
    this.scene.environment = null;
    this.scene.clear();
  }

  /** テスト用: 反応の結果を数値で覗く (描画には使わない) */
  inspect(): SpeakerRackInspection {
    return {
      woofer: this.rack.woofers[0]!.excursion,
      tweeter: this.tweeterEnv,
      spectrumLit: this.rack.spectrum.lit,
      levelLit: this.rack.levelBars.lit,
      vu: this.rack.meters[0]!.spring.x,
      vuLamp: this.rack.meters[0]!.lampOn,
      tubeGlow: this.tubeGlow(),
      shake: this.shake,
      layout: 'rack',
    };
  }

  // ----------------------------------------------------------------

  private track<T extends { dispose(): void }>(obj: T): T {
    this.disposables.push(obj);
    return obj;
  }

  /** 金属の映り込み用の環境。WebGL が使えない (テストの偽物の renderer) ときは作らない */
  private makeEnvironment(renderer: THREE.WebGLRenderer): void {
    if (typeof (renderer as { getContext?: unknown }).getContext !== 'function') return;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      this.envTexture = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      pmrem.dispose();
      this.scene.environment = this.envTexture;
      this.scene.environmentIntensity = 0.22;
    } catch {
      this.envTexture = null;
    }
  }

  private applyTheme(name: string): void {
    this.themeName = name;
    this.palette = speakerRackPalette(name);
    const p = this.palette;
    const m = this.materials;
    m.metal.color.copy(p.metal).multiplyScalar(4);
    m.darkMetal.color.copy(p.metal).multiplyScalar(1.4);
    m.cabinet.color.copy(p.cabinet).multiplyScalar(1.6);
    m.cone.color.copy(p.cone).multiplyScalar(3);
    m.rubber.color.copy(p.cabinet).multiplyScalar(1.5);
    m.glass.color.setRGB(0.9, 0.85, 0.8);
    this.scene.background = p.background.clone();
    for (const l of this.accentLights) l.color.copy(p.accent);
    this.rack.applyPalette(p);
  }

  private applyControls(params: Record<string, unknown>): void {
    this.framing = params.framing === 'closeup' ? 'closeup' : 'full';
  }

  private updateCamera(params: CommonParams & Record<string, unknown>): void {
    const cm = Number.isFinite(params.cameraMotion) ? Math.min(1, Math.max(0, params.cameraMotion)) : 0;
    const [hw, hh] = this.framing === 'closeup' ? [CLOSEUP_HALF_WIDTH, CLOSEUP_HALF_HEIGHT] : [RACK_FIT_HALF_WIDTH, RACK_FIT_HALF_HEIGHT];
    const tan = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
    // 横にも縦にも収まる距離 (縦長の画面でも、はみ出さない)
    const dist = Math.max(hh / tan, hw / (tan * this.aspect)) * 1.02;
    const look = RACK_LOOK_AT;
    this.camera.position.set(look.x + Math.sin(this.t * 0.08) * 0.8 * cm, look.y + 0.4 + Math.sin(this.t * 0.06) * 0.35 * cm, look.z + dist);
    this.camera.lookAt(look);
  }

  private tubeGlow(): number {
    // 真空管: 音量で少し明るく、ゆっくりゆらぐ (ゆらぎは seed で決まる位相)
    return Math.min(1, 0.45 + 0.45 * this.rmsEnv + 0.05 * Math.sin(this.t * 2.3 + this.tubePhase) * Math.sin(this.t * 0.7));
  }

  private writeScene(dt: number): void {
    const w0 = this.woofer[0].x;
    const w1 = this.woofer[1].x;
    const tw = this.tweeterEnv * 0.5;
    const jitter = Math.sin(this.t * 83) * tw;
    this.rack.update({
      woofer: [w0, w1],
      tweeter: [jitter, -jitter],
      spectrum: this.spectrum.level,
      spectrumPeak: this.spectrum.peak,
      eq: this.eq,
      levels: [this.levels.level[0]!, this.levels.level[1]!],
      vu: this.vu,
      tubeGlow: this.tubeGlow(),
      backlight: 0.55 + 0.35 * this.rmsEnv,
      accent: this.beatEnv,
      dt,
    });
    // 箱ごとの小さな震え (拍の頭で)
    const s = this.shake * 0.025;
    this.rack.group.position.set(Math.sin(this.t * 61) * s, Math.sin(this.t * 47) * s, 0);
  }
}

const fin = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
