import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { shapeAudio, shapeBands } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { solarGatePalette, type SolarGatePalette } from './palette';
import {
  CURTAIN_COUNT,
  CURTAIN_PLANE,
  createCurtainMaterial,
  createFlareMaterial,
  createPortalMaterial,
  createSkyMaterial,
  FRINGE_SECTORS,
  floorReflectorShader,
  PLANE_EXTENT,
} from './shaders';
import { makeRadialTexture } from './textures';

/**
 * Solar Gate — 黒い宇宙の水面に立つ、金の月食リング。
 * 2026-10-03 ユーザー「金の月食リング。オーロラ (フレア)、棒というよりもオーロラみたいなのが伸びる感じ。ほかももっといい感じに」で作り直した
 * (上書き)。以前の 200 本の細い光線は、オーロラの縁とフレアに変えた。
 *
 * 反応の仕組み (docs/ARCHITECTURE.md「プリセット初期3種の反応設計」):
 * - 円環そのものは拡大縮小しない (常に scale 1)。明るさだけが変わる。
 * - 月食リングのフレア: リングの 1 か所が太陽のように燃え (ダイヤモンド)、そこからオーロラのようなフレアが外へ流れる。
 *   燃える位置はゆっくり輪を回り (約 40 秒で 1 周)、拍で少し速くなる。強さは rms・mid・beat で変わる。
 * - bass: 輪のまわりに、やわらかいオーロラの縁が伸びる。方位ごとに担当の帯域を持たせ、スペクトルの形も出す。
 * - beat: 地面から立ち上がるオーロラのカーテン (9 本) がフラッシュする。カーテンの高さと明るさは、担当の帯域と低音で変わる。
 * - high: 円周から火の粉のような粒子が放出される。ビートの瞬間には小さなバーストも出す。星が金色にまたたく。
 * - mid: 門の内側の膜 (portal) の輝き。rms: 空の星雲のもや。
 * - 水面 (Reflector) に全体が縦に長く映り込み、さざ波が立ち、Bloom でにじむ。
 *
 * 乱数は Host から渡される ctx.rng (project.seed 由来) だけを使い、Math.random は使わない。
 */

const RING_RADIUS = 2.6;
const RING_CENTER_Y = RING_RADIUS + 0.32;
/** 輪のまわりのオーロラの縁の方位の数 (shaders.ts の FRINGE_SECTORS と同じ) */
const RAY_COUNT = FRINGE_SECTORS;
/** 縁の最大の伸び (世界の長さ) */
const RAY_MAX_LENGTH = 2.8;
/** 縁が担当する帯域の範囲 (64 帯域のうち、実際にエネルギーが乗りやすい下側 40 帯域) */
const RAY_BAND_SPAN = 40;
const PARTICLE_COUNT = 1600;
const STAR_COUNT = 1100;
/** 月食のフレアの燃える位置が輪を 1 周する秒数 (拍・Motion で速くなる)。初めは右上 (ラジアン) */
const FLARE_PERIOD_SEC = 40;
const FLARE_START_ANGLE = 0.95;
/** カーテンの高さ (世界の長さ): 静かなとき → いちばん高いとき */
const CURTAIN_MIN_H = 4.2;
const CURTAIN_MAX_H = 11.5;
const CAMERA_FOV = 42;
const CAMERA_BASE_DISTANCE = 13;
/** 画面の横幅に最低限収めたい範囲 (円環 + 光線の根元付近)。縦長の書き出しでもはみ出さないようにする */
const FIT_HALF_WIDTH = RING_RADIUS + 1.3;
const LOOK_AT = new THREE.Vector3(0, 2.75, 0);

export interface SolarGateInspection {
  ringScale: number;
  /** 輪のまわりのオーロラの縁の、方位ごとの伸びの平均 (世界の長さ) */
  meanRayLength: number;
  activeParticles: number;
  /** カーテンの明るさの倍率 (拍でフラッシュする) */
  pillarStrength: number;
  cameraDistance: number;
  /** 月食のフレアの強さ (0..) と、燃えている位置 (ラジアン。0 = 右、反時計回り) */
  flareStrength: number;
  flareAngle: number;
  /** カーテンの高さの平均 (世界の長さ) */
  curtainHeight: number;
}

export class SolarGatePreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 400);

  private rng: () => number = () => 0.5;
  private renderer: THREE.WebGLRenderer | null = null;
  private themeName = '';
  private palette: SolarGatePalette = solarGatePalette('default');
  private t = 0;
  private lastBeatIndex = -1;
  private baseDistance = CAMERA_BASE_DISTANCE;

  private readonly disposables: { dispose(): void }[] = [];

  // 円環まわり
  private readonly gate = new THREE.Group();
  private ringMaterial!: THREE.MeshBasicMaterial;
  private ring!: THREE.Mesh;
  private innerRingMaterial!: THREE.MeshBasicMaterial;
  private tickGroup!: THREE.Group;
  private tickMaterial!: THREE.MeshBasicMaterial;
  private portalMaterial!: THREE.ShaderMaterial;

  // 月食のフレアと、輪のまわりのオーロラの縁
  private flareMaterial!: THREE.ShaderMaterial;
  private flareAngle = FLARE_START_ANGLE;
  private flareEnv = 0;
  private beatEnv = 0;
  private readonly rayBand = new Uint8Array(RAY_COUNT);
  private readonly rayGain = new Float32Array(RAY_COUNT);
  private readonly rayLength = new Float32Array(RAY_COUNT);
  private readonly shapedBands = new Float32Array(64);

  // オーロラのカーテン・床・空
  private pillarMaterial!: THREE.ShaderMaterial;
  private readonly curtainLevel = new Float32Array(CURTAIN_COUNT);
  private readonly curtainHeight = new Float32Array(CURTAIN_COUNT).fill(CURTAIN_MIN_H);
  private poolMaterial!: THREE.MeshBasicMaterial;
  private skyMaterial!: THREE.ShaderMaterial;
  private starMaterial!: THREE.PointsMaterial;
  private reflector!: Reflector;

  // 粒子 (固定長のプール。寿命が尽きたものを再利用する)
  private particlePositions!: Float32Array;
  private particleColors!: Float32Array;
  private readonly pVel = new Float32Array(PARTICLE_COUNT * 3);
  private readonly pLife = new Float32Array(PARTICLE_COUNT);
  private readonly pMaxLife = new Float32Array(PARTICLE_COUNT);
  private readonly pBright = new Float32Array(PARTICLE_COUNT);
  private particleGeometry!: THREE.BufferGeometry;
  private nextParticle = 0;
  private emitCarry = 0;

  private readonly dummy = new THREE.Object3D();

  init(ctx: VisualizerInitContext): void {
    this.rng = ctx.rng;
    this.renderer = ctx.renderer;
    this.scene.background = new THREE.Color(0x000000);

    this.buildSky();
    this.buildStars();
    this.buildFloor();
    this.buildGate();
    this.buildFlare();
    this.buildPillar();
    this.buildParticles();

    this.applyTheme(String(ctx.params.colorTheme ?? 'default'));
    this.resize(ctx.width, ctx.height);
    this.updateCamera(0, ctx.params);
  }

  update(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void {
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(frame.dt) ? frame.dt : 0));
    this.t += dt;
    if (params.colorTheme !== this.themeName) this.applyTheme(params.colorTheme);

    const a = shapeAudio(frame, params);
    shapeBands(frame.bands, params, this.shapedBands);
    const intensity = THREE.MathUtils.clamp(params.intensity, 0, 1);
    const motion = THREE.MathUtils.clamp(params.motion, 0, 1);

    this.updateRays(dt, a.bass, intensity);
    this.updateGateLights(dt, a, intensity, motion);
    this.updateCurtains(dt, a.bass, a.beat, intensity);
    this.updateParticles(dt, frame, a.high, a.beat, intensity, motion);
    this.updateCamera(a.beat, params);
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    // 横幅が足りない (縦長の) ときはカメラを引いて、円環が左右で切れないようにする
    const tanHalfV = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
    const fitDistance = FIT_HALF_WIDTH / (tanHalfV * aspect);
    this.baseDistance = Math.max(CAMERA_BASE_DISTANCE, fitDistance);

    // 反射は半解像度で十分 (シェーダー側で縦方向ににじませるので、細部は見えない)
    const pr = this.renderer?.getPixelRatio() ?? 1;
    this.reflector?.getRenderTarget().setSize(Math.max(1, Math.round(w * pr * 0.5)), Math.max(1, Math.round(h * pr * 0.5)));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.reflector?.dispose();
    this.scene.clear();
    this.renderer = null;
  }

  /** テスト用: 反応の結果を数値で覗く (描画には使わない)。 */
  inspect(): SolarGateInspection {
    let sum = 0;
    for (let i = 0; i < RAY_COUNT; i++) sum += this.rayLength[i]!;
    let ch = 0;
    for (let i = 0; i < CURTAIN_COUNT; i++) ch += this.curtainHeight[i]!;
    let active = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) if (this.pLife[i]! > 0) active++;
    return {
      ringScale: this.ring.scale.x,
      meanRayLength: sum / RAY_COUNT,
      activeParticles: active,
      pillarStrength: this.pillarMaterial.uniforms.strength!.value as number,
      cameraDistance: this.baseDistance,
      flareStrength: this.flareMaterial.uniforms.strength!.value as number,
      flareAngle: this.flareAngle,
      curtainHeight: ch / CURTAIN_COUNT,
    };
  }

  /** テスト用: 粒子の位置バッファ (決定論性の確認に使う)。 */
  particlePositionsSnapshot(): Float32Array {
    return this.particlePositions.slice();
  }

  // ---------------------------------------------------------------- build

  private track<T extends { dispose(): void }>(obj: T): T {
    this.disposables.push(obj);
    return obj;
  }

  private buildSky(): void {
    this.skyMaterial = this.track(createSkyMaterial());
    const sky = new THREE.Mesh(this.track(new THREE.SphereGeometry(120, 32, 16)), this.skyMaterial);
    sky.renderOrder = -10;
    this.scene.add(sky);
  }

  private buildStars(): void {
    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      // 門の奥側の半球 (仰角 4°〜75°) に散らす
      const az = (this.rng() - 0.5) * Math.PI * 1.4;
      const el = THREE.MathUtils.degToRad(4 + Math.pow(this.rng(), 0.7) * 71);
      const r = 100;
      positions[i * 3] = Math.sin(az) * Math.cos(el) * r;
      positions[i * 3 + 1] = Math.sin(el) * r;
      positions[i * 3 + 2] = -Math.cos(az) * Math.cos(el) * r;
      // 金色の星 (明るい星ほど白に近い)
      const b = 0.35 + Math.pow(this.rng(), 3) * 1.4;
      const warm = 0.78 + this.rng() * 0.14;
      colors[i * 3] = b;
      colors[i * 3 + 1] = b * warm;
      colors[i * 3 + 2] = b * (warm - 0.28 + this.rng() * 0.12);
    }
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.starMaterial = this.track(
      new THREE.PointsMaterial({
        // PointsMaterial の見た目の大きさは size × (画面の高さ/2) / 距離 px。距離 100 で数 px になるように
        size: 1.1,
        map: this.track(makeRadialTexture(32)),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const stars = new THREE.Points(geo, this.starMaterial);
    stars.renderOrder = -9;
    this.scene.add(stars);
  }

  private buildFloor(): void {
    const geo = this.track(new THREE.PlaneGeometry(90, 90));
    this.reflector = new Reflector(geo, {
      clipBias: 0.003,
      textureWidth: 512,
      textureHeight: 512,
      color: 0xffffff,
      shader: floorReflectorShader,
    });
    this.reflector.rotation.x = -Math.PI / 2;
    this.scene.add(this.reflector);

    // 門の足元の光だまり (床に落ちる光)
    this.poolMaterial = this.track(
      new THREE.MeshBasicMaterial({
        map: this.track(makeRadialTexture(64)),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const pool = new THREE.Mesh(this.track(new THREE.PlaneGeometry(9, 5)), this.poolMaterial);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.01, 0.4);
    this.scene.add(pool);
  }

  private buildGate(): void {
    this.gate.position.set(0, RING_CENTER_Y, 0);
    this.scene.add(this.gate);

    this.ringMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(RING_RADIUS, 0.022, 20, 360)), this.ringMaterial);
    this.gate.add(this.ring);

    this.innerRingMaterial = this.track(
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const inner = new THREE.Mesh(this.track(new THREE.TorusGeometry(RING_RADIUS * 0.965, 0.006, 8, 256)), this.innerRingMaterial);
    this.gate.add(inner);

    // 外周の目盛り (ゆっくり回る)。門らしさを出すディテール
    this.tickGroup = new THREE.Group();
    this.tickMaterial = this.track(
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const tickCount = 72;
    const ticks = new THREE.InstancedMesh(this.track(new THREE.BoxGeometry(0.14, 0.03, 0.03)), this.tickMaterial, tickCount);
    for (let i = 0; i < tickCount; i++) {
      const a = (i / tickCount) * Math.PI * 2;
      const long = i % 6 === 0;
      this.dummy.position.set(Math.cos(a) * RING_RADIUS * 1.12, Math.sin(a) * RING_RADIUS * 1.12, 0);
      this.dummy.rotation.set(0, 0, a);
      this.dummy.scale.set(long ? 1.8 : 1, 1, 1);
      this.dummy.updateMatrix();
      ticks.setMatrixAt(i, this.dummy.matrix);
    }
    this.tickGroup.add(ticks);
    this.gate.add(this.tickGroup);

    this.portalMaterial = this.track(createPortalMaterial());
    const portal = new THREE.Mesh(this.track(new THREE.CircleGeometry(RING_RADIUS * 0.97, 128)), this.portalMaterial);
    portal.position.z = -0.02;
    this.gate.add(portal);
  }

  /** 月食のフレアと、輪のまわりのオーロラの縁を描く板 (リングの面に重ねる。リングの半径の PLANE_EXTENT 倍まで) */
  private buildFlare(): void {
    this.flareMaterial = this.track(createFlareMaterial());
    const size = RING_RADIUS * PLANE_EXTENT * 2;
    const plane = new THREE.Mesh(this.track(new THREE.PlaneGeometry(size, size)), this.flareMaterial);
    // シェーダーの座標は「リングの半径 = 1」。板の一辺 = 2 × PLANE_EXTENT × リングの半径にしてあるので、そのまま合う
    plane.position.z = 0.03;
    this.gate.add(plane);

    for (let i = 0; i < RAY_COUNT; i++) {
      const angle = (i / RAY_COUNT) * Math.PI * 2;
      // 真上 = 低い帯域、真下 = 高い帯域。左右対称になるよう sin で割り当てる
      const u = (1 - Math.sin(angle)) / 2;
      this.rayBand[i] = Math.min(RAY_BAND_SPAN - 1, Math.floor(u * RAY_BAND_SPAN));
      this.rayGain[i] = 0.7 + this.rng() * 0.6;
      this.rayLength[i] = 0.05;
    }
    this.writeReach();
  }

  private buildPillar(): void {
    this.pillarMaterial = this.track(createCurtainMaterial());
    const plane = new THREE.Mesh(this.track(new THREE.PlaneGeometry(CURTAIN_PLANE.width, CURTAIN_PLANE.height)), this.pillarMaterial);
    // 板の下の端を地面 (y = 0) に置く。リングの少し奥
    plane.position.set(0, CURTAIN_PLANE.height / 2, -0.7);
    this.scene.add(plane);
  }

  private buildParticles(): void {
    this.particlePositions = new Float32Array(PARTICLE_COUNT * 3);
    this.particleColors = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) this.particlePositions[i * 3 + 1] = -1000; // 未使用は画面外へ
    this.particleGeometry = this.track(new THREE.BufferGeometry());
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    const material = this.track(
      new THREE.PointsMaterial({
        // 距離 13 前後で 6〜8px 程度の火の粉になる大きさ
        size: 0.26,
        map: this.track(makeRadialTexture(32)),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const points = new THREE.Points(this.particleGeometry, material);
    points.frustumCulled = false;
    this.scene.add(points);
  }

  // ---------------------------------------------------------------- update

  private applyTheme(name: string): void {
    this.themeName = name;
    this.palette = solarGatePalette(name);
    const p = this.palette;
    this.skyMaterial.uniforms.topColor!.value.copy(p.skyTop);
    this.skyMaterial.uniforms.horizonColor!.value.copy(p.skyHorizon);
    this.skyMaterial.uniforms.glowColor!.value.copy(p.glow);
    this.portalMaterial.uniforms.color!.value.copy(p.portal);
    this.pillarMaterial.uniforms.color!.value.copy(p.pillar);
    // フレア: 燃える所は輪の色を明るく、オーロラの縁は光線の色
    this.flareMaterial.uniforms.color!.value.copy(p.ring).multiplyScalar(1.15);
    this.flareMaterial.uniforms.fringeColor!.value.copy(p.rays);
    this.innerRingMaterial.color.copy(p.ring).multiplyScalar(0.6);
    this.tickMaterial.color.copy(p.ring).multiplyScalar(0.12);
    const floorUniforms = (this.reflector.material as THREE.ShaderMaterial).uniforms;
    floorUniforms.floorColor!.value.copy(p.floor);
    floorUniforms.horizonColor!.value.copy(p.skyHorizon);
  }

  private updateRays(dt: number, bass: number, intensity: number): void {
    // 立ち上がりは即座に、減衰はなめらかに (縁がちらつかず、でもキックには遅れない)
    const release = 1 - Math.exp(-dt * 7);
    for (let i = 0; i < RAY_COUNT; i++) {
      const band = this.shapedBands[this.rayBand[i]!] ?? 0;
      const target = 0.08 + RAY_MAX_LENGTH * intensity * (0.6 * bass + 0.4 * band) * this.rayGain[i]!;
      const cur = this.rayLength[i]!;
      this.rayLength[i] = target > cur ? target : cur + (target - cur) * release;
    }
    this.writeReach();
  }

  /** 縁の伸び (世界の長さ) を、シェーダーが使うリングの半径 = 1 の長さにして渡す */
  private writeReach(): void {
    const reach = this.flareMaterial.uniforms.reach!.value as Float32Array;
    for (let i = 0; i < RAY_COUNT; i++) reach[i] = this.rayLength[i]! / RING_RADIUS;
  }

  private updateGateLights(
    dt: number,
    a: ReturnType<typeof shapeAudio>,
    intensity: number,
    motion: number,
  ): void {
    const p = this.palette;
    // 円環: 大きさは変えず、明るさだけを beat/mid で上げる (細い線なので、前より少し明るめに)
    this.ringMaterial.color.copy(p.ring).multiplyScalar(1.0 + a.beat * 0.8 * intensity + a.mid * 0.2);
    this.portalMaterial.uniforms.strength!.value = 0.02 + a.mid * 0.16 * intensity + a.beat * 0.05;
    this.portalMaterial.uniforms.time!.value += dt * (0.25 + motion * 1.1);
    this.tickGroup.rotation.z += dt * (0.02 + motion * 0.08);

    // 月食のフレア: 強さは rms・mid・beat をなめらかにつないだもの (立ち上がりは速く、戻りはゆっくり。光過敏への配慮)
    const target = 0.32 + 0.55 * a.rms * intensity + 0.3 * a.mid * intensity + 0.45 * Math.pow(a.beat, 1.4) * intensity;
    this.flareEnv += (target - this.flareEnv) * (1 - Math.exp(-dt * (target > this.flareEnv ? 9 : 2.2)));
    this.beatEnv += (a.beat - this.beatEnv) * (1 - Math.exp(-dt * (a.beat > this.beatEnv ? 18 : 3)));
    // 燃える位置: 約 40 秒で 1 周、Motion で速く、拍の直後は少し速くなる
    this.flareAngle += dt * ((Math.PI * 2) / FLARE_PERIOD_SEC) * (0.5 + 0.9 * motion + 2.2 * this.beatEnv);
    const u = this.flareMaterial.uniforms;
    u.strength!.value = Math.min(1.1, this.flareEnv);
    u.angle!.value = this.flareAngle;
    u.time!.value = this.t;
    u.fringe!.value = 0.55 + 0.4 * a.rms * intensity;

    this.pillarMaterial.uniforms.strength!.value = 0.04 + Math.pow(a.beat, 1.5) * 0.5 * intensity;
    this.pillarMaterial.uniforms.time!.value = this.t;
    this.poolMaterial.color.copy(p.glow).multiplyScalar(0.05 + a.bass * 0.3 * intensity + a.beat * 0.12);
    this.skyMaterial.uniforms.glowStrength!.value = 0.22 + a.rms * 0.35 + a.beat * 0.1;
    this.skyMaterial.uniforms.time!.value = this.t;
    (this.reflector.material as THREE.ShaderMaterial).uniforms.time!.value = this.t;
    this.starMaterial.opacity = 0.55 + a.high * 0.45;
  }

  /**
   * オーロラのカーテン: 9 本それぞれが担当の帯域 (左から右へ、低い音 → 高い音 → 低い音と左右対称) と低音で、
   * 高さと明るさが変わる (立ち上がりは速く、戻りはゆっくり)。静かなときも、低い背の高さで見えている。
   */
  private updateCurtains(dt: number, bass: number, beat: number, intensity: number): void {
    const attack = 1 - Math.exp(-dt * 12);
    const release = 1 - Math.exp(-dt * 2.2);
    const heights = this.pillarMaterial.uniforms.height!.value as Float32Array;
    const levels = this.pillarMaterial.uniforms.level!.value as Float32Array;
    for (let i = 0; i < CURTAIN_COUNT; i++) {
      // 中央が低い帯域、両端が高い帯域
      const dist = Math.abs(i - (CURTAIN_COUNT - 1) / 2) / ((CURTAIN_COUNT - 1) / 2);
      const bandIdx = Math.min(RAY_BAND_SPAN - 1, Math.floor(dist * RAY_BAND_SPAN * 0.9));
      const band = this.shapedBands[bandIdx] ?? 0;
      const target = Math.min(1.4, intensity * (0.5 * bass + 0.6 * band + 0.25 * beat));
      const cur = this.curtainLevel[i]!;
      this.curtainLevel[i] = cur + (target - cur) * (target > cur ? attack : release);
      const lv = this.curtainLevel[i]!;
      this.curtainHeight[i] = CURTAIN_MIN_H + (CURTAIN_MAX_H - CURTAIN_MIN_H) * Math.min(1, lv);
      heights[i] = this.curtainHeight[i]!;
      levels[i] = 0.55 + 0.7 * Math.min(1.2, lv);
    }
  }

  private emitParticle(speedScale: number): void {
    const i = this.nextParticle;
    this.nextParticle = (this.nextParticle + 1) % PARTICLE_COUNT;
    const angle = this.rng() * Math.PI * 2;
    const cx = Math.cos(angle);
    const sy = Math.sin(angle);
    const o = i * 3;
    this.particlePositions[o] = cx * RING_RADIUS;
    this.particlePositions[o + 1] = RING_CENTER_Y + sy * RING_RADIUS;
    this.particlePositions[o + 2] = (this.rng() - 0.5) * 0.2;
    const speed = (0.4 + this.rng() * 1.3) * speedScale;
    const tangential = (this.rng() - 0.5) * 0.35;
    this.pVel[o] = cx * speed - sy * tangential;
    this.pVel[o + 1] = sy * speed + cx * tangential;
    this.pVel[o + 2] = (this.rng() - 0.5) * 0.3;
    this.pMaxLife[i] = 1.1 + this.rng() * 1.6;
    this.pLife[i] = this.pMaxLife[i]!;
    this.pBright[i] = 0.6 + this.rng() * 0.8;
  }

  private updateParticles(
    dt: number,
    frame: AudioFrame,
    high: number,
    beat: number,
    intensity: number,
    motion: number,
  ): void {
    const speedScale = 0.6 + motion * 0.9;
    // high に比例して連続的に放出。ビートの瞬間 (beatIndex が変わったとき) は小さなバーストも出す
    this.emitCarry += dt * (3 + high * 420 * intensity);
    let emit = Math.floor(this.emitCarry);
    this.emitCarry -= emit;
    if (frame.beatIndex >= 0 && frame.beatIndex !== this.lastBeatIndex) {
      emit += Math.round(28 * intensity * (0.4 + beat * 0.6));
    }
    this.lastBeatIndex = frame.beatIndex;
    for (let n = 0; n < emit; n++) this.emitParticle(speedScale);

    const drag = Math.exp(-dt * 0.7);
    const color = this.palette.particles;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const o = i * 3;
      const life = this.pLife[i]!;
      if (life <= 0) {
        this.particleColors[o] = 0;
        this.particleColors[o + 1] = 0;
        this.particleColors[o + 2] = 0;
        continue;
      }
      const next = life - dt;
      this.pLife[i] = next;
      this.pVel[o] = this.pVel[o]! * drag;
      this.pVel[o + 1] = this.pVel[o + 1]! * drag + 0.18 * dt; // 火の粉のように少しだけ上へ漂う
      this.pVel[o + 2] = this.pVel[o + 2]! * drag;
      this.particlePositions[o] = this.particlePositions[o]! + this.pVel[o]! * dt;
      this.particlePositions[o + 1] = this.particlePositions[o + 1]! + this.pVel[o + 1]! * dt;
      this.particlePositions[o + 2] = this.particlePositions[o + 2]! + this.pVel[o + 2]! * dt;
      const k = next > 0 ? Math.pow(next / this.pMaxLife[i]!, 1.3) * this.pBright[i]! : 0;
      this.particleColors[o] = color.r * k * 1.6;
      this.particleColors[o + 1] = color.g * k * 1.6;
      this.particleColors[o + 2] = color.b * k * 1.6;
      if (next <= 0) this.particlePositions[o + 1] = -1000;
    }
    this.particleGeometry.attributes.position!.needsUpdate = true;
    this.particleGeometry.attributes.color!.needsUpdate = true;
  }

  private updateCamera(beat: number, params: CommonParams): void {
    const cm = THREE.MathUtils.clamp(params.cameraMotion, 0, 1);
    const orbit = Math.sin(this.t * 0.11) * 0.16 * cm;
    const dist = this.baseDistance * (1 - 0.012 * beat * cm);
    this.camera.position.set(Math.sin(orbit) * dist, 1.4 + Math.sin(this.t * 0.07) * 0.3 * cm, Math.cos(orbit) * dist);
    this.camera.lookAt(LOOK_AT);
  }
}
