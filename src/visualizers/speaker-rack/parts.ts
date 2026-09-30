import * as THREE from 'three';

/**
 * Speaker Rack の部品 (ウーファー・LED のバー・VU メーター・真空管・つまみ) と、音の動きの計算。
 * 動きの計算は WebGL なしで確かめられるように、ここにまとめて純粋な関数にしてある (speaker-rack.test.ts)。
 */

// ---------------------------------------------------------------- 動きの計算

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
export const safeDt = (dt: number): number => (Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0);

/** 立ち上がりは速く、引きはゆっくりの追いかけ */
export function follow(cur: number, target: number, dt: number, up: number, down: number): number {
  const v = clamp01(target);
  const rate = v > cur ? up : down;
  return cur + (v - cur) * (1 - Math.exp(-rate * safeDt(dt)));
}

/**
 * ばね (重さのある振動板・メーターの針)。target へ引かれ、行き過ぎて少し戻る。
 * 大きな dt でも暴れないよう、細かい刻みに分けて進める
 */
export interface Spring {
  x: number;
  v: number;
}
export function stepSpring(s: Spring, target: number, dt: number, stiffness: number, damping: number): void {
  const t = Number.isFinite(target) ? target : 0;
  let left = safeDt(dt);
  while (left > 0) {
    const h = Math.min(left, 1 / 240);
    const a = stiffness * (t - s.x) - damping * s.v;
    s.v += a * h;
    s.x += s.v * h;
    left -= h;
  }
  if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) {
    s.x = 0;
    s.v = 0;
  }
}

/** バーの値とピークの点 (ピークはしばらく残ってからゆっくり落ちる) */
export class PeakMeter {
  readonly level: Float32Array;
  readonly peak: Float32Array;
  private readonly hold: Float32Array;
  constructor(
    readonly count: number,
    private readonly holdTime = 0.6,
    private readonly fall = 1.1,
  ) {
    this.level = new Float32Array(count);
    this.peak = new Float32Array(count);
    this.hold = new Float32Array(count);
  }
  update(values: ArrayLike<number>, dt: number): void {
    const h = safeDt(dt);
    for (let i = 0; i < this.count; i++) {
      const v = clamp01(values[i] ?? 0);
      this.level[i] = follow(this.level[i]!, v, h, 40, 7);
      if (this.level[i]! >= this.peak[i]!) {
        this.peak[i] = this.level[i]!;
        this.hold[i] = this.holdTime;
      } else if (this.hold[i]! > 0) {
        this.hold[i] = this.hold[i]! - h;
      } else {
        this.peak[i] = Math.max(this.level[i]!, this.peak[i]! - this.fall * h);
      }
    }
  }
}

/**
 * 64 帯域を n 本のバーにまとめる (低い音ほど帯域が詰まっているので、下の方を細かく、上の方をまとめる)。
 * 上の帯域は元々値が小さいので、少し持ち上げる
 */
export function bandsToBars(bands: ArrayLike<number>, n: number, out: Float32Array): Float32Array {
  const total = Math.min(bands.length, 56);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(Math.pow(i / n, 1.6) * total);
    const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 1.6) * total));
    let s = 0;
    for (let k = a; k < b; k++) s += Number.isFinite(bands[k]!) ? bands[k]! : 0;
    const lift = 1 + (i / n) * 0.8;
    out[i] = clamp01((s / (b - a)) * lift);
  }
  return out;
}

/** VU メーターの針の角度 (ラジアン)。0 = 左端、1 = 右端。音量 (0..1) を人の耳に近い形 (平方根) で振る */
export const VU_SWING = THREE.MathUtils.degToRad(96);
export const vuTarget = (level: number): number => Math.sqrt(clamp01(level));

// ---------------------------------------------------------------- 材質

/** 部品の材質 (preset が作り、色はテーマで変える) */
export interface Materials {
  metal: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  cabinet: THREE.MeshStandardMaterial;
  cone: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  tick: THREE.MeshBasicMaterial;
  /** つまみの目印 (明るい灰色) */
  mark: THREE.MeshBasicMaterial;
  /** 点灯する物 (LED・フィラメント)。色は 1 を超えて Bloom で光る */
  glowBasic: THREE.MeshBasicMaterial;
}

export type Track = <T extends { dispose(): void }>(obj: T) => T;

/**
 * 形の使い回し (同じ大きさのスピーカーをたくさん置くとき)。key が同じなら 1 度だけ作り、片づけも 1 度だけ
 */
export class GeometryCache {
  private readonly map = new Map<string, THREE.BufferGeometry>();
  constructor(private readonly track: Track) {}
  get<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    let g = this.map.get(key) as T | undefined;
    if (!g) {
      g = this.track(make());
      this.map.set(key, g);
    }
    return g;
  }
}

// ---------------------------------------------------------------- ウーファー・ツイーター

/**
 * スピーカー 1 つ (枠・ねじ・ふちのゴム・コーン・中央のキャップ)。コーンとキャップは excursion (−1..1) で前後に動き、
 * ふちのゴムはたわむ。dome = true ならツイーター (コーンの代わりに丸いドーム)
 */
export class Driver {
  readonly group = new THREE.Group();
  private readonly moving = new THREE.Group();
  private readonly surround: THREE.Mesh;
  constructor(
    readonly radius: number,
    m: Materials,
    track: Track,
    dome = false,
    cache: GeometryCache = new GeometryCache(track),
  ) {
    const R = radius;
    const key = (name: string): string => `${name}:${R}`;
    const frame = new THREE.Mesh(
      cache.get(key('frame'), () => new THREE.TorusGeometry(R * 1.1, R * 0.07, 12, 72)),
      m.metal,
    );
    const ring = new THREE.Mesh(
      cache.get(key('ring'), () => new THREE.RingGeometry(R * 1.02, R * 1.26, 72)),
      m.darkMetal,
    );
    ring.position.z = -0.01;
    this.group.add(ring, frame);
    const screw = cache.get(key('screw'), () => new THREE.CylinderGeometry(R * 0.035, R * 0.035, R * 0.05, 10).rotateX(Math.PI / 2));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const s = new THREE.Mesh(screw, m.metal);
      s.position.set(Math.cos(a) * R * 1.19, Math.sin(a) * R * 1.19, 0.02);
      this.group.add(s);
    }
    this.surround = new THREE.Mesh(
      cache.get(key('surround'), () => new THREE.TorusGeometry(R * 0.96, R * 0.075, 12, 72)),
      m.rubber,
    );
    this.group.add(this.surround);
    if (dome) {
      const d = cache.get(key('dome'), () => new THREE.SphereGeometry(R * 0.85, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2));
      const dm = new THREE.Mesh(d, m.cone);
      dm.scale.z = 0.45;
      this.moving.add(dm);
    } else {
      // コーン: 縁 (半径 0.9R) から中心 (0.32R) へ、奥へ向かってゆるく曲がる面
      const cone = cache.get(key('cone'), () => {
        const pts: THREE.Vector2[] = [];
        for (let k = 0; k <= 12; k++) {
          const f = k / 12;
          pts.push(new THREE.Vector2(R * (0.9 - 0.58 * f), -R * 0.36 * Math.pow(f, 0.8)));
        }
        return new THREE.LatheGeometry(pts, 72).rotateX(Math.PI / 2);
      });
      const cm = new THREE.Mesh(cone, m.cone);
      this.moving.add(cm);
      const cap = cache.get(key('cap'), () => new THREE.SphereGeometry(R * 0.33, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2));
      const capMesh = new THREE.Mesh(cap, m.darkMetal);
      capMesh.position.z = -R * 0.33;
      capMesh.scale.z = 0.55;
      this.moving.add(capMesh);
    }
    this.group.add(this.moving);
  }

  /** 前後の動き (−1..1)。1 = いちばん前 (半径の 12%) */
  setExcursion(e: number): void {
    const x = Number.isFinite(e) ? Math.min(1.2, Math.max(-1.2, e)) : 0;
    this.moving.position.z = x * this.radius * 0.12;
    this.surround.scale.z = 1 + Math.max(0, x) * 0.9;
    this.surround.position.z = x * this.radius * 0.04;
  }

  get excursion(): number {
    return this.moving.position.z / (this.radius * 0.12);
  }
}

// ---------------------------------------------------------------- LED のバー

/**
 * 縦の LED のバーを横に並べたもの (スペクトラム・レベルメーター)。1 本 = segments 個の四角。
 * 値の分だけ下から点き、ピークの 1 つも点く。上の方 (hotFrom より上) は ledHot の色
 */
export class LedBars {
  readonly mesh: THREE.InstancedMesh;
  private readonly on = new THREE.Color();
  private readonly hot = new THREE.Color();
  private readonly tmp = new THREE.Color();
  lit = 0;
  constructor(
    readonly bars: number,
    readonly segments: number,
    size: { w: number; h: number; gapX: number; gapY: number },
    material: THREE.MeshBasicMaterial,
    track: Track,
    private readonly hotFrom = 0.75,
  ) {
    const geo = track(new THREE.BoxGeometry(size.w, size.h, 0.03));
    this.mesh = new THREE.InstancedMesh(geo, material, bars * segments);
    const m = new THREE.Matrix4();
    const pitchX = size.w + size.gapX;
    const pitchY = size.h + size.gapY;
    for (let b = 0; b < bars; b++) {
      for (let s = 0; s < segments; s++) {
        m.makeTranslation((b - (bars - 1) / 2) * pitchX, s * pitchY, 0);
        this.mesh.setMatrixAt(b * segments + s, m);
        this.mesh.setColorAt(b * segments + s, this.tmp.setRGB(0, 0, 0));
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setColors(on: THREE.Color, hot: THREE.Color): void {
    this.on.copy(on);
    this.hot.copy(hot);
  }

  /** level / peak は 0..1 (bars 本ぶん) */
  write(level: ArrayLike<number>, peak?: ArrayLike<number>): void {
    let lit = 0;
    for (let b = 0; b < this.bars; b++) {
      const n = Math.round(clamp01(level[b] ?? 0) * this.segments);
      const p = peak ? Math.min(this.segments - 1, Math.round(clamp01(peak[b] ?? 0) * this.segments) - 1) : -1;
      for (let s = 0; s < this.segments; s++) {
        const base = s / (this.segments - 1) >= this.hotFrom ? this.hot : this.on;
        const isOn = s < n || (s === p && p > 0);
        if (isOn) lit++;
        this.tmp.copy(base).multiplyScalar(isOn ? 1 : 0.035);
        this.mesh.setColorAt(b * this.segments + s, this.tmp);
      }
    }
    this.lit = lit;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- VU メーター

/** 文字盤 (後ろから照らされる)・目盛り (右の方は赤)・針・赤いランプ。針はばねで慣性を持って振れる */
export class VuMeter {
  readonly group = new THREE.Group();
  readonly faceMaterial: THREE.MeshBasicMaterial;
  readonly lampMaterial: THREE.MeshBasicMaterial;
  private readonly needle = new THREE.Group();
  readonly spring: Spring = { x: 0, v: 0 };
  private peakHold = 0;
  private readonly faceColor = new THREE.Color();
  private readonly hotColor = new THREE.Color();
  constructor(
    w: number,
    h: number,
    m: Materials,
    track: Track,
  ) {
    const bezel = new THREE.Mesh(track(new THREE.BoxGeometry(w * 1.08, h * 1.12, 0.12)), m.darkMetal);
    bezel.position.z = -0.07;
    this.faceMaterial = track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const face = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), this.faceMaterial);
    this.group.add(bezel, face);
    // 目盛り: 針の支点 (下の真ん中より少し下) を中心にした弧の上
    const pivotY = -h * 0.62;
    const radius = h * 1.02;
    const tickGeo = track(new THREE.BoxGeometry(0.018, h * 0.1, 0.01));
    const redTick = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.04, 0.02) }));
    for (let i = 0; i <= 20; i++) {
      const f = i / 20;
      const a = -VU_SWING / 2 + f * VU_SWING;
      const t = new THREE.Mesh(tickGeo, f > 0.72 ? redTick : m.tick);
      t.position.set(Math.sin(a) * radius, pivotY + Math.cos(a) * radius, 0.006);
      t.rotation.z = -a;
      t.scale.y = i % 5 === 0 ? 1.6 : 1;
      this.group.add(t);
    }
    const needleMesh = new THREE.Mesh(track(new THREE.BoxGeometry(0.014, radius * 1.02, 0.01)), m.tick);
    needleMesh.position.y = (radius * 1.02) / 2;
    this.needle.add(needleMesh);
    this.needle.position.set(0, pivotY, 0.012);
    this.group.add(this.needle);
    this.lampMaterial = track(new THREE.MeshBasicMaterial({ color: 0x000000 }));
    const lamp = new THREE.Mesh(track(new THREE.CircleGeometry(h * 0.055, 16)), this.lampMaterial);
    lamp.position.set(w * 0.4, -h * 0.34, 0.01);
    this.group.add(lamp);
    this.setNeedle(0);
  }

  setColors(face: THREE.Color, hot: THREE.Color): void {
    this.faceColor.copy(face);
    this.hotColor.copy(hot);
  }

  /** level = 0..1 (音量)、backlight = 文字盤の明るさ */
  update(level: number, dt: number, backlight: number): void {
    // 少し行き過ぎて戻る針 (本物の VU メーターに近い 300ms ほどの立ち上がり)
    stepSpring(this.spring, vuTarget(level), dt, 90, 14);
    this.spring.x = Math.min(1.08, Math.max(-0.02, this.spring.x));
    this.setNeedle(this.spring.x);
    if (this.spring.x > 0.9) this.peakHold = 0.35;
    else this.peakHold = Math.max(0, this.peakHold - safeDt(dt));
    this.lampMaterial.color.copy(this.hotColor).multiplyScalar(this.peakHold > 0 ? 1 : 0.04);
    this.faceMaterial.color.copy(this.faceColor).multiplyScalar(clamp01(backlight));
  }

  get lampOn(): boolean {
    return this.peakHold > 0;
  }

  get needleAngle(): number {
    return this.needle.rotation.z;
  }

  private setNeedle(x: number): void {
    this.needle.rotation.z = VU_SWING / 2 - x * VU_SWING;
  }
}

// ---------------------------------------------------------------- 真空管・つまみ

/** 真空管 (ガラスの筒・中の板・光るフィラメント・まわりのにじみ) */
export class Tube {
  readonly group = new THREE.Group();
  readonly filament: THREE.MeshBasicMaterial;
  readonly halo: THREE.SpriteMaterial;
  constructor(r: number, h: number, m: Materials, track: Track, haloTexture: THREE.Texture) {
    const glass = new THREE.Mesh(track(new THREE.CylinderGeometry(r, r, h, 24, 1, true)), m.glass);
    const top = new THREE.Mesh(track(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), m.glass);
    top.position.y = h / 2;
    const base = new THREE.Mesh(track(new THREE.CylinderGeometry(r * 1.15, r * 1.2, h * 0.16, 24)), m.darkMetal);
    base.position.y = -h / 2 - h * 0.06;
    const plate = new THREE.Mesh(track(new THREE.BoxGeometry(r * 1.1, h * 0.5, r * 0.5)), m.darkMetal);
    this.filament = track(new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }));
    const fil = new THREE.Mesh(track(new THREE.BoxGeometry(r * 0.5, h * 0.36, r * 0.55)), this.filament);
    fil.position.y = -h * 0.02;
    this.halo = track(new THREE.SpriteMaterial({ map: haloTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    const halo = new THREE.Sprite(this.halo);
    halo.scale.set(r * 5, h * 1.6, 1);
    halo.renderOrder = 3;
    this.group.add(base, plate, fil, glass, top, halo);
  }
}

/** つまみ (丸い金属と白い目印の線)。angle はラジアン */
export function makeKnob(r: number, angle: number, m: Materials, track: Track): THREE.Group {
  const g = new THREE.Group();
  const body = track(new THREE.CylinderGeometry(r * 0.86, r, r * 0.7, 32));
  body.rotateX(Math.PI / 2);
  const knob = new THREE.Mesh(body, m.metal);
  knob.position.z = r * 0.35;
  const skirt = new THREE.Mesh(track(new THREE.RingGeometry(r * 1.02, r * 1.25, 32)), m.darkMetal);
  const mark = new THREE.Mesh(track(new THREE.BoxGeometry(r * 0.1, r * 0.6, 0.01)), m.mark);
  mark.position.set(0, r * 0.45, r * 0.71);
  const turn = new THREE.Group();
  turn.add(knob, mark);
  turn.rotation.z = angle;
  g.add(skirt, turn);
  return g;
}

/** 丸いにじみ (真空管・灯り用) */
export function makeRadialTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const v = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.round(Math.min(1, Math.pow(v, 2) * 0.9) * 255);
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

/**
 * 値の遅れ (ディレイ)。一定の刻み (1/120 秒) で値を覚えておき、delay 秒前の値を返す。
 * 通路のスピーカーを、手前から奥へ少しずつ遅らせて動かす (低音の波が奥へ伝わって見える) のに使う
 */
export class DelayLine {
  private readonly buf: Float32Array;
  private head = 0;
  private acc = 0;
  private last = 0;
  constructor(
    readonly maxDelay: number,
    private readonly step = 1 / 120,
  ) {
    this.buf = new Float32Array(Math.ceil(maxDelay / step) + 2);
  }
  push(value: number, dt: number): void {
    const v = Number.isFinite(value) ? value : 0;
    this.acc += safeDt(dt);
    while (this.acc >= this.step) {
      this.acc -= this.step;
      this.head = (this.head + 1) % this.buf.length;
      this.buf[this.head] = v;
    }
    this.last = v;
  }
  /** delay 秒前の値 (0 なら今の値) */
  get(delay: number): number {
    const d = Number.isFinite(delay) ? Math.min(this.maxDelay, Math.max(0, delay)) : 0;
    if (d === 0) return this.last;
    const n = Math.round(d / this.step);
    return this.buf[(this.head - n + this.buf.length * 2) % this.buf.length]!;
  }
}

