import * as THREE from 'three';
import type { SpeakerRackPalette } from './palette';
import { Driver, LedBars, makeKnob, Tube, VuMeter, type Materials, type Track } from './parts';

/**
 * 並び「ラックとスピーカー 2 台」(参考画像②)。真ん中の機材ラックと、左右の大きなスピーカー。
 * ラックは上から: スペクトラムの LED / VU メーター 2 つ / つまみ / イコライザー (スライダーと LED・レベルメーター) /
 * アンプのつまみ / 真空管 2 本と通気口 / 下の網。
 * 形のばらつき (つまみの角度・スライダーの位置) は preset から渡される rng (seed 由来) で決める。
 */

/** 画面の横幅に収めたい半分の幅 (スピーカーの外側まで) と、見る点 */
export const RACK_FIT_HALF_WIDTH = 11.4;
export const RACK_FIT_HALF_HEIGHT = 6.4;
export const RACK_LOOK_AT = new THREE.Vector3(0, 0, 0);

export const SPECTRUM_BARS = 32;
const SPECTRUM_SEGMENTS = 12;
export const EQ_BANDS = 20;
const LEVEL_SEGMENTS = 16;

const CAB = { w: 7.2, h: 11.2, d: 2.6, x: 7.5 };
const WOOFER_R = 2.75;
const WOOFER_Y = -1.3;
const TWEETER_R = 0.72;
const TWEETER_Y = 3.75;
const RACK = { w: 7.0, top: 5.3, bottom: -5.2 };
const FLOOR_Y = -5.6;
/** 箱の本体を前の面からどれだけ奥に置くか (コーンの深さより深く) */
const BOX_BACK = WOOFER_R * 0.45;

export interface RackAudioView {
  /** ウーファー (左右) の前後の動き (−1..1) とツイーター */
  woofer: [number, number];
  tweeter: [number, number];
  spectrum: Float32Array;
  spectrumPeak: Float32Array;
  eq: Float32Array;
  levels: [number, number];
  vu: [number, number];
  /** 真空管・文字盤・足もとの灯りの明るさ (0..1) */
  tubeGlow: number;
  backlight: number;
  accent: number;
  dt: number;
}

export class RackScene {
  readonly group = new THREE.Group();
  readonly woofers: Driver[] = [];
  readonly tweeters: Driver[] = [];
  readonly spectrum: LedBars;
  readonly eqLeds: LedBars;
  readonly levelBars: LedBars;
  readonly meters: VuMeter[] = [];
  private readonly tubes: Tube[] = [];
  private readonly smallLeds: THREE.InstancedMesh;
  private readonly smallLedCount: number;
  private readonly strips: THREE.MeshBasicMaterial;
  private readonly cabinets: THREE.Group[] = [];
  private readonly palette = { led: new THREE.Color(), accent: new THREE.Color(), filament: new THREE.Color() };
  private readonly tmp = new THREE.Color();

  constructor(m: Materials, track: Track, rng: () => number, haloTexture: THREE.Texture) {
    const box = track(new THREE.BoxGeometry(1, 1, 1));
    const put = (mat: THREE.Material, pos: [number, number, number], scale: [number, number, number], parent: THREE.Object3D = this.group): THREE.Mesh => {
      const mesh = new THREE.Mesh(box, mat);
      mesh.position.set(...pos);
      mesh.scale.set(...scale);
      parent.add(mesh);
      return mesh;
    };

    // ---- 左右のスピーカー
    for (const side of [-1, 1]) {
      const cab = new THREE.Group();
      cab.position.set(side * CAB.x, 0, 0);
      // 箱の本体は、コーンが入る深さだけ奥に置き、前の面は穴の開いた板 (バッフル) にする (コーンが穴から見える)
      put(m.cabinet, [0, 0, -BOX_BACK - CAB.d / 2], [CAB.w, CAB.h, CAB.d], cab);
      const baffle = new THREE.Shape();
      baffle.moveTo(-CAB.w / 2, -CAB.h / 2);
      baffle.lineTo(CAB.w / 2, -CAB.h / 2);
      baffle.lineTo(CAB.w / 2, CAB.h / 2);
      baffle.lineTo(-CAB.w / 2, CAB.h / 2);
      baffle.closePath();
      const hole = (x: number, y: number, r: number): void => {
        const h = new THREE.Path();
        h.absarc(x, y, r, 0, Math.PI * 2, true);
        baffle.holes.push(h);
      };
      hole(0, WOOFER_Y, WOOFER_R * 1.02);
      hole(0, TWEETER_Y, TWEETER_R * 1.02);
      for (const px of [-CAB.w * 0.3, CAB.w * 0.3]) hole(px, TWEETER_Y - 0.1, 0.42);
      cab.add(new THREE.Mesh(track(new THREE.ShapeGeometry(baffle, 64)), m.cabinet));
      // 穴の内側の筒 (箱の中が見えないように)
      for (const [y, r] of [
        [WOOFER_Y, WOOFER_R * 1.02],
        [TWEETER_Y, TWEETER_R * 1.02],
      ] as const) {
        const tube = new THREE.Mesh(track(new THREE.CylinderGeometry(r, r, BOX_BACK, 64, 1, true)), m.cabinet);
        tube.rotation.x = Math.PI / 2;
        tube.position.set(0, y, -BOX_BACK / 2);
        cab.add(tube);
      }
      // 前の面の縁 (金属の枠)
      for (const [x, y, w, h] of [
        [0, CAB.h / 2 - 0.12, CAB.w, 0.24],
        [0, -CAB.h / 2 + 0.12, CAB.w, 0.24],
        [-CAB.w / 2 + 0.12, 0, 0.24, CAB.h],
        [CAB.w / 2 - 0.12, 0, 0.24, CAB.h],
      ] as const) {
        put(m.metal, [x, y, 0.03], [w, h, 0.08], cab);
      }
      const woofer = new Driver(WOOFER_R, m, track);
      woofer.group.position.set(0, WOOFER_Y, 0.02);
      cab.add(woofer.group);
      this.woofers.push(woofer);
      const tweeter = new Driver(TWEETER_R, m, track, true);
      tweeter.group.position.set(0, TWEETER_Y, 0.02);
      cab.add(tweeter.group);
      this.tweeters.push(tweeter);
      // 低音の穴 (ポート) 2 つ・上の網
      for (const px of [-CAB.w * 0.3, CAB.w * 0.3]) {
        const port = new THREE.Mesh(track(new THREE.TorusGeometry(0.42, 0.06, 8, 32)), m.metal);
        port.position.set(px, TWEETER_Y - 0.1, 0.02);
        cab.add(port);
      }
      put(m.darkMetal, [0, CAB.h / 2 - 0.75, 0.01], [CAB.w * 0.7, 0.6, 0.04], cab);
      this.cabinets.push(cab);
      this.group.add(cab);
    }

    // ---- ラックの枠 (左右の柱・持ち手)
    const rackH = RACK.top - RACK.bottom;
    const rackY = (RACK.top + RACK.bottom) / 2;
    put(m.cabinet, [0, rackY, -0.9], [RACK.w, rackH, 1.6]);
    for (const sx of [-1, 1]) put(m.metal, [(sx * RACK.w) / 2 - sx * 0.14, rackY, 0.02], [0.28, rackH, 0.12]);

    /** 1 段 (パネル) を置く: 上端 y と高さ */
    const panel = (top: number, h: number): number => {
      put(m.darkMetal, [0, top - h / 2, -0.02], [RACK.w - 0.5, h - 0.06, 0.08]);
      // 持ち手
      for (const sx of [-1, 1]) {
        const handle = put(m.metal, [sx * (RACK.w / 2 - 0.55), top - h / 2, 0.14], [0.06, h * 0.6, 0.06]);
        handle.userData.handle = true;
      }
      return top - h / 2;
    };

    // 1. スペクトラム
    const specY = panel(RACK.top, 1.55);
    this.spectrum = new LedBars(SPECTRUM_BARS, SPECTRUM_SEGMENTS, { w: 0.13, h: 0.075, gapX: 0.045, gapY: 0.028 }, m.glowBasic, track, 0.8);
    this.spectrum.mesh.position.set(0, specY - 0.6, 0.06);
    this.group.add(this.spectrum.mesh);

    // 2. VU メーター 2 つと真ん中のつまみ
    const vuY = panel(RACK.top - 1.6, 1.7);
    for (const sx of [-1, 1]) {
      const vu = new VuMeter(2.3, 1.25, m, track);
      vu.group.position.set(sx * 1.72, vuY, 0.04);
      this.meters.push(vu);
      this.group.add(vu.group);
    }
    for (let i = 0; i < 4; i++) {
      const k = makeKnob(0.13, (rng() - 0.5) * 4.4, m, track);
      k.position.set(((i % 2) - 0.5) * 0.42, vuY + (i < 2 ? 0.32 : -0.32), 0.04);
      this.group.add(k);
    }

    // 3. つまみの列 (大きめ 6 つ)
    const knobY = panel(RACK.top - 3.35, 1.0);
    for (let i = 0; i < 6; i++) {
      const k = makeKnob(0.27, (rng() - 0.5) * 4.6, m, track);
      k.position.set((i - 2.5) * 0.95 + (i >= 3 ? 0.18 : -0.18), knobY, 0.04);
      this.group.add(k);
    }

    // 4. イコライザー: 左右 10 本ずつのスライダー (つまみの高さは seed で) と、上の LED、真ん中のレベルメーター 2 本
    const eqTop = RACK.top - 4.4;
    const eqY = panel(eqTop, 1.9);
    const slot = track(new THREE.BoxGeometry(0.035, 1.2, 0.02));
    for (let i = 0; i < EQ_BANDS; i++) {
      const half = i < EQ_BANDS / 2 ? -1 : 1;
      const j = i % (EQ_BANDS / 2);
      const x = half * (0.62 + j * 0.25);
      const s = new THREE.Mesh(slot, m.tick);
      s.position.set(x, eqY - 0.1, 0.03);
      this.group.add(s);
      put(m.metal, [x, eqY - 0.1 + (rng() - 0.5) * 0.9, 0.08], [0.16, 0.09, 0.08]);
    }
    this.eqLeds = new LedBars(EQ_BANDS, 1, { w: 0.08, h: 0.05, gapX: 0.17, gapY: 0 }, m.glowBasic, track, 2);
    // LED は左右 2 組 (真ん中にすき間) なので、1 本ずつ置き直す
    for (let i = 0; i < EQ_BANDS; i++) {
      const half = i < EQ_BANDS / 2 ? -1 : 1;
      const j = i % (EQ_BANDS / 2);
      this.eqLeds.mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(half * (0.62 + j * 0.25), 0, 0));
    }
    this.eqLeds.mesh.instanceMatrix.needsUpdate = true;
    this.eqLeds.mesh.position.set(0, eqY + 0.72, 0.05);
    this.group.add(this.eqLeds.mesh);
    this.levelBars = new LedBars(2, LEVEL_SEGMENTS, { w: 0.09, h: 0.06, gapX: 0.12, gapY: 0.022 }, m.glowBasic, track, 0.8);
    this.levelBars.mesh.position.set(0, eqY - 0.76, 0.05);
    this.group.add(this.levelBars.mesh);

    // 5. アンプのつまみ
    const ampY = panel(eqTop - 1.95, 1.0);
    for (let i = 0; i < 4; i++) {
      const k = makeKnob(0.25, (rng() - 0.5) * 4.4, m, track);
      k.position.set((i < 2 ? -1 : 1) * (0.9 + (i % 2) * 1.05), ampY, 0.04);
      this.group.add(k);
    }

    // 6. 真空管 2 本と左右の通気口
    const tubeTop = eqTop - 3.0;
    const tubeY = panel(tubeTop, 1.6);
    for (const sx of [-1, 1]) {
      const t = new Tube(0.2, 0.95, m, track, haloTexture);
      t.group.position.set(sx * 0.38, tubeY + 0.05, 0.3);
      this.tubes.push(t);
      this.group.add(t.group);
    }
    const slat = track(new THREE.BoxGeometry(0.07, 1.05, 0.03));
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const s = new THREE.Mesh(slat, m.cabinet);
        s.position.set(sx * (1.05 + i * 0.2), tubeY, 0.04);
        this.group.add(s);
      }
    }

    // 7. 下の網
    const baseY = panel(tubeTop - 1.65, RACK.top - RACK.bottom - (RACK.top - tubeTop + 1.65));
    for (let i = 0; i < 14; i++) put(m.cabinet, [0, baseY - 0.3 + i * 0.045, 0.03], [RACK.w - 1.2, 0.018, 0.02]);

    // 小さな LED (パネルの端の飾り。音量で少し明るくなる)
    const ledSpots: [number, number][] = [];
    for (const y of [knobY, ampY]) for (const sx of [-1, 1]) ledSpots.push([sx * 3.0, y + 0.25], [sx * 3.0, y - 0.25]);
    for (const sx of [-1, 1]) ledSpots.push([sx * 0.38, tubeY - 0.72]);
    this.smallLedCount = ledSpots.length;
    this.smallLeds = new THREE.InstancedMesh(track(new THREE.CircleGeometry(0.045, 12)), m.glowBasic, ledSpots.length);
    ledSpots.forEach(([x, y], i) => this.smallLeds.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, 0.05)));
    for (let i = 0; i < ledSpots.length; i++) this.smallLeds.setColorAt(i, this.tmp.setRGB(0, 0, 0));
    this.group.add(this.smallLeds);

    // ---- 床と、機材の足もとの灯り (横に長い帯)
    const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(60, 20)), m.cabinet);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR_Y, 4);
    this.group.add(floor);
    this.strips = track(new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }));
    for (const [x, w] of [
      [-CAB.x, CAB.w * 0.5],
      [0, RACK.w * 0.6],
      [CAB.x, CAB.w * 0.5],
    ] as const) {
      const strip = new THREE.Mesh(box, this.strips);
      strip.position.set(x, FLOOR_Y + 0.25, 0.1);
      strip.scale.set(w, 0.07, 0.02);
      this.group.add(strip);
    }
  }

  applyPalette(p: SpeakerRackPalette): void {
    this.palette.led.copy(p.led);
    this.palette.accent.copy(p.accent);
    this.palette.filament.copy(p.filament);
    this.spectrum.setColors(p.led, p.ledHot);
    this.eqLeds.setColors(p.led, p.ledHot);
    this.levelBars.setColors(p.led, p.ledHot);
    for (const vu of this.meters) vu.setColors(p.meterFace, p.ledHot);
  }

  update(a: RackAudioView): void {
    for (let i = 0; i < 2; i++) {
      this.woofers[i]!.setExcursion(a.woofer[i]!);
      this.tweeters[i]!.setExcursion(a.tweeter[i]!);
      this.meters[i]!.update(a.vu[i]!, a.dt, a.backlight);
    }
    this.spectrum.write(a.spectrum, a.spectrumPeak);
    this.eqLeds.write(a.eq);
    this.levelBars.write(a.levels);
    for (const t of this.tubes) {
      t.filament.color.copy(this.palette.filament).multiplyScalar(0.35 + 0.65 * a.tubeGlow);
      t.halo.color.copy(this.palette.filament).multiplyScalar(0.12 + 0.2 * a.tubeGlow);
    }
    for (let i = 0; i < this.smallLedCount; i++) this.smallLeds.setColorAt(i, this.tmp.copy(this.palette.led).multiplyScalar(0.25 + 0.6 * a.backlight));
    if (this.smallLeds.instanceColor) this.smallLeds.instanceColor.needsUpdate = true;
    this.strips.color.copy(this.palette.accent).multiplyScalar(0.6 + 0.8 * a.accent);
  }

  dispose(): void {
    for (const mesh of [this.spectrum.mesh, this.eqLeds.mesh, this.levelBars.mesh, this.smallLeds]) mesh.dispose();
    this.group.clear();
  }
}

export const RACK_FLOOR_Y = FLOOR_Y;
