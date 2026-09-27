import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { shapeAudio, shapeBands } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { solarGatePalette, type SolarGatePalette } from './palette';
import { createPillarMaterial, createPortalMaterial, createSkyMaterial, floorReflectorShader } from './shaders';
import { makeRadialTexture, makeRayTexture } from './textures';

/**
 * Solar Gate — 夜の地平に立つ光の円環。
 *
 * 反応の仕組み (docs/ARCHITECTURE.md「プリセット初期3種の反応設計」):
 * - 円環そのものは拡大縮小しない (常に scale 1)。明るさだけが変わる。
 * - bass: 円周から外へ放射状の光線が伸びる。光線ごとに担当の帯域を持たせ、スペクトルの形も出す。
 * - beat: 門の奥から天へ伸びる光柱がフラッシュし、円環も一瞬強く光る。
 * - high: 円周から火の粉のような粒子が放出される。ビートの瞬間には小さなバーストも出す。
 * - mid: 門の内側の膜 (portal) の輝き。rms: 地平線の光。
 * - 鏡面床 (Reflector) に全体が映り込み、Bloom でにじむ。
 *
 * 乱数は Host から渡される ctx.rng (project.seed 由来) だけを使い、Math.random は使わない。
 */

const RING_RADIUS = 2.6;
const RING_CENTER_Y = RING_RADIUS + 0.32;
const RAY_COUNT = 200;
const RAY_BASE_RADIUS = RING_RADIUS * 1.03;
const RAY_MAX_LENGTH = 2.8;
/** 光線が担当する帯域の範囲 (64 帯域のうち、実際にエネルギーが乗りやすい下側 40 帯域) */
const RAY_BAND_SPAN = 40;
const PARTICLE_COUNT = 1600;
const STAR_COUNT = 700;
const CAMERA_FOV = 42;
const CAMERA_BASE_DISTANCE = 13;
/** 画面の横幅に最低限収めたい範囲 (円環 + 光線の根元付近)。縦長の書き出しでもはみ出さないようにする */
const FIT_HALF_WIDTH = RING_RADIUS + 1.3;
const LOOK_AT = new THREE.Vector3(0, 2.75, 0);

export interface SolarGateInspection {
  ringScale: number;
  meanRayLength: number;
  activeParticles: number;
  pillarStrength: number;
  cameraDistance: number;
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

  // 光線
  private rays!: THREE.InstancedMesh;
  private rayMaterial!: THREE.MeshBasicMaterial;
  private readonly rayAngle = new Float32Array(RAY_COUNT);
  private readonly rayBand = new Uint8Array(RAY_COUNT);
  private readonly rayGain = new Float32Array(RAY_COUNT);
  private readonly rayWidth = new Float32Array(RAY_COUNT);
  private readonly rayLength = new Float32Array(RAY_COUNT);
  private readonly shapedBands = new Float32Array(64);

  // 光柱・床・空
  private pillarMaterial!: THREE.ShaderMaterial;
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
  private readonly tmpColor = new THREE.Color();

  init(ctx: VisualizerInitContext): void {
    this.rng = ctx.rng;
    this.renderer = ctx.renderer;
    this.scene.background = new THREE.Color(0x000000);

    this.buildSky();
    this.buildStars();
    this.buildFloor();
    this.buildGate();
    this.buildRays();
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
    let active = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) if (this.pLife[i]! > 0) active++;
    return {
      ringScale: this.ring.scale.x,
      meanRayLength: sum / RAY_COUNT,
      activeParticles: active,
      pillarStrength: this.pillarMaterial.uniforms.strength!.value as number,
      cameraDistance: this.baseDistance,
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
      const b = 0.35 + Math.pow(this.rng(), 3) * 1.2;
      colors[i * 3] = b;
      colors[i * 3 + 1] = b;
      colors[i * 3 + 2] = b * (0.9 + this.rng() * 0.2);
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
    this.ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(RING_RADIUS, 0.055, 20, 320)), this.ringMaterial);
    this.gate.add(this.ring);

    this.innerRingMaterial = this.track(
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const inner = new THREE.Mesh(this.track(new THREE.TorusGeometry(RING_RADIUS * 0.94, 0.012, 8, 256)), this.innerRingMaterial);
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

  private buildRays(): void {
    const geo = this.track(new THREE.PlaneGeometry(1, 1));
    geo.translate(0, 0.5, 0); // 根元を原点にして +Y へ伸ばす
    this.rayMaterial = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        alphaMap: this.track(makeRayTexture()),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.rays = new THREE.InstancedMesh(geo, this.rayMaterial, RAY_COUNT);
    this.rays.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RAY_COUNT * 3), 3);
    this.rays.frustumCulled = false;

    for (let i = 0; i < RAY_COUNT; i++) {
      const angle = (i / RAY_COUNT) * Math.PI * 2 + (this.rng() - 0.5) * 0.012;
      this.rayAngle[i] = angle;
      // 真上 = 低い帯域、真下 = 高い帯域。左右対称になるよう sin で割り当てる
      const u = (1 - Math.sin(angle)) / 2;
      this.rayBand[i] = Math.min(RAY_BAND_SPAN - 1, Math.floor(u * RAY_BAND_SPAN));
      this.rayGain[i] = 0.7 + this.rng() * 0.6;
      this.rayWidth[i] = 0.018 + Math.pow(this.rng(), 2) * 0.03;
      this.rayLength[i] = 0.05;
    }
    this.writeRays();
    this.gate.add(this.rays);
  }

  private buildPillar(): void {
    this.pillarMaterial = this.track(createPillarMaterial());
    const pillar = new THREE.Mesh(this.track(new THREE.PlaneGeometry(3.2, 36)), this.pillarMaterial);
    pillar.position.set(0, 18, -0.6);
    this.scene.add(pillar);
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
    this.innerRingMaterial.color.copy(p.ring).multiplyScalar(0.6);
    this.tickMaterial.color.copy(p.ring).multiplyScalar(0.45);
    const floorUniforms = (this.reflector.material as THREE.ShaderMaterial).uniforms;
    floorUniforms.floorColor!.value.copy(p.floor);
    floorUniforms.horizonColor!.value.copy(p.skyHorizon);
  }

  private updateRays(dt: number, bass: number, intensity: number): void {
    // 立ち上がりは即座に、減衰はなめらかに (光線がちらつかず、でもキックには遅れない)
    const release = 1 - Math.exp(-dt * 7);
    for (let i = 0; i < RAY_COUNT; i++) {
      const band = this.shapedBands[this.rayBand[i]!] ?? 0;
      const target = 0.08 + RAY_MAX_LENGTH * intensity * (0.6 * bass + 0.4 * band) * this.rayGain[i]!;
      const cur = this.rayLength[i]!;
      this.rayLength[i] = target > cur ? target : cur + (target - cur) * release;
    }
    this.writeRays();
  }

  private writeRays(): void {
    const color = this.palette.rays;
    for (let i = 0; i < RAY_COUNT; i++) {
      const angle = this.rayAngle[i]!;
      const len = this.rayLength[i]!;
      this.dummy.position.set(Math.cos(angle) * RAY_BASE_RADIUS, Math.sin(angle) * RAY_BASE_RADIUS, 0);
      this.dummy.rotation.set(0, 0, angle - Math.PI / 2);
      this.dummy.scale.set(this.rayWidth[i]!, len, 1);
      this.dummy.updateMatrix();
      this.rays.setMatrixAt(i, this.dummy.matrix);
      // 光線は重なって加算されるので 1 本あたりは控えめに。にじみは Bloom に任せる
      const bright = 0.12 + Math.min(1.4, len / RAY_MAX_LENGTH) * 0.55;
      this.tmpColor.copy(color).multiplyScalar(bright);
      this.rays.setColorAt(i, this.tmpColor);
    }
    this.rays.instanceMatrix.needsUpdate = true;
    if (this.rays.instanceColor) this.rays.instanceColor.needsUpdate = true;
  }

  private updateGateLights(
    dt: number,
    a: ReturnType<typeof shapeAudio>,
    intensity: number,
    motion: number,
  ): void {
    const p = this.palette;
    // 円環: 大きさは変えず、明るさだけを beat/mid で上げる
    this.ringMaterial.color.copy(p.ring).multiplyScalar(1.1 + a.beat * 1.2 * intensity + a.mid * 0.3);
    this.portalMaterial.uniforms.strength!.value = 0.06 + a.mid * 0.22 * intensity + a.beat * 0.08;
    this.portalMaterial.uniforms.time!.value += dt * (0.25 + motion * 1.1);
    this.tickGroup.rotation.z += dt * (0.02 + motion * 0.08);

    this.pillarMaterial.uniforms.strength!.value = 0.04 + Math.pow(a.beat, 1.5) * 1.2 * intensity;
    this.poolMaterial.color.copy(p.glow).multiplyScalar(0.05 + a.bass * 0.3 * intensity + a.beat * 0.12);
    this.skyMaterial.uniforms.glowStrength!.value = 0.22 + a.rms * 0.35 + a.beat * 0.1;
    this.starMaterial.opacity = 0.55 + a.high * 0.45;
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
