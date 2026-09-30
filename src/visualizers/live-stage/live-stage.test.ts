import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/random';
import { defaultCommonParams, type AudioFrame, type CommonParams } from '../../core/types';
import { CAMERA_SPOTS, hazeYaw, LiveStagePreset, MAX_STROBE_HZ, PHRASE_BEATS, WASH_MAX, WASH_MIN_INTERVAL } from './preset';

/**
 * WebGL を使わずに (three.js のシーングラフだけで) Live Stage を動かし、
 * 反応設計どおりに数値が動くか・ストロボが上限を超えないか・同じ seed なら同じ演出になるかを確かめる。
 */

const fakeRenderer = { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer;
type Params = CommonParams & Record<string, unknown>;
const params = (o: Partial<CommonParams> = {}): Params => ({ ...defaultCommonParams(), ...o }) as Params;

function makePreset(seed = 42, p: Params = params()): LiveStagePreset {
  const preset = new LiveStagePreset();
  preset.init({ renderer: fakeRenderer, width: 1280, height: 720, seed, params: p, rng: makeRng(seed) });
  return preset;
}

function frame(t: number, o: Partial<AudioFrame> = {}): AudioFrame {
  return {
    t,
    dt: 1 / 60,
    bass: 0,
    mid: 0,
    high: 0,
    rms: 0,
    peak: 0,
    beat: 0,
    beatIndex: -1,
    spectralEnergy: 0,
    flux: 0,
    bands: new Float32Array(64),
    ...o,
  };
}

function run(preset: LiveStagePreset, frames: number, o: (i: number) => Partial<AudioFrame>, p: Params = params()): void {
  for (let i = 0; i < frames; i++) preset.update(frame(i / 60, o(i)), p);
}

/** 120 BPM 相当: 30 フレームごとに新しいビート */
const beats = (i: number): Partial<AudioFrame> => ({ beatIndex: Math.floor(i / 30), beat: Math.exp(-(i % 30) / 10) });

/** ライトの向き (leanX × 8, leanZ × 8) だけを取り出す */
const aim = (p: LiveStagePreset): number[] => p.stageSnapshot().slice(0, 16);
const distance = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0);

describe('LiveStagePreset', () => {
  it('bass が強いほどスモークが濃くなる', () => {
    const dry = makePreset();
    const smoky = makePreset();
    run(dry, 60, () => ({ bass: 0 }));
    run(smoky, 60, () => ({ bass: 1 }));
    expect(smoky.inspect().smoke).toBeGreaterThan(0.8);
    expect(smoky.inspect().beamDensity).toBeGreaterThan(dry.inspect().beamDensity + 0.6);
  });

  it('スモークは bass が止むとゆっくり薄くなる', () => {
    const p = makePreset();
    run(p, 60, () => ({ bass: 1 }));
    const peak = p.inspect().smoke;
    run(p, 10, () => ({ bass: 0 }));
    const soon = p.inspect().smoke;
    expect(soon).toBeLessThan(peak);
    expect(soon).toBeGreaterThan(peak * 0.7);
  });

  it('high が無ければレーザーは出ず、high が強いと点滅する', () => {
    const calm = makePreset();
    const bright = makePreset();
    let calmMax = 0;
    let brightMax = 0;
    for (let i = 0; i < 300; i++) {
      calm.update(frame(i / 60, { high: 0 }), params());
      bright.update(frame(i / 60, { high: 1 }), params());
      calmMax = Math.max(calmMax, calm.inspect().lasersVisible);
      brightMax = Math.max(brightMax, bright.inspect().lasersVisible);
    }
    expect(calmMax).toBe(0);
    expect(brightMax).toBeGreaterThan(0);
    expect(bright.inspect().laserFlashes).toBeGreaterThan(5);
  });

  it(`レーザーの点灯は high が激しく揺れても毎秒 ${MAX_STROBE_HZ} 回を超えない`, () => {
    const p = makePreset();
    let onsets = 0;
    let wasOn = false;
    const seconds = 10;
    for (let i = 0; i < seconds * 60; i++) {
      // しきい値をまたいで毎フレーム揺れる high
      p.update(frame(i / 60, { high: i % 2 === 0 ? 1 : 0 }), params({ sensitivity: 1 }));
      const on = p.inspect().lasersVisible > 0;
      if (on && !wasOn) onsets++;
      wasOn = on;
    }
    expect(onsets).toBeGreaterThan(0);
    expect(onsets).toBeLessThanOrEqual(MAX_STROBE_HZ * seconds);
  });

  it('ビートでライトが振られ、ビートが無ければゆっくり動くだけ', () => {
    const rhythmic = makePreset();
    const idle = makePreset();
    const moves: number[] = [];
    const idleMoves: number[] = [];
    for (let beat = 0; beat < 6; beat++) {
      const before = aim(rhythmic);
      const idleBefore = aim(idle);
      for (let f = 0; f < 30; f++) {
        const i = beat * 30 + f;
        rhythmic.update(frame(i / 60, beats(i)), params());
        idle.update(frame(i / 60, {}), params());
      }
      moves.push(distance(before, aim(rhythmic)));
      idleMoves.push(distance(idleBefore, aim(idle)));
    }
    const avg = (v: number[]): number => v.slice(1).reduce((s, x) => s + x, 0) / (v.length - 1);
    expect(avg(moves)).toBeGreaterThan(avg(idleMoves) * 3);
  });

  it(`パターンは ${PHRASE_BEATS} ビートごとに切り替わり、直前と同じにはならない`, () => {
    const p = makePreset(5);
    const seen: string[] = [p.inspect().pattern];
    for (let i = 0; i < 30 * PHRASE_BEATS * 4; i++) {
      p.update(frame(i / 60, beats(i)), params());
      const now = p.inspect().pattern;
      if (now !== seen[seen.length - 1]) seen.push(now);
    }
    // 0..31 ビート → 8, 16, 24 ビート目で 3 回切り替わる
    expect(p.inspect().patternChanges).toBe(3);
    expect(seen.length).toBe(4);
  });

  it('Intensity が高いほど光の筋が明るく、スモークも濃い', () => {
    const low = makePreset();
    const high = makePreset();
    run(low, 60, (i) => ({ ...beats(i), bass: 0.8 }), params({ intensity: 0.1 }));
    run(high, 60, (i) => ({ ...beats(i), bass: 0.8 }), params({ intensity: 1 }));
    expect(high.inspect().beamStrength).toBeGreaterThan(low.inspect().beamStrength * 1.5);
    expect(high.inspect().beamDensity).toBeGreaterThan(low.inspect().beamDensity);
  });

  it('同じ seed・同じ音声なら照明の動きが完全に一致し、seed が違えば変わる (書き出しの再現性)', () => {
    const drive = (i: number): Partial<AudioFrame> => ({ ...beats(i), high: (i % 90) / 90, bass: 0.5 });
    const a = makePreset(7);
    const b = makePreset(7);
    const c = makePreset(8);
    run(a, 1000, drive);
    run(b, 1000, drive);
    run(c, 1000, drive);
    expect(a.stageSnapshot()).toEqual(b.stageSnapshot());
    expect(a.stageSnapshot()).not.toEqual(c.stageSnapshot());
  });

  it('dt=0 や極端な dt・値でも NaN にならない', () => {
    const p = makePreset();
    p.update(frame(0, { dt: 0, bass: 1, high: 1 }), params());
    p.update(frame(1, { dt: 9, beat: 1, beatIndex: 2, high: 1 }), params());
    p.update(frame(2, { dt: Number.NaN, beat: 1, beatIndex: Number.NaN }), params());
    p.update(frame(3, { beatIndex: 1e9, bass: Number.NaN }), params({ intensity: Number.NaN }));
    const s = p.inspect();
    for (const v of [s.smoke, s.beamDensity, s.beamStrength]) expect(Number.isFinite(v)).toBe(true);
    expect(p.stageSnapshot().every((v) => Number.isFinite(v))).toBe(true);
  });

  it('縦長への resize・テーマ切り替え・dispose で落ちない', () => {
    const p = makePreset();
    p.resize(1080, 1920);
    for (const theme of ['gold', 'ice', 'neon', 'mono', 'unknown-theme', 'default']) {
      run(p, 2, (i) => ({ ...beats(i), high: 1 }), params({ colorTheme: theme }));
    }
    expect(p.stageSnapshot().every((v) => Number.isFinite(v))).toBe(true);
    expect(() => p.dispose()).not.toThrow();
  });
});

describe('カメラ (このプリセットだけの設定)', () => {
  const still = (o: Record<string, unknown> = {}): Params => ({ ...params({ cameraMotion: 0 }), ...o }) as Params;

  it('設定が無ければ今までどおり客席の後ろ (0, 2, 12)。場所を選ぶとそこへ動く', () => {
    const p = makePreset(1, still());
    p.update(frame(0), still());
    expect(p.camera.position.toArray()).toEqual([0, 2, 12]);
    for (const spot of ['front', 'side', 'top', 'stage'] as const) {
      p.update(frame(0), still({ cameraSpot: spot }));
      expect(p.camera.position.distanceTo(CAMERA_SPOTS[spot].pos), spot).toBeLessThan(1e-9);
    }
    // 最前列は低く (見上げる)、上からは高い
    p.update(frame(0), still({ cameraSpot: 'front' }));
    const front = p.camera.position.y;
    p.update(frame(0), still({ cameraSpot: 'top' }));
    expect(p.camera.position.y).toBeGreaterThan(front + 5);
    p.dispose();
  });

  it('高さ・距離・左右の向きが効き、見る点は変わらない。壊れた値は既定、床の下には行かない', () => {
    const p = makePreset(1, still());
    p.update(frame(0), still({ cameraHeight: 1 }));
    expect(p.camera.position.y).toBeCloseTo(5, 5);
    p.update(frame(0), still({ cameraDistance: 0.5 }));
    expect(p.camera.position.z).toBeCloseTo(-3 + 15 * 0.5, 5);
    p.update(frame(0), still({ cameraYaw: 1 }));
    expect(p.camera.position.x).toBeGreaterThan(5);
    p.update(frame(0), still({ cameraSpot: 'front', cameraHeight: -1 }));
    expect(p.camera.position.y).toBeGreaterThanOrEqual(0.3);
    p.update(frame(0), still({ cameraSpot: 'nowhere', cameraHeight: NaN, cameraYaw: 'x' }));
    expect(p.camera.position.toArray()).toEqual([0, 2, 12]);
    p.dispose();
  });

  it('スモークの板はカメラの方へ回る: 客席の後ろ・ステージの奥からは今までどおり、真横からは正面寄りに見える', () => {
    const p = makePreset(1, still());
    const hazeNormals = (): THREE.Vector3[] => {
      const out: THREE.Vector3[] = [];
      p.scene.updateMatrixWorld(true);
      p.scene.traverse((o) => {
        if (o instanceof THREE.Mesh && (o.material as THREE.ShaderMaterial).name === 'LiveStageHaze') out.push(new THREE.Vector3(0, 0, 1).transformDirection(o.matrixWorld));
      });
      return out;
    };
    // 板の法線と、カメラから見る点への向き (水平) のなす角の cos の大きさ (1 = 正面、0 = 真横から)
    const facing = (): number => {
      const view = new THREE.Vector3();
      p.camera.getWorldDirection(view);
      view.y = 0;
      view.normalize();
      return Math.min(...hazeNormals().map((n) => Math.abs(n.dot(view))));
    };
    for (const spot of ['back', 'stage', 'top'] as const) {
      p.update(frame(0), still({ cameraSpot: spot }));
      expect(hazeNormals().length).toBe(4);
      for (const n of hazeNormals()) expect(n.distanceTo(new THREE.Vector3(0, 0, 1)), spot).toBeLessThan(1e-12);
    }
    // 真横・左右に回したカメラからも、板をほぼ正面から見る
    p.update(frame(0), still({ cameraSpot: 'side' }));
    expect(facing()).toBeGreaterThan(0.95);
    p.update(frame(0), still({ cameraYaw: 1 }));
    expect(facing()).toBeGreaterThan(0.95);
    expect(hazeYaw(0, -5)).toBe(0);
    expect(hazeYaw(5, -5)).toBeCloseTo(-Math.PI / 4, 12);
    expect(Math.abs(hazeYaw(5, 0.0001))).toBeLessThanOrEqual(Math.PI / 2);
    p.dispose();
  });
});

describe('光を客席へ向ける (towardCrowd)', () => {
  const crowd = (v: number, o: Record<string, unknown> = {}): Params => ({ ...params(), towardCrowd: v, ...o }) as Params;

  it('0 (既定) なら今までどおり: 客席側へ傾ける量は MAX_LEAN_Z まで、画面は明るくしない', () => {
    const p = makePreset(3, crowd(0));
    let maxLean = 0;
    for (let i = 0; i < 600; i++) {
      p.update(frame(i / 60, beats(i)), crowd(0));
      maxLean = Math.max(maxLean, ...p.stageSnapshot().slice(8, 16));
      expect(p.inspect().wash).toBe(0);
    }
    expect(maxLean).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(p.inspect().washRises).toBe(0);
    p.dispose();
  });

  it('上げると、ライトがカメラを向く瞬間があり、画面が一瞬明るくなる。明るくなるのは WASH_MIN_INTERVAL 秒おき以上、WASH_MAX まで', () => {
    const p = makePreset(3, crowd(1));
    const rises: number[] = [];
    let last = 0;
    let maxHit = 0;
    for (let i = 0; i < 1200; i++) {
      const t = i / 60;
      p.update(frame(t, beats(i)), crowd(1));
      const s = p.inspect();
      maxHit = Math.max(maxHit, s.maxHit);
      expect(s.wash).toBeLessThanOrEqual(WASH_MAX + 1e-9);
      if (s.washRises > last) rises.push(t);
      last = s.washRises;
    }
    expect(maxHit).toBeGreaterThan(0.8);
    expect(rises.length).toBeGreaterThan(2);
    for (let k = 1; k < rises.length; k++) expect(rises[k]! - rises[k - 1]!).toBeGreaterThanOrEqual(WASH_MIN_INTERVAL - 1 / 60 - 1e-9);
    // 1 秒あたり、光過敏のガイドラインの上限 (3 回) よりずっと少ない
    expect(rises.length / 20).toBeLessThanOrEqual(1 / WASH_MIN_INTERVAL + 1e-9);
    p.dispose();
  });

  it('同じ seed なら同じ演出 (光を客席へ向けても)', () => {
    const a = makePreset(9, crowd(0.7));
    const b = makePreset(9, crowd(0.7));
    for (let i = 0; i < 300; i++) {
      a.update(frame(i / 60, beats(i)), crowd(0.7));
      b.update(frame(i / 60, beats(i)), crowd(0.7));
    }
    expect(a.stageSnapshot()).toEqual(b.stageSnapshot());
    expect(a.inspect()).toEqual(b.inspect());
    a.dispose();
    b.dispose();
  });
});

describe('ステージの機材 (stageSet)', () => {
  const named = (p: LiveStagePreset, name: string): THREE.Object3D[] => {
    const out: THREE.Object3D[] = [];
    p.scene.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material as THREE.Material).name === name) out.push(o);
    });
    return out;
  };
  /** 実際に画面に出るか (親まで含めて visible か) */
  const shown = (o: THREE.Object3D): boolean => {
    for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
    return true;
  };

  it('既定 (なし) は何も出さない。バンドにするとトラス・幕・台が出て、今までの横棒は隠れる。壊れた値はなし', () => {
    const p = makePreset(1);
    p.update(frame(0), params());
    expect(p.inspect().stageSet).toBe('none');
    expect(named(p, 'LiveStageDrape').some(shown)).toBe(false);
    p.update(frame(0), params({ stageSet: 'band' } as never));
    expect(p.inspect().stageSet).toBe('band');
    const drapes = named(p, 'LiveStageDrape');
    expect(drapes.length).toBe(2);
    expect(drapes.every(shown)).toBe(true);
    p.update(frame(0), params({ stageSet: 'rocket' } as never));
    expect(p.inspect().stageSet).toBe('none');
    expect(drapes.some(shown)).toBe(false);
    p.dispose();
  });

  it('機材を置いても照明の動きは同じ (seed の乱数を使わない)', () => {
    const a = makePreset(7);
    const b = makePreset(7, params({ stageSet: 'band' } as never));
    run(a, 600, beats, params({ high: 1 }));
    run(b, 600, beats, params({ high: 1, stageSet: 'band' } as never));
    expect(b.stageSnapshot()).toEqual(a.stageSnapshot());
    expect(b.inspect().pattern).toBe(a.inspect().pattern);
    a.dispose();
    b.dispose();
  });

  type Gear = { kickPush: number; conePush: number; ledsLit: number; sparkle: number; drumsVisible: boolean; backLights: number; lightLevel: number };
  const gearOf = (p: LiveStagePreset): Gear => (p as unknown as { stageSet: { inspect(): { gear: Gear } } }).stageSet.inspect().gear;
  const band = (o: Partial<CommonParams> & Record<string, unknown> = {}): Params => params({ stageSet: 'band', ...o } as never);

  it('機材は音で動く: bass でバスドラムの面とコーンが押し出され、high でシンバルが光り、音量で LED が伸びる。音が無ければ止まる', () => {
    const p = makePreset(5, band());
    run(p, 60, () => ({}), band());
    const quiet = gearOf(p);
    expect(quiet.kickPush).toBeLessThan(1e-6);
    expect(quiet.conePush).toBeLessThan(1e-6);
    expect(quiet.ledsLit).toBe(0);
    expect(quiet.sparkle).toBeLessThan(1e-6);
    run(p, 20, () => ({ bass: 1, high: 1, rms: 0.8 }), band());
    const loud = gearOf(p);
    expect(loud.kickPush).toBeGreaterThan(0.03);
    expect(loud.conePush).toBeGreaterThan(0.02);
    expect(loud.ledsLit).toBeGreaterThanOrEqual(6);
    expect(loud.sparkle).toBeGreaterThan(0.4);
    // 音が止むと戻る
    run(p, 120, () => ({}), band());
    expect(gearOf(p).kickPush).toBeLessThan(0.002);
    expect(gearOf(p).ledsLit).toBe(0);
    // Intensity 0 なら動かない
    run(p, 30, () => ({ bass: 1, high: 1 }), band({ intensity: 0 }));
    expect(gearOf(p).kickPush).toBeLessThan(0.002);
    p.dispose();
  });

  it('機材の後ろの床の灯りは beat で少しだけ強まる (0.7〜1.0 倍。光過敏への配慮で幅は控えめ)', () => {
    const p = makePreset(5, band());
    run(p, 60, () => ({}), band());
    const calm = gearOf(p);
    expect(calm.backLights).toBe(4);
    run(p, 10, () => ({ beat: 1 }), band());
    const hit = gearOf(p);
    expect(hit.lightLevel).toBeGreaterThan(calm.lightLevel);
    expect(hit.lightLevel / calm.lightLevel).toBeLessThanOrEqual(1 / 0.7 + 1e-9);
    p.dispose();
  });

  it('アップライト (奥の壁ぎわの 6 台) は機材があるときだけ出て、beat で 0.75〜1.0 倍だけ強まる。Intensity が低いと弱い', () => {
    const upOf = (p: LiveStagePreset): { count: number; level: number } =>
      (p as unknown as { stageSet: { inspect(): { uplights: { count: number; level: number } } } }).stageSet.inspect().uplights;
    const none = makePreset(5);
    expect(named(none, 'LiveStageUplight').some(shown)).toBe(false);
    none.dispose();
    const p = makePreset(5, band());
    run(p, 60, () => ({}), band());
    expect(named(p, 'LiveStageUplight').filter(shown).length).toBe(6);
    expect(named(p, 'LiveStageWallWash').filter(shown).length).toBe(6);
    const calm = upOf(p).level;
    run(p, 10, () => ({ beat: 1 }), band());
    const hit = upOf(p).level;
    expect(hit).toBeGreaterThan(calm);
    expect(hit / calm).toBeLessThanOrEqual(1 / 0.75 + 1e-9);
    run(p, 60, () => ({}), band({ intensity: 0.1 }));
    expect(upOf(p).level).toBeLessThan(calm);
    p.update(frame(0, { beat: NaN }), band({ intensity: NaN }));
    expect(Number.isFinite(upOf(p).level)).toBe(true);
    p.dispose();
  });

  it('ステージの奥からのカメラではドラムを隠す (シンバルが目の前を覆わない)。ほかの場所では見える', () => {
    const p = makePreset(5, band());
    for (const spot of ['back', 'front', 'side', 'top'] as const) {
      p.update(frame(0), band({ cameraSpot: spot, cameraMotion: 0 }));
      expect(gearOf(p).drumsVisible, spot).toBe(true);
    }
    p.update(frame(0), band({ cameraSpot: 'stage', cameraMotion: 0 }));
    expect(gearOf(p).drumsVisible).toBe(false);
    p.dispose();
  });

  it('縦長にすると幕が内側へ寄るが、トラスの部材の数は変わらない。dispose で落ちない', () => {
    const p = makePreset(3, params({ stageSet: 'band' } as never));
    p.update(frame(0), params({ stageSet: 'band' } as never));
    const set = (p as unknown as { stageSet: { inspect(): { trussParts: number; drapeX: number[]; riserTop: number } } }).stageSet;
    const wide = set.inspect();
    expect(wide.trussParts).toBeGreaterThan(100);
    expect(wide.drapeX[0]).toBeCloseTo(-wide.drapeX[1]!, 9);
    expect(wide.riserTop).toBeGreaterThan(0);
    p.resize(720, 1280);
    const tall = set.inspect();
    expect(tall.trussParts).toBe(wide.trussParts);
    expect(Math.abs(tall.drapeX[1]!)).toBeLessThan(Math.abs(wide.drapeX[1]!));
    p.update(frame(0, { bass: NaN }), params({ stageSet: 'band', intensity: NaN } as never));
    expect(() => p.dispose()).not.toThrow();
  });
});
