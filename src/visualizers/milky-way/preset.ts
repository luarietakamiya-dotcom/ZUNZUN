import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { shapeAudio } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { milkyWayPalette, type MilkyWayPalette } from './palette';
import { createSkyMaterial, createStarMaterial, lakeReflectorShader } from './shaders';

/**
 * Milky Way — 山あいの湖に映る天の川。
 *
 * 反応の仕組み (docs/ARCHITECTURE.md「プリセット初期3種の反応設計」):
 * - high: 星のきらめき (明滅の深さと明るさ)。
 * - mid: 天の川の帯の輝度。
 * - beat: 流れ星が流れる。出るかどうか・どこをどう流れるかは ctx.rng (project.seed 由来) で決まるので、
 *   同じプロジェクトを書き出せば同じ流れ星になる。
 * - rms: 湖面の波紋 (反射像の揺らぎ)。bass は地平線の大気光をわずかに脈打たせる。
 * - Motion: 空の自転・波・またたきの速さ。Camera Motion: ゆっくりしたパン/チルト。
 *
 * 乱数は ctx.rng だけを使い、Math.random は使わない。
 */

const SKY_RADIUS = 110;
const STAR_RADIUS = 100;
const STAR_COUNT = 11000;
/** STAR_COUNT のうち、天の川の帯にぴったり沿わせる「微光星の粒」(帯のざらつき) の数 */
const BAND_DUST_STARS = 4500;
const METEOR_COUNT = 10;
/** 流れ星を描く平面の距離 (山並みの奥・星空の手前)。山より奥なので、低い流れ星は山に隠れる */
const METEOR_DEPTH = 88;
const CAMERA_FOV = 55;
const CAMERA_HEIGHT = 1.6;
const CAMERA_PITCH = THREE.MathUtils.degToRad(9);
const FAR_RIDGE_RADIUS = 78;
const NEAR_RIDGE_RADIUS = 50;

/** 天の川の帯の向き: 銀河中心 (やや右の低い空) から、左上の高い空へ斜めに横切る */
function galaxyAxes(): { c: THREE.Vector3; n: THREE.Vector3; t: THREE.Vector3 } {
  const dir = (azDeg: number, elDeg: number): THREE.Vector3 => {
    const az = THREE.MathUtils.degToRad(azDeg);
    const el = THREE.MathUtils.degToRad(elDeg);
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  };
  const c = dir(9, 11);
  const other = dir(-85, 38);
  const n = new THREE.Vector3().crossVectors(c, other).normalize();
  const t = new THREE.Vector3().crossVectors(n, c).normalize();
  return { c, n, t };
}

interface Meteor {
  active: boolean;
  age: number;
  duration: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  length: number;
  width: number;
  bright: number;
}

export interface MilkyWayInspection {
  galaxyStrength: number;
  twinkle: number;
  ripple: number;
  activeMeteors: number;
  meteorsSpawned: number;
}

export class MilkyWayPreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 500);

  private rng: () => number = () => 0.5;
  private renderer: THREE.WebGLRenderer | null = null;
  private themeName = '';
  private palette: MilkyWayPalette = milkyWayPalette('default');
  private t = 0;
  private skyRotation = 0;
  private lastBeatIndex = -1;
  private aspect = 16 / 9;
  private meteorsSpawned = 0;

  private readonly disposables: { dispose(): void }[] = [];
  private skyMaterial!: THREE.ShaderMaterial;
  private starMaterial!: THREE.ShaderMaterial;
  private starGeometry!: THREE.BufferGeometry;
  private farRidgeMaterial!: THREE.MeshBasicMaterial;
  private nearRidgeMaterial!: THREE.MeshBasicMaterial;
  private lake!: Reflector;
  private lakeUniforms!: Record<string, THREE.IUniform>;

  private meteorMesh!: THREE.InstancedMesh;
  private readonly meteors: Meteor[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();

  init(ctx: VisualizerInitContext): void {
    this.rng = ctx.rng;
    this.renderer = ctx.renderer;
    this.scene.background = new THREE.Color(0x000000);

    this.buildSky();
    this.buildStars();
    this.buildRidges();
    this.buildLake();
    this.buildMeteors();

    this.applyTheme(String(ctx.params.colorTheme ?? 'default'));
    this.resize(ctx.width, ctx.height);
    this.updateCamera(ctx.params);
  }

  update(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void {
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(frame.dt) ? frame.dt : 0));
    this.t += dt;
    if (params.colorTheme !== this.themeName) this.applyTheme(params.colorTheme);

    const a = shapeAudio(frame, params);
    const intensity = THREE.MathUtils.clamp(params.intensity, 0, 1);
    const motion = THREE.MathUtils.clamp(params.motion, 0, 1);

    this.skyRotation += dt * (0.002 + motion * 0.008);
    const sky = this.skyMaterial.uniforms;
    sky.skyRotation!.value = this.skyRotation;
    sky.galaxyStrength!.value = 0.35 + a.mid * 0.95 * intensity + a.bass * 0.08;
    sky.airglow!.value = 0.35 + a.bass * 0.35 * intensity + a.rms * 0.15;

    const stars = this.starMaterial.uniforms;
    stars.time!.value = stars.time!.value + dt * (0.5 + motion);
    stars.skyRotation!.value = this.skyRotation;
    stars.twinkle!.value = 0.12 + a.high * 0.78 * intensity;
    stars.boost!.value = 0.8 + a.high * 0.55 * intensity;

    this.lakeUniforms.ripple!.value = 0.15 + a.rms * 1.6 * intensity;
    this.lakeUniforms.time!.value = this.lakeUniforms.time!.value + dt * (0.4 + motion * 1.2);

    this.updateMeteors(dt, frame, a.beat, intensity);
    this.updateCamera(params);
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer?.getPixelRatio() ?? 1;
    this.starMaterial.uniforms.pixelScale!.value = (h * pr) / 1080;
    this.lake?.getRenderTarget().setSize(Math.max(1, Math.round(w * pr * 0.5)), Math.max(1, Math.round(h * pr * 0.5)));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.lake?.dispose();
    this.scene.clear();
    this.renderer = null;
  }

  /** テスト用: 反応の結果を数値で覗く (描画には使わない)。 */
  inspect(): MilkyWayInspection {
    return {
      galaxyStrength: this.skyMaterial.uniforms.galaxyStrength!.value as number,
      twinkle: this.starMaterial.uniforms.twinkle!.value as number,
      ripple: this.lakeUniforms.ripple!.value as number,
      activeMeteors: this.meteors.filter((m) => m.active).length,
      meteorsSpawned: this.meteorsSpawned,
    };
  }

  /** テスト用: 流れ星の状態 (決定論性の確認に使う)。 */
  meteorSnapshot(): number[] {
    return this.meteors.flatMap((m) => [m.active ? 1 : 0, m.age, m.x, m.y, m.dx, m.dy, m.length]);
  }

  // ---------------------------------------------------------------- build

  private track<T extends { dispose(): void }>(obj: T): T {
    this.disposables.push(obj);
    return obj;
  }

  private buildSky(): void {
    this.skyMaterial = this.track(createSkyMaterial());
    const { c, n, t } = galaxyAxes();
    const u = this.skyMaterial.uniforms;
    (u.axisC!.value as THREE.Vector3).copy(c);
    (u.axisN!.value as THREE.Vector3).copy(n);
    (u.axisT!.value as THREE.Vector3).copy(t);
    // seed ごとに天の川の模様 (濃淡・塵の筋) が変わる
    (u.seedOffset!.value as THREE.Vector3).set(this.rng() * 50, this.rng() * 50, this.rng() * 50);
    const sky = new THREE.Mesh(this.track(new THREE.SphereGeometry(SKY_RADIUS, 48, 24)), this.skyMaterial);
    sky.renderOrder = -10;
    this.scene.add(sky);
  }

  private buildStars(): void {
    const { c, n, t } = galaxyAxes();
    const positions = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const phases = new Float32Array(STAR_COUNT);
    const brights = new Float32Array(STAR_COUNT);
    this.starGeometry = this.track(new THREE.BufferGeometry());
    const colors = new Float32Array(STAR_COUNT * 3);
    const dir = new THREE.Vector3();

    for (let i = 0; i < STAR_COUNT; i++) {
      const bandDust = i < BAND_DUST_STARS;
      if (bandDust || this.rng() < 0.4) {
        // 天の川の帯に沿って集中させる (帯の中心からの距離はガウス分布)。微光星の粒は帯にぴったり沿わせ、中心核の側に寄せる
        const lon = bandDust ? this.gaussian() * 1.1 : (this.rng() * 2 - 1) * Math.PI;
        const lat = this.gaussian() * (bandDust ? 0.055 : 0.12);
        dir
          .copy(c)
          .multiplyScalar(Math.cos(lon) * Math.cos(lat))
          .addScaledVector(t, Math.sin(lon) * Math.cos(lat))
          .addScaledVector(n, Math.sin(lat));
      } else {
        // 空全体に一様に
        const z = this.rng() * 2 - 1;
        const phi = this.rng() * Math.PI * 2;
        const rr = Math.sqrt(1 - z * z);
        dir.set(rr * Math.cos(phi), z, rr * Math.sin(phi));
      }
      dir.normalize();
      if (dir.y < -0.05) dir.y = -dir.y; // 地平線より下は見えないので上へ折り返す
      positions[i * 3] = dir.x * STAR_RADIUS;
      positions[i * 3 + 1] = dir.y * STAR_RADIUS;
      positions[i * 3 + 2] = dir.z * STAR_RADIUS;
      // 大半は小さく暗い星、ごく一部だけ大きく明るい星
      const big = bandDust ? 0 : Math.pow(this.rng(), 9);
      sizes[i] = bandDust ? 1.3 + this.rng() * 0.9 : 1.3 + big * 5.5;
      brights[i] = bandDust ? 0.3 + this.rng() * 0.45 : 0.25 + Math.pow(this.rng(), 2.5) * 0.9 + big * 1.4;
      phases[i] = this.rng();
      const warmth = this.rng();
      colors[i * 3] = warmth;
      colors[i * 3 + 1] = warmth;
      colors[i * 3 + 2] = warmth;
    }
    this.starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starGeometry.setAttribute('starSize', new THREE.BufferAttribute(sizes, 1));
    this.starGeometry.setAttribute('starPhase', new THREE.BufferAttribute(phases, 1));
    this.starGeometry.setAttribute('starBright', new THREE.BufferAttribute(brights, 1));
    // starColor はテーマ適用時に warmth (ここでは仮に RGB 同値で保存) から色を作る
    this.starGeometry.setAttribute('starWarmth', new THREE.BufferAttribute(colors, 3));
    this.starGeometry.setAttribute('starColor', new THREE.BufferAttribute(new Float32Array(STAR_COUNT * 3), 3));
    this.starMaterial = this.track(createStarMaterial());
    const stars = new THREE.Points(this.starGeometry, this.starMaterial);
    stars.frustumCulled = false;
    stars.renderOrder = -9;
    this.scene.add(stars);
  }

  private buildRidges(): void {
    this.farRidgeMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.nearRidgeMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0x000000 }));
    // 奥の山並み: 左右が高く、中央 (天の川の中心の下) は低く開けた谷にする
    this.scene.add(new THREE.Mesh(this.track(this.ridgeGeometry(FAR_RIDGE_RADIUS, 2.5, 13, 0.6)), this.farRidgeMaterial));
    // 手前の低い稜線: 奥行きを出すための一段暗いシルエット
    this.scene.add(new THREE.Mesh(this.track(this.ridgeGeometry(NEAR_RIDGE_RADIUS, 0.8, 5, 0.75)), this.nearRidgeMaterial));
  }

  /** 円弧状の帯 (底辺は水面下、上辺が稜線)。稜線の高さは seed 由来の位相を持つ正弦波の重ね合わせ。 */
  private ridgeGeometry(radius: number, minH: number, maxH: number, centerDip: number): THREE.BufferGeometry {
    const segments = 360;
    const arc = THREE.MathUtils.degToRad(125);
    const phases = [this.rng(), this.rng(), this.rng(), this.rng(), this.rng()].map((v) => v * Math.PI * 2);
    const positions: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const a = -arc + (2 * arc * i) / segments;
      let v = 0.5 * (0.5 + 0.5 * Math.sin(a * 2.1 + phases[0]!));
      v += 0.27 * (0.5 + 0.5 * Math.sin(a * 5.3 + phases[1]!));
      v += 0.13 * (0.5 + 0.5 * Math.sin(a * 13.7 + phases[2]!));
      v += 0.07 * Math.abs(Math.sin(a * 29.0 + phases[3]!));
      v += 0.03 * Math.abs(Math.sin(a * 61.0 + phases[4]!));
      const side = 1 - centerDip * Math.exp(-Math.pow(a / 0.45, 2));
      const top = minH + v * (maxH - minH) * side;
      const x = Math.sin(a) * radius;
      const z = -Math.cos(a) * radius;
      positions.push(x, -1, z, x, top, z);
      if (i < segments) {
        const b = i * 2;
        index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(index);
    return geo;
  }

  private buildLake(): void {
    const geo = this.track(new THREE.PlaneGeometry(400, 400));
    this.lake = new Reflector(geo, {
      clipBias: 0.003,
      textureWidth: 512,
      textureHeight: 512,
      color: 0xffffff,
      shader: lakeReflectorShader,
    });
    this.lake.rotation.x = -Math.PI / 2;
    this.lakeUniforms = (this.lake.material as THREE.ShaderMaterial).uniforms;
    this.scene.add(this.lake);
  }

  private buildMeteors(): void {
    const geo = this.track(new THREE.PlaneGeometry(1, 1));
    geo.translate(-0.5, 0, 0); // 先端 (頭) を原点に、尾を -X 方向へ
    const material = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        alphaMap: this.track(makeMeteorTexture()),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.meteorMesh = new THREE.InstancedMesh(geo, material, METEOR_COUNT);
    this.meteorMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(METEOR_COUNT * 3), 3);
    this.meteorMesh.frustumCulled = false;
    for (let i = 0; i < METEOR_COUNT; i++) {
      this.meteors.push({ active: false, age: 0, duration: 1, x: 0, y: 0, dx: 0, dy: -1, speed: 0, length: 0, width: 0, bright: 0 });
    }
    this.writeMeteors();
    this.scene.add(this.meteorMesh);
  }

  // ---------------------------------------------------------------- update

  private gaussian(): number {
    // Box-Muller (ctx.rng だけを使う)
    const u = Math.max(1e-6, this.rng());
    const v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  private applyTheme(name: string): void {
    this.themeName = name;
    this.palette = milkyWayPalette(name);
    const p = this.palette;
    const sky = this.skyMaterial.uniforms;
    (sky.topColor!.value as THREE.Color).copy(p.skyTop);
    (sky.horizonColor!.value as THREE.Color).copy(p.skyHorizon);
    (sky.airglowColor!.value as THREE.Color).copy(p.airglow);
    (sky.coreColor!.value as THREE.Color).copy(p.galaxyCore);
    (sky.armColor!.value as THREE.Color).copy(p.galaxyArm);
    this.farRidgeMaterial.color.copy(p.mountainFar);
    this.nearRidgeMaterial.color.copy(p.mountainNear);
    (this.lakeUniforms.waterColor!.value as THREE.Color).copy(p.water);
    (this.lakeUniforms.horizonColor!.value as THREE.Color).copy(p.skyHorizon);

    // 星の色: 温度感 (warmth) に応じて暖色〜寒色を混ぜる
    const warmth = this.starGeometry.getAttribute('starWarmth') as THREE.BufferAttribute;
    const color = this.starGeometry.getAttribute('starColor') as THREE.BufferAttribute;
    for (let i = 0; i < STAR_COUNT; i++) {
      const w = warmth.getX(i);
      this.tmpColor.copy(p.starCool).lerp(p.starWarm, w * w);
      color.setXYZ(i, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
    }
    color.needsUpdate = true;
  }

  private spawnMeteor(beat: number): void {
    const slot = this.meteors.find((m) => !m.active);
    if (!slot) return;
    // 流れ星の平面 (距離 METEOR_DEPTH) 上で、画面上部に見える範囲から流す。縦長の画面では横の範囲を狭める
    const halfH = METEOR_DEPTH * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
    const halfW = halfH * this.aspect;
    const centerY = CAMERA_HEIGHT + METEOR_DEPTH * Math.tan(CAMERA_PITCH);
    slot.x = (this.rng() * 2 - 1) * halfW * 0.8;
    slot.y = centerY + (0.25 + this.rng() * 0.6) * halfH;
    const side = this.rng() < 0.5 ? -1 : 1;
    const angle = -Math.PI / 2 + side * (0.35 + this.rng() * 0.75);
    slot.dx = Math.cos(angle);
    slot.dy = Math.sin(angle);
    slot.speed = 38 + this.rng() * 30;
    slot.length = 10 + this.rng() * 14;
    slot.width = 0.22 + this.rng() * 0.16;
    slot.duration = 0.55 + this.rng() * 0.6;
    slot.bright = (0.7 + this.rng() * 0.6) * (0.6 + 0.4 * beat);
    slot.age = 0;
    slot.active = true;
    this.meteorsSpawned++;
  }

  private updateMeteors(dt: number, frame: AudioFrame, beat: number, intensity: number): void {
    // ビートごとに (beatIndex が変わった瞬間に) 流れ星を出すかを決める。Intensity が高いほど出やすい
    if (frame.beatIndex >= 0 && frame.beatIndex !== this.lastBeatIndex) {
      // 毎ビート出すと流星群になってしまうので、既定の Intensity (0.8) でおよそ 3 ビートに 1 回に抑える
      if (this.rng() < 0.08 + 0.32 * intensity) this.spawnMeteor(beat);
      if (beat > 0.8 && this.rng() < 0.06 * intensity) this.spawnMeteor(beat);
    }
    this.lastBeatIndex = frame.beatIndex;

    for (const m of this.meteors) {
      if (!m.active) continue;
      m.age += dt;
      if (m.age >= m.duration) m.active = false;
    }
    this.writeMeteors();
  }

  private writeMeteors(): void {
    for (let i = 0; i < METEOR_COUNT; i++) {
      const m = this.meteors[i]!;
      if (!m.active) {
        this.dummy.position.set(0, -1000, -METEOR_DEPTH);
        this.dummy.scale.set(0.0001, 0.0001, 1);
        this.dummy.rotation.set(0, 0, 0);
        this.tmpColor.setRGB(0, 0, 0);
      } else {
        const k = m.age / m.duration;
        const hx = m.x + m.dx * m.speed * m.age;
        const hy = m.y + m.dy * m.speed * m.age;
        const len = m.length * Math.min(1, m.age / 0.18);
        const fade = Math.pow(Math.sin(Math.PI * Math.min(1, k)), 0.7);
        this.dummy.position.set(hx, hy, -METEOR_DEPTH);
        this.dummy.rotation.set(0, 0, Math.atan2(m.dy, m.dx));
        this.dummy.scale.set(Math.max(0.0001, len), m.width, 1);
        this.tmpColor.copy(this.palette.meteor).multiplyScalar(2.4 * m.bright * fade);
      }
      this.dummy.updateMatrix();
      this.meteorMesh.setMatrixAt(i, this.dummy.matrix);
      this.meteorMesh.setColorAt(i, this.tmpColor);
    }
    this.meteorMesh.instanceMatrix.needsUpdate = true;
    if (this.meteorMesh.instanceColor) this.meteorMesh.instanceColor.needsUpdate = true;
  }

  private updateCamera(params: CommonParams): void {
    const cm = THREE.MathUtils.clamp(params.cameraMotion, 0, 1);
    const yaw = Math.sin(this.t * 0.05) * THREE.MathUtils.degToRad(7) * cm;
    const pitch = CAMERA_PITCH + Math.sin(this.t * 0.037) * THREE.MathUtils.degToRad(1.5) * cm;
    this.camera.position.set(0, CAMERA_HEIGHT + Math.sin(this.t * 0.08) * 0.08 * cm, 6);
    this.camera.rotation.set(pitch, -yaw, 0, 'YXZ');
  }
}

/** 流れ星 1 本の形: 先端 (u=1) が明るく、尾 (u=0) に向かって消える。横方向は中心線が明るい。 */
function makeMeteorTexture(): THREE.DataTexture {
  const w = 64;
  const h = 8;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      const along = Math.pow(u, 2.2) * Math.min(1, (1 - u) * 30);
      const across = Math.exp(-Math.pow((v - 0.5) * 4, 2));
      const a = Math.round(Math.max(0, Math.min(1, along * across)) * 255);
      const i = (y * w + x) * 4;
      data[i] = a;
      data[i + 1] = a;
      data[i + 2] = a;
      data[i + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
