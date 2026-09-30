import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { shapeAudio } from '../../core/visualizer/response';
import type { AudioFrame, CommonParams, VisualizerInitContext, VisualizerPreset } from '../../core/types';
import { liveStagePalette, type LiveStagePalette } from './palette';
import { createBeamMaterial, createHazeMaterial, createWallMaterial, stageFloorShader } from './shaders';

/**
 * Live Stage — ライブ会場のステージ照明。
 *
 * 反応の仕組み (docs/ARCHITECTURE.md「プリセット初期3種の反応設計」):
 * - beat: ムービングライトがビートごとにパターン表の次の段へ振り向く。パターンは 8 ビート (1 フレーズ) ごとに
 *   ctx.rng (project.seed 由来) で選び直すので、同じプロジェクトを書き出せば同じ演出になる。
 *   ビートの瞬間はレンズと光の筋が少し強くなる。ビートが無い区間はゆっくりのスイープ。
 * - bass: スモークの濃度。光の筋 (ボリューム風のコーン) の濃さと、床近くに漂う霞の濃さが変わる。
 * - high: レーザーのストロボ。光過敏性に配慮して、点灯の立ち上がりは毎秒 MAX_STROBE_HZ 回以下に制限する
 *   (点滅の周期ごとに、その周期で光らせるかを周期の頭の high で決める。途中で high が揺れても余計に点滅しない)。
 * - Motion: ライトの振りの速さ・スモークとレーザーの流れの速さ。Camera Motion: ゆっくりした横移動と上下の揺れ。
 *
 * 乱数は ctx.rng だけを使い、Math.random は使わない。
 */

const FIXTURE_COUNT = 8;
const FIXTURE_SPACING = 2;
const TRUSS_Y = 7.2;
const TRUSS_Z = -3;
const BEAM_LENGTH = 16;
const BEAM_APEX_RADIUS = 0.12;
const BEAM_END_RADIUS = 1.5;
const WALL_Z = -10;
const LASER_EMITTERS = 3;
const LASERS_PER_EMITTER = 6;
const LASER_COUNT = LASER_EMITTERS * LASERS_PER_EMITTER;
/** レーザーが狙う面 (カメラの少し手前)。ここで消えるので、カメラの近くを通って太い線になることがない */
const LASER_TARGET_Z = 6;
/** 客席側へ傾ける量 (leanZ) の上限。大きいと光の筋がカメラに迫って画面を覆う */
const MAX_LEAN_Z = 0.6;
/** レーザーのストロボの上限 (点灯の立ち上がり / 秒)。一般的な光過敏性のガイドライン (1 秒に 3 回まで) に合わせる */
export const MAX_STROBE_HZ = 3;
/** 1 周期のうち点灯している割合 */
const STROBE_DUTY = 0.45;
/** この周期で光らせる high のしきい値 (shapeAudio 後の 0..1) */
const HIGH_THRESHOLD = 0.3;
/** パターンを選び直す間隔 (ビート数) */
export const PHRASE_BEATS = 8;
const CAMERA_FOV = 50;

/**
 * カメラの場所 (このプリセットだけの設定 cameraSpot。manifest.controls)。位置と見る点。
 * back = 客席の後ろ (今まで)、front = 最前列から見上げる、side = 真横、top = 見下ろす、stage = ステージの奥から客席側を見る
 */
export const CAMERA_SPOTS = {
  back: { pos: new THREE.Vector3(0, 2.0, 12), look: new THREE.Vector3(0, 3.6, -3) },
  front: { pos: new THREE.Vector3(0, 0.9, 4.2), look: new THREE.Vector3(0, 5.8, -3) },
  side: { pos: new THREE.Vector3(12.5, 2.6, 2.5), look: new THREE.Vector3(0, 3.4, -3.5) },
  top: { pos: new THREE.Vector3(0, 12.5, 8), look: new THREE.Vector3(0, 1.5, -3) },
  stage: { pos: new THREE.Vector3(0, 2.2, -8.2), look: new THREE.Vector3(0, 3.4, 8) },
} as const;
export type CameraSpot = keyof typeof CAMERA_SPOTS;
/** 左右の向き (cameraYaw = ±1) で回る角度 (度) */
const CAMERA_YAW_MAX = 40;
/**
 * 光を客席へ向ける (このプリセットだけの設定 towardCrowd = 0..1)。1 のとき、客席側へ傾ける量 (leanZ) の上限をここまで広げる
 * (3 でほぼ水平に客席の方を向く)。0 なら今までどおり MAX_LEAN_Z まで
 */
const CROWD_LEAN_MAX = 3.2;
/** ライトがカメラを向いたとみなす角度 (これより外は 0、内側ほど 1)。光の筋の開きより少し広く */
const HIT_COS_OUTER = Math.cos(THREE.MathUtils.degToRad(16));
const HIT_COS_INNER = Math.cos(THREE.MathUtils.degToRad(4));
/**
 * 光の筋がカメラの方を向くほど、筋そのもの (円錐) を薄くする範囲。カメラが円錐の中に入ると、円錐の内側の面が
 * 画面いっぱいに重なって霧のように白っぽくなったため (ライトがカメラを向いていることは、玉と光条で見せる)
 */
const COVER_COS_OUTER = Math.cos(THREE.MathUtils.degToRad(30));
const COVER_COS_INNER = Math.cos(THREE.MathUtils.degToRad(8));
/**
 * ライトがカメラを向いた瞬間に画面全体を少し明るくする量の上限 (ユーザーの選択 B)。
 * 光過敏への配慮: 明るくなり始める回数は毎秒 MAX_STROBE_HZ 回まで、上限も控えめ
 */
export const WASH_MAX = 0.1;
/**
 * 画面全体が明るくなるのは、前回から少なくともこれだけ (秒) あいてから。光過敏のガイドラインの上限 (毎秒 3 回) より
 * ずっと少なくする (最前列のカメラでは、毎秒 3 回近く明るくなると続けて点滅しているように見えた)
 */
export const WASH_MIN_INTERVAL = 0.75;
/** 画面を明るくするのは、いちばん向いているライトの度合いがこれを下から越えた瞬間 */
const HIT_FLASH = 0.8;
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);

export const PATTERNS = ['fan', 'cross', 'wave', 'chase', 'converge'] as const;
export type PatternName = (typeof PATTERNS)[number];

/** チェイスで順に巡る向き (leanX, leanZ) */
const CHASE_STEPS: readonly (readonly [number, number])[] = [
  [-0.7, 0.2],
  [0.7, 0.2],
  [0.7, 0.8],
  [-0.7, 0.8],
];

export interface LiveStageInspection {
  /** bass を滑らかにしたスモークの濃度 (0..1) */
  smoke: number;
  /** 光の筋のシェーダーに渡している濃度 */
  beamDensity: number;
  /** 光の筋の明るさの平均 */
  beamStrength: number;
  /** 今見えているレーザーの本数 */
  lasersVisible: number;
  /** これまでにレーザーが点灯した回数 (周期ごとに 1 回まで) */
  laserFlashes: number;
  pattern: PatternName;
  patternChanges: number;
  /** 画面全体を明るくしている量 (0..WASH_MAX) */
  wash: number;
  /** 画面全体が明るくなり始めた回数 */
  washRises: number;
  /** このフレームで、いちばんカメラを向いているライトの度合い (0..1) */
  maxHit: number;
}

export class LiveStagePreset implements VisualizerPreset {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 300);

  private rng: () => number = () => 0.5;
  private renderer: THREE.WebGLRenderer | null = null;
  private themeName = '';
  private palette: LiveStagePalette = liveStagePalette('default');
  private t = 0;
  private aspect = 16 / 9;
  /** 縦長の画面でトラスの幅を詰める割合 (16:9 で 1) */
  private layoutScale = 1;

  // ムービングライト
  private readonly fixtures = new THREE.Group();
  private readonly beams: THREE.Mesh[] = [];
  private readonly beamMaterials: THREE.ShaderMaterial[] = [];
  private readonly heads: THREE.Mesh[] = [];
  private readonly lenses: THREE.Sprite[] = [];
  private readonly lensMaterials: THREE.SpriteMaterial[] = [];
  private readonly spots: THREE.Mesh[] = [];
  private readonly spotMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly leanX = new Float32Array(FIXTURE_COUNT);
  private readonly leanZ = new Float32Array(FIXTURE_COUNT);
  private readonly targetX = new Float32Array(FIXTURE_COUNT);
  private readonly targetZ = new Float32Array(FIXTURE_COUNT);
  private readonly idlePhase = new Float32Array(FIXTURE_COUNT * 2);
  private readonly convergePoints: THREE.Vector2[] = [];
  private truss!: THREE.Mesh;
  private fixtureMaterial!: THREE.MeshBasicMaterial;
  /** ライトがカメラを向いたときの光条 (十字の光) */
  private readonly streaks: THREE.Sprite[] = [];
  private readonly streakMaterials: THREE.SpriteMaterial[] = [];
  /** 画面全体を少し明るくする板 (カメラの目の前に置く) */
  private wash!: THREE.Mesh;
  private washMaterial!: THREE.MeshBasicMaterial;
  private washLevel = 0;
  private washPeak = 0;
  private prevMaxHit = 0;
  private lastWashRise = -Infinity;
  private washRises = 0;
  private maxHit = 0;
  /** 光を客席へ向ける量 (0..1) */
  private crowd = 0;

  // パターン
  private patternIndex = 0;
  private patternChanges = 0;
  private lastPhrase = 0;
  private phraseStartBeat = 0;

  // スモーク
  private smoke = 0;
  private hazeMaterials: THREE.ShaderMaterial[] = [];
  private wallMaterial!: THREE.ShaderMaterial;
  private floor!: Reflector;
  private floorUniforms!: Record<string, THREE.IUniform>;

  // レーザー
  private lasers!: THREE.InstancedMesh;
  private readonly laserOrigins: THREE.Vector3[] = [];
  private strobePhase = 0;
  private strobeFired = false;
  private laserFlashes = 0;
  private laserLevel = 0;
  private laserSweep = 0;
  private laserSeed = 0;
  private lasersVisible = 0;

  private readonly disposables: { dispose(): void }[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpVec = new THREE.Vector3();

  init(ctx: VisualizerInitContext): void {
    this.rng = ctx.rng;
    this.renderer = ctx.renderer;
    this.scene.background = new THREE.Color(0x000000);

    this.buildWall();
    this.buildFloor();
    this.buildFixtures();
    this.buildHaze();
    this.buildLasers();
    this.buildWash();

    // seed ごとに変わるもの: 最初のパターン、ビートが無い区間の揺れの位相、集中パターンの狙う位置、レーザーの振りの位相
    this.patternIndex = Math.floor(this.rng() * PATTERNS.length) % PATTERNS.length;
    for (let i = 0; i < this.idlePhase.length; i++) this.idlePhase[i] = this.rng() * Math.PI * 2;
    for (let k = 0; k < 4; k++) this.convergePoints.push(new THREE.Vector2((this.rng() * 2 - 1) * 4, -2 + this.rng() * 6));
    this.laserSeed = this.rng() * Math.PI * 2;

    this.applyTheme(String(ctx.params.colorTheme ?? 'default'));
    this.resize(ctx.width, ctx.height);
    this.idleTargets();
    this.leanX.set(this.targetX);
    this.leanZ.set(this.targetZ);
    this.writeFixtures(0, 0.5, 0.5);
    this.writeLasers(0);
    this.updateCamera(ctx.params);
  }

  update(frame: AudioFrame, params: CommonParams & Record<string, unknown>): void {
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(frame.dt) ? frame.dt : 0));
    this.t += dt;
    if (params.colorTheme !== this.themeName) this.applyTheme(params.colorTheme);

    const shaped = shapeAudio(frame, params);
    const a = { bass: finite01(shaped.bass), high: finite01(shaped.high), beat: finite01(shaped.beat) };
    const intensity = finite01(params.intensity);
    const motion = finite01(params.motion);

    // bass → スモーク: 立ち上がりは速く、引きはゆっくり
    const rate = a.bass > this.smoke ? 8 : 1.2;
    this.smoke += (a.bass - this.smoke) * (1 - Math.exp(-rate * dt));
    const density = 0.25 + this.smoke * 1.1 * intensity;

    // 光を客席へ向ける量 (このプリセットだけの設定)
    this.crowd = typeof params.towardCrowd === 'number' ? finite01(params.towardCrowd) : 0;
    // カメラを先に動かす (ライトがカメラを向いたかどうかを、このフレームのカメラの位置で決めるため)
    this.updateCamera(params);

    // beat → ムービングライトの振り
    this.updatePattern(frame);
    const k = 1 - Math.exp(-(3 + motion * 9) * dt);
    for (let i = 0; i < FIXTURE_COUNT; i++) {
      this.leanX[i] = this.leanX[i]! + (this.targetX[i]! - this.leanX[i]!) * k;
      this.leanZ[i] = this.leanZ[i]! + (this.targetZ[i]! - this.leanZ[i]!) * k;
    }
    // ビートのたびに全体が強く明滅すると画面の広い範囲が点滅するので、変化の幅は控えめにする
    const strength = (0.25 + 0.75 * intensity) * (0.65 + 0.35 * a.beat);
    this.writeFixtures(a.beat, strength, density);
    this.updateWash(dt, intensity);

    const flowSpeed = 0.5 + motion;
    for (const m of this.hazeMaterials) {
      m.uniforms.time!.value = (m.uniforms.time!.value as number) + dt * flowSpeed;
      m.uniforms.density!.value = (0.015 + this.smoke * 0.07) * intensity;
    }
    for (const m of this.beamMaterials) m.uniforms.time!.value = (m.uniforms.time!.value as number) + dt * flowSpeed;
    this.wallMaterial.uniforms.glow!.value = 0.1 + (this.smoke * 0.4 + a.beat * 0.15) * intensity;

    // high → レーザーのストロボ
    this.updateStrobe(dt, a.high, intensity, motion);
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();

    // 縦長の画面では、トラス・灯体・レーザーの間隔を詰めて横にはみ出さないようにする
    this.layoutScale = THREE.MathUtils.clamp(this.aspect / (16 / 9), 0.45, 1);
    this.layoutFixtures();

    const pr = this.renderer?.getPixelRatio() ?? 1;
    this.floor?.getRenderTarget().setSize(Math.max(1, Math.round(w * pr * 0.5)), Math.max(1, Math.round(h * pr * 0.5)));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.floor?.dispose();
    this.scene.clear();
    this.renderer = null;
  }

  /** テスト用: 反応の結果を数値で覗く (描画には使わない)。 */
  inspect(): LiveStageInspection {
    let strength = 0;
    for (const m of this.beamMaterials) strength += m.uniforms.strength!.value as number;
    return {
      smoke: this.smoke,
      beamDensity: this.beamMaterials[0]!.uniforms.density!.value as number,
      beamStrength: strength / FIXTURE_COUNT,
      lasersVisible: this.lasersVisible,
      laserFlashes: this.laserFlashes,
      pattern: PATTERNS[this.patternIndex]!,
      patternChanges: this.patternChanges,
      wash: this.washLevel,
      washRises: this.washRises,
      maxHit: this.maxHit,
    };
  }

  /** テスト用: ライトの向き・パターン・レーザーの状態 (決定論性の確認に使う)。 */
  stageSnapshot(): number[] {
    return [...this.leanX, ...this.leanZ, this.patternIndex, this.laserSweep, this.strobePhase, this.laserFlashes];
  }

  // ---------------------------------------------------------------- build

  private track<T extends { dispose(): void }>(obj: T): T {
    this.disposables.push(obj);
    return obj;
  }

  private buildWall(): void {
    this.wallMaterial = this.track(createWallMaterial());
    const wall = new THREE.Mesh(this.track(new THREE.PlaneGeometry(70, 30)), this.wallMaterial);
    wall.position.set(0, 13, WALL_Z);
    this.scene.add(wall);
  }

  private buildFloor(): void {
    const geo = this.track(new THREE.PlaneGeometry(90, 90));
    this.floor = new Reflector(geo, {
      clipBias: 0.003,
      textureWidth: 512,
      textureHeight: 512,
      color: 0xffffff,
      shader: stageFloorShader,
    });
    this.floor.rotation.x = -Math.PI / 2;
    this.floorUniforms = (this.floor.material as THREE.ShaderMaterial).uniforms;
    this.scene.add(this.floor);
  }

  private buildFixtures(): void {
    this.fixtureMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.truss = new THREE.Mesh(this.track(new THREE.BoxGeometry(1, 0.28, 0.28)), this.fixtureMaterial);
    this.fixtures.add(this.truss);

    const beamGeo = this.track(new THREE.CylinderGeometry(BEAM_APEX_RADIUS, BEAM_END_RADIUS, BEAM_LENGTH, 40, 12, true));
    beamGeo.translate(0, -BEAM_LENGTH / 2, 0); // 根元を原点に、-Y 方向へ伸ばす
    const headGeo = this.track(new THREE.CylinderGeometry(0.2, 0.27, 0.5, 16));
    headGeo.translate(0, 0.1, 0);
    const spotGeo = this.track(new THREE.CircleGeometry(1, 40));
    spotGeo.rotateX(-Math.PI / 2);
    const radial = this.track(makeRadialTexture());
    const streakTex = this.track(makeStreakTexture());

    for (let i = 0; i < FIXTURE_COUNT; i++) {
      const bm = this.track(createBeamMaterial(BEAM_LENGTH));
      const beam = new THREE.Mesh(beamGeo, bm);
      beam.frustumCulled = false;
      beam.renderOrder = 2;
      this.beamMaterials.push(bm);
      this.beams.push(beam);

      const head = new THREE.Mesh(headGeo, this.fixtureMaterial);
      this.heads.push(head);

      const lm = this.track(
        new THREE.SpriteMaterial({ map: radial, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      );
      const lens = new THREE.Sprite(lm);
      lens.scale.setScalar(0.9);
      lens.renderOrder = 3;
      this.lensMaterials.push(lm);
      this.lenses.push(lens);

      const sm = this.track(
        new THREE.MeshBasicMaterial({ alphaMap: radial, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      const spot = new THREE.Mesh(spotGeo, sm);
      spot.renderOrder = 1;
      this.spotMaterials.push(sm);
      this.spots.push(spot);

      const stm = this.track(
        new THREE.SpriteMaterial({ map: streakTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }),
      );
      const streak = new THREE.Sprite(stm);
      streak.visible = false;
      streak.renderOrder = 5;
      this.streakMaterials.push(stm);
      this.streaks.push(streak);

      this.fixtures.add(beam, head, lens, spot, streak);
    }
    this.scene.add(this.fixtures);
  }

  private buildHaze(): void {
    const geo = this.track(new THREE.PlaneGeometry(40, 9));
    const depths = [-8, -4.5, -1, 2.5];
    for (let i = 0; i < depths.length; i++) {
      const m = this.track(createHazeMaterial());
      m.uniforms.offset!.value = i * 3.7 + this.rng() * 10;
      const haze = new THREE.Mesh(geo, m);
      haze.position.set(0, 4.5, depths[i]!);
      haze.renderOrder = 1;
      this.hazeMaterials.push(m);
      this.scene.add(haze);
    }
  }

  private buildLasers(): void {
    const geo = this.track(new THREE.CylinderGeometry(0.013, 0.013, 1, 6, 1, true));
    geo.translate(0, 0.5, 0); // 根元を原点に、+Y 方向へ長さ 1
    const material = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        alphaMap: this.track(makeLaserFadeTexture()),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.lasers = new THREE.InstancedMesh(geo, material, LASER_COUNT);
    this.lasers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LASER_COUNT * 3), 3);
    this.lasers.frustumCulled = false;
    this.lasers.renderOrder = 4;
    for (let e = 0; e < LASER_EMITTERS; e++) this.laserOrigins.push(new THREE.Vector3());
    this.scene.add(this.lasers);
  }

  /** 画面全体を少し明るくする板 (カメラの目の前に置く。加算) */
  private buildWash(): void {
    this.washMaterial = this.track(
      new THREE.MeshBasicMaterial({ color: 0x000000, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }),
    );
    this.wash = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1, 1)), this.washMaterial);
    this.wash.frustumCulled = false;
    this.wash.renderOrder = 10;
    this.wash.visible = false;
    this.scene.add(this.wash);
  }

  /**
   * ライトがカメラを向いた瞬間に、画面全体を少し明るくする (ユーザーの選択 B)。**向いた瞬間だけ**: いちばん向いている
   * ライトの度合いが HIT_FLASH を下から越えたときに明るくし、0.3 秒ほどで引く (向いたままでも明るいままにはしない。
   * 最初は向いている度合いの合計に合わせていたが、客席へ向けると常にどれかが少し向いているので、画面がずっと灰色にかすんだ)。
   * 光過敏への配慮: 明るくなり始めるのは前回から WASH_MIN_INTERVAL 秒たってから (毎秒 3 回よりずっと少ない)。上限は WASH_MAX
   */
  private updateWash(dt: number, intensity: number): void {
    const crossed = this.maxHit > HIT_FLASH && this.prevMaxHit <= HIT_FLASH;
    this.prevMaxHit = this.maxHit;
    if (crossed && this.t - this.lastWashRise >= WASH_MIN_INTERVAL && intensity > 0) {
      this.lastWashRise = this.t;
      this.washRises++;
      this.washPeak = WASH_MAX * intensity * this.maxHit;
    }
    // 立ち上がりは 0.05 秒ほどでなめらかに、そのあと引いていく
    const since = this.t - this.lastWashRise;
    const target = since < 0.05 ? this.washPeak : this.washPeak * Math.exp(-(since - 0.05) * 7);
    this.washLevel += (target - this.washLevel) * (1 - Math.exp(-dt * 40));
    this.wash.visible = this.washLevel > 0.002;
    if (!this.wash.visible) return;
    this.washMaterial.color.copy(this.palette.beamA).lerp(this.palette.beamB, 0.5).lerp(WHITE, 0.3).multiplyScalar(this.washLevel);
    // カメラの目の前 (0.5 先) に、見える範囲より十分大きく置く (Host が傾けたり拡大・縮小したりしても覆えるように)
    const fwd = this.tmpDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.wash.position.copy(this.camera.position).addScaledVector(fwd, 0.5);
    this.wash.quaternion.copy(this.camera.quaternion);
    this.wash.scale.set(4, 4, 1);
  }

  /** 灯体とレーザーの発射位置を layoutScale に合わせて並べ直す。 */
  private layoutFixtures(): void {
    const s = this.layoutScale;
    for (let i = 0; i < FIXTURE_COUNT; i++) {
      const x = (i - (FIXTURE_COUNT - 1) / 2) * FIXTURE_SPACING * s;
      this.beams[i]!.position.set(x, TRUSS_Y, TRUSS_Z);
      this.heads[i]!.position.set(x, TRUSS_Y, TRUSS_Z);
      this.lenses[i]!.position.set(x, TRUSS_Y - 0.12, TRUSS_Z);
    }
    this.truss.position.set(0, TRUSS_Y + 0.42, TRUSS_Z);
    this.truss.scale.set((FIXTURE_COUNT * FIXTURE_SPACING + 1) * s, 1, 1);
    this.laserOrigins[0]!.set(0, 1.0, WALL_Z + 0.4);
    this.laserOrigins[1]!.set(-6.8 * s, 6.6, WALL_Z + 0.6);
    this.laserOrigins[2]!.set(6.8 * s, 6.6, WALL_Z + 0.6);
  }

  // ---------------------------------------------------------------- update

  private applyTheme(name: string): void {
    this.themeName = name;
    this.palette = liveStagePalette(name);
    const p = this.palette;
    for (let i = 0; i < FIXTURE_COUNT; i++) {
      (this.beamMaterials[i]!.uniforms.color!.value as THREE.Color).copy(this.beamColor(i));
    }
    for (const m of this.hazeMaterials) (m.uniforms.color!.value as THREE.Color).copy(p.haze);
    (this.wallMaterial.uniforms.baseColor!.value as THREE.Color).copy(p.wall);
    (this.wallMaterial.uniforms.glowColor!.value as THREE.Color).copy(p.wallGlow);
    (this.floorUniforms.floorColor!.value as THREE.Color).copy(p.floor);
    this.fixtureMaterial.color.copy(p.fixture);
  }

  private beamColor(i: number): THREE.Color {
    return i % 2 === 0 ? this.palette.beamA : this.palette.beamB;
  }

  /** beatIndex からフレーズ (8 ビート) の切り替えと、今のビートでの向きの目標を決める。 */
  private updatePattern(frame: AudioFrame): void {
    const beatIndex = Number.isFinite(frame.beatIndex) ? Math.floor(frame.beatIndex) : -1;
    if (beatIndex < 0) {
      this.idleTargets();
      return;
    }
    const phrase = Math.floor(beatIndex / PHRASE_BEATS);
    if (phrase !== this.lastPhrase) {
      // 直前と同じパターンは選ばない
      let next = Math.floor(this.rng() * (PATTERNS.length - 1)) % (PATTERNS.length - 1);
      if (next >= this.patternIndex) next++;
      this.patternIndex = next;
      this.patternChanges++;
      this.lastPhrase = phrase;
    }
    this.phraseStartBeat = phrase * PHRASE_BEATS;
    this.patternTargets(PATTERNS[this.patternIndex]!, beatIndex - this.phraseStartBeat);
  }

  private patternTargets(pattern: PatternName, step: number): void {
    const n = FIXTURE_COUNT;
    const mirror = step % 2 === 0 ? 1 : -1;
    // 縦長の画面では横の振り幅も少し抑える
    const xs = 0.5 + 0.5 * this.layoutScale;
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1)) * 2 - 1;
      let lx = 0;
      let lz = 0;
      switch (pattern) {
        case 'fan':
          lx = u * 0.9 * mirror;
          lz = 0.35;
          break;
        case 'cross':
          lx = (i % 2 === 0 ? 1 : -1) * mirror * 0.75;
          lz = 0.25;
          break;
        case 'wave':
          lx = u * 0.15;
          lz = 0.1 + 0.8 * (0.5 + 0.5 * Math.cos(((i - step) * Math.PI) / 3));
          break;
        case 'chase': {
          const c = CHASE_STEPS[((step % 4) + 4) % 4]!;
          lx = c[0];
          lz = c[1];
          break;
        }
        case 'converge': {
          const p = this.convergePoints[((step % 4) + 4) % 4]!;
          const fx = (i - (n - 1) / 2) * FIXTURE_SPACING * this.layoutScale;
          lx = (p.x * this.layoutScale - fx) / TRUSS_Y;
          lz = (p.y - TRUSS_Z) / TRUSS_Y;
          break;
        }
      }
      this.targetX[i] = lx * xs;
      this.targetZ[i] = this.crowdLean(lz, i, step);
    }
  }

  /**
   * 客席側への傾き。光を客席へ向ける量が 0 なら今までどおり (MAX_LEAN_Z まで)。
   * 量を上げると、拍ごとに灯体の半分くらいずつが客席 (カメラ) の方へ振れる
   */
  private crowdLean(lz: number, i: number, step: number): number {
    const c = this.crowd;
    if (c <= 0) return Math.min(MAX_LEAN_Z, lz);
    const aim = c * (0.55 + 0.45 * Math.cos(((i + step) * Math.PI) / 2));
    const limit = MAX_LEAN_Z + c * (CROWD_LEAN_MAX - MAX_LEAN_Z);
    return Math.min(limit, lz + aim * (CROWD_LEAN_MAX - lz));
  }

  /** ビートが無い区間: 灯体ごとに位相をずらしたゆっくりのスイープ。 */
  private idleTargets(): void {
    const xs = 0.5 + 0.5 * this.layoutScale;
    for (let i = 0; i < FIXTURE_COUNT; i++) {
      this.targetX[i] = 0.45 * Math.sin(this.t * 0.35 + this.idlePhase[i * 2]!) * xs;
      this.targetZ[i] = this.crowdLean(0.35 + 0.25 * Math.sin(this.t * 0.27 + this.idlePhase[i * 2 + 1]!), i, Math.floor(this.t * 0.5));
    }
  }

  private writeFixtures(beat: number, strength: number, density: number): void {
    this.maxHit = 0;
    for (let i = 0; i < FIXTURE_COUNT; i++) {
      const dir = this.tmpDir.set(this.leanX[i]!, -1, this.leanZ[i]!).normalize();
      const beam = this.beams[i]!;
      beam.quaternion.setFromUnitVectors(DOWN, dir);
      this.heads[i]!.quaternion.copy(beam.quaternion);

      const toCam0 = this.tmpVec.copy(this.camera.position).sub(beam.position).normalize();
      const facing = dir.dot(toCam0);
      const cover = THREE.MathUtils.smoothstep(facing, COVER_COS_OUTER, COVER_COS_INNER);
      const u = this.beamMaterials[i]!.uniforms;
      // カメラを向いた円錐は薄くする (今までのカメラ・向きでは cover = 0 なので変わらない)
      u.strength!.value = strength * (1 - 0.9 * cover);
      u.density!.value = density;

      // ライトがカメラを向いているか (0..1)。向いているほど、レンズの玉が大きく強く光り、十字の光条が出る
      const toCam = this.tmpVec.copy(this.camera.position).sub(beam.position).normalize();
      const hit = THREE.MathUtils.smoothstep(dir.dot(toCam), HIT_COS_OUTER, HIT_COS_INNER);
      this.maxHit = Math.max(this.maxHit, hit);
      // レンズ: Bloom のしきい値を超えて光るのはここだけ (ビートで強く)
      this.lensMaterials[i]!.color.copy(this.beamColor(i)).multiplyScalar(strength * (1.4 + 2.2 * beat) * (1 + 3 * hit));
      this.lenses[i]!.scale.setScalar(0.9 * (1 + 2.2 * hit));
      const streak = this.streaks[i]!;
      streak.visible = hit > 0.01;
      if (streak.visible) {
        streak.position.copy(this.lenses[i]!.position);
        streak.scale.setScalar(0.9 * (2 + 7 * hit));
        this.streakMaterials[i]!.color.copy(this.beamColor(i)).lerp(WHITE, 0.4).multiplyScalar(1.6 * strength * hit);
      }

      // 床に落ちる光の輪: 光線と床 (y=0) の交点。床に届かない向きなら消す
      const spot = this.spots[i]!;
      if (dir.y < -0.2) {
        const dist = beam.position.y / -dir.y;
        const hit = this.tmpVec.copy(beam.position).addScaledVector(dir, dist);
        const radius = BEAM_APEX_RADIUS + ((BEAM_END_RADIUS - BEAM_APEX_RADIUS) * dist) / BEAM_LENGTH;
        spot.position.set(hit.x, 0.02, hit.z);
        spot.scale.set(radius * 1.3, 1, (radius * 1.3) / -dir.y);
        spot.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
        spot.visible = true;
        this.spotMaterials[i]!.color.copy(this.beamColor(i)).multiplyScalar(0.22 * strength * density);
      } else {
        spot.visible = false;
      }
    }
  }

  private updateStrobe(dt: number, high: number, intensity: number, motion: number): void {
    // 周期は high が強いほど短いが、MAX_STROBE_HZ を超えない
    const rate = MAX_STROBE_HZ * (0.5 + 0.5 * high);
    const prev = Math.floor(this.strobePhase);
    this.strobePhase += dt * rate;
    if (Math.floor(this.strobePhase) !== prev) {
      // 新しい周期の頭: この周期で光らせるかを決める
      this.strobeFired = high > HIGH_THRESHOLD && intensity > 0;
      if (this.strobeFired) {
        this.laserFlashes++;
        this.laserLevel = high;
      }
    }
    this.laserSweep += dt * (0.4 + motion * 1.2);
    const on = this.strobeFired && this.strobePhase - Math.floor(this.strobePhase) < STROBE_DUTY;
    this.writeLasers(on ? this.laserLevel * intensity : 0);
  }

  private writeLasers(level: number): void {
    const s = this.layoutScale;
    // 点灯ごとに扇の開きを変える (広い / 狭い)
    const spread = this.laserFlashes % 2 === 0 ? 1 : 0.55;
    const sweep = Math.sin(this.laserSweep + this.laserSeed) * 0.35;
    let visible = 0;
    for (let e = 0; e < LASER_EMITTERS; e++) {
      const origin = this.laserOrigins[e]!;
      for (let j = 0; j < LASERS_PER_EMITTER; j++) {
        const idx = e * LASERS_PER_EMITTER + j;
        const u = (j / (LASERS_PER_EMITTER - 1)) * 2 - 1;
        if (level <= 0) {
          this.dummy.position.set(0, -1000, 0);
          this.dummy.scale.set(0.0001, 0.0001, 0.0001);
          this.dummy.quaternion.identity();
          this.tmpColor.setRGB(0, 0, 0);
        } else {
          // 客席側 (z=LASER_TARGET_Z) の面に狙う点を決める。中央の発射口は上へ扇状に、左右の発射口は反対側の客席へ交差させる
          if (e === 0) {
            this.tmpVec.set((u * spread + sweep) * 9 * s, 5 + 2.5 * Math.abs(u), LASER_TARGET_Z);
          } else {
            const side = e === 1 ? -1 : 1;
            this.tmpVec.set((-side * (1 + 7 * (j / (LASERS_PER_EMITTER - 1)) * spread) + sweep * 5) * s, 0.5 + 2 * (1 - spread), LASER_TARGET_Z);
          }
          // 光を客席へ向けるときは、カメラのすぐそばを通るように寄せる (カメラの手前で消えるので、太い線にはならない)
          if (this.crowd > 0) {
            const cam = this.camera.position;
            const side = j % 2 === 0 ? 1 : -1;
            this.tmpVec.x = THREE.MathUtils.lerp(this.tmpVec.x, cam.x + side * (1.2 + 3 * Math.abs(u)), this.crowd * 0.7);
            this.tmpVec.y = THREE.MathUtils.lerp(this.tmpVec.y, cam.y + 0.6 * u, this.crowd * 0.7);
          }
          // カメラが客席の前の方にいるときは、カメラより手前 (ステージ側) で消す
          const cz = this.camera.position.z;
          if (cz > 0) this.tmpVec.z = Math.min(LASER_TARGET_Z, cz - 1.5);
          const dir = this.tmpDir.copy(this.tmpVec).sub(origin);
          const length = dir.length();
          dir.divideScalar(length);
          this.dummy.position.copy(origin);
          this.dummy.quaternion.setFromUnitVectors(UP, dir);
          this.dummy.scale.set(1, length, 1);
          this.tmpColor.copy(this.palette.laser).multiplyScalar(0.8 + 1.5 * level);
          visible++;
        }
        this.dummy.updateMatrix();
        this.lasers.setMatrixAt(idx, this.dummy.matrix);
        this.lasers.setColorAt(idx, this.tmpColor);
      }
    }
    this.lasersVisible = visible;
    this.lasers.instanceMatrix.needsUpdate = true;
    if (this.lasers.instanceColor) this.lasers.instanceColor.needsUpdate = true;
  }

  /**
   * カメラ: 場所 (cameraSpot) の位置から、見る点のまわりを左右の向き (cameraYaw) の分だけ回し、距離 (cameraDistance) を掛け、
   * 高さ (cameraHeight) を足す。Camera Motion のゆっくりした揺れはその上に足す。設定が無ければ今まで (客席の後ろ) と同じ
   */
  private updateCamera(params: CommonParams & Record<string, unknown>): void {
    const cm = finite01(params.cameraMotion);
    const spotName = typeof params.cameraSpot === 'string' && params.cameraSpot in CAMERA_SPOTS ? (params.cameraSpot as CameraSpot) : 'back';
    const spot = CAMERA_SPOTS[spotName];
    const num = (v: unknown, d: number, a: number, b: number): number => (typeof v === 'number' && Number.isFinite(v) ? THREE.MathUtils.clamp(v, a, b) : d);
    const yaw = THREE.MathUtils.degToRad(num(params.cameraYaw, 0, -1, 1) * CAMERA_YAW_MAX);
    const dist = num(params.cameraDistance, 1, 0.5, 2);
    const height = num(params.cameraHeight, 0, -1, 1);
    const offset = this.tmpVec.copy(spot.pos).sub(spot.look).applyAxisAngle(UP, yaw).multiplyScalar(dist);
    const pos = offset.add(spot.look);
    pos.y = Math.max(0.3, pos.y + height * 3);
    this.camera.position.set(
      pos.x + Math.sin(this.t * 0.09) * 1.4 * cm * this.layoutScale,
      pos.y + Math.sin(this.t * 0.07) * 0.35 * cm,
      pos.z,
    );
    this.camera.lookAt(spot.look);
  }
}

/** NaN/Infinity を 0 に倒してから 0..1 に収める (壊れた入力で照明の状態が NaN に汚染されないように)。 */
function finite01(v: number): number {
  return Number.isFinite(v) ? THREE.MathUtils.clamp(v, 0, 1) : 0;
}

/** 中心が明るく外へ消える丸 (レンズの光・床の光の輪)。canvas ではなく配列から作る (jsdom でも同じものができる)。 */
function makeRadialTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const v = Math.max(0, 1 - r);
      const a = Math.round(Math.min(1, Math.pow(v, 1.8) * 0.85 + Math.pow(v, 8) * 0.6) * 255);
      const i = (y * size + x) * 4;
      data[i] = a;
      data[i + 1] = a;
      data[i + 2] = a;
      data[i + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** ライトがカメラを向いたときの十字の光条 (縦横に強く、斜めに弱く伸びる線 + 中心の光) */
function makeStreakTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size - 0.5) * 2;
      const dy = ((y + 0.5) / size - 0.5) * 2;
      const r = Math.hypot(dx, dy);
      const fade = Math.max(0, 1 - r);
      const ray = (px: number): number => Math.exp(-Math.abs(px) * 60);
      const cross = Math.max(ray(dx) , ray(dy)) * fade;
      const diag = Math.max(ray((dx - dy) * 0.7071), ray((dx + dy) * 0.7071)) * fade * 0.35;
      const core = Math.pow(Math.max(0, 1 - r * 3), 2);
      const v = Math.round(Math.min(1, cross + diag + core) * 255);
      const i = (y * size + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = v;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** レーザー 1 本の長さ方向の減衰 (CylinderGeometry の uv.y は根元 0 → 先端 1)。 */
function makeLaserFadeTexture(): THREE.DataTexture {
  const h = 64;
  const data = new Uint8Array(h * 4);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    const a = Math.round(Math.max(0, Math.min(1, (1 - v) * 0.8 + 0.2) * Math.min(1, (1 - v) * 12)) * 255);
    data[y * 4] = a;
    data[y * 4 + 1] = a;
    data[y * 4 + 2] = a;
    data[y * 4 + 3] = a;
  }
  const tex = new THREE.DataTexture(data, 1, h, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
