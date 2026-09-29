import { describe, expect, it } from 'vitest';
import { analyzeSamples, FINE_RATE, fineEnvelope } from '../audio/analyze';
import { barSnapTargetsFor } from '../rhythm/targets';
import { refineOnsetTimes } from './candidates';
import { syncTargetsFor } from './view';

/**
 * 吸着先 (歌い出し候補・小節の頭の候補) の時刻が、実際の出だしとずれないこと。
 * 解析の特徴量は約 46ms の窓の真ん中を時刻にするため、合わせ直す前はキック・クリックで約 30ms、立ち上がりの速い声で
 * 約 13ms 早く出ていた (R2 で小節の頭が 1.75 → 1.7167 秒になって気づいた)。refineOnsetTimes で合わせ直した結果を確かめる。
 */

type Kind = 'kick' | 'click' | 'voiceFast' | 'voiceSlow';
const SR = 44100;

/** 決まった時刻に音を鳴らす。伴奏あり (accomp) なら、ずらしたキックと雑音を重ねる。乱数は固定の式 */
function synth(kind: Kind, truth: number[], secs: number, accomp = false): Float32Array {
  const x = new Float32Array(SR * secs);
  let seed = 12345;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  if (accomp) for (let i = 0; i < x.length; i++) x[i] = 0.03 * rnd();
  const add = (t0: number, len: number, f: (d: number) => number): void => {
    const i0 = Math.round(t0 * SR);
    for (let i = 0; i < len * SR && i0 + i < x.length; i++) x[i0 + i]! += f(i / SR);
  };
  for (const t0 of truth) {
    if (kind === 'kick') add(t0, 0.3, (d) => 0.9 * Math.exp(-d * 18) * Math.sin(2 * Math.PI * 60 * d));
    if (kind === 'click') add(t0, 0.3, (d) => (d < 20 / SR ? 0.9 : 0) + 0.3 * Math.exp(-d * 60) * Math.sin(2 * Math.PI * 2000 * d));
    if (kind === 'voiceFast' || kind === 'voiceSlow') {
      const attack = kind === 'voiceFast' ? 0.01 : 0.06;
      add(t0, 0.6, (d) => 0.4 * Math.min(1, d / attack) * (Math.sin(2 * Math.PI * 440 * d) + 0.5 * Math.sin(2 * Math.PI * 880 * d)));
    }
  }
  if (accomp) for (let t0 = 0.73; t0 < secs - 0.5; t0 += 0.5) add(t0, 0.3, (d) => 0.8 * Math.exp(-d * 18) * Math.sin(2 * Math.PI * 60 * d) + 0.2 * Math.exp(-d * 40) * rnd());
  return x;
}

/** 本当の出だしごとに、いちばん近い候補とのずれ (100ms より離れていたら見つからなかったとして NaN) */
function errors(found: readonly number[], truth: readonly number[]): number[] {
  return truth.map((t) => {
    let best = Infinity;
    for (const f of found) if (Math.abs(f - t) < Math.abs(best)) best = f - t;
    return Math.abs(best) <= 0.1 ? best : NaN;
  });
}

/**
 * 見つかった候補のずれが、平均 meanMs 以内・最大 10ms 以内。見つかる割合も確かめる
 * (極端に短いクリックは、フレームとの位置関係で候補の強さが大きく変わり、弱いものが足切りで落ちることがある。
 * これは候補を拾う処理の前からの動きで、時刻の合わせ直しとは別)
 */
function expectOnTime(errs: number[], meanMs = 5, minFound = 1): void {
  const found = errs.filter((e) => Number.isFinite(e));
  expect(found.length / errs.length).toBeGreaterThanOrEqual(minFound);
  const mean = found.reduce((a, b) => a + b, 0) / found.length;
  expect(Math.abs(mean)).toBeLessThan(meanMs / 1000);
  for (const e of found) expect(Math.abs(e)).toBeLessThan(0.01);
}

describe('吸着先の時刻 (合成音)', () => {
  // フレームの間のどこにあっても測れるように、端数 (0〜14ms) をずらす
  const truthEvery = (gap: number, n: number) => Array.from({ length: n }, (_, i) => 1 + i * gap + (i % 7) * 0.00238);

  it('打楽器 (キック・クリック): 小節の頭の候補が ±5ms (平均)・±10ms (最大) で出だしに合う', () => {
    for (const kind of ['kick', 'click'] as const) {
      const truth = truthEvery(0.5, 12);
      const a = analyzeSamples(synth(kind, truth, 8), SR);
      expectOnTime(errors(barSnapTargetsFor(a).candidates, truth), 5, kind === 'click' ? 0.8 : 1);
    }
  });

  it('声 (立ち上がり 10ms / 60ms、伴奏と雑音あり・なし): 歌い出し候補が ±5ms (平均、雑音の中のゆっくりした声は ±8ms)・±10ms (最大) で出だしに合う', () => {
    for (const kind of ['voiceFast', 'voiceSlow'] as const) {
      for (const accomp of [false, true]) {
        const truth = truthEvery(1, 8);
        const a = analyzeSamples(synth(kind, truth, 10, accomp), SR);
        // 雑音の中のゆっくりした声は、立ち上がりの最初が雑音に埋もれるので +7ms ほど遅めに出る
        expectOnTime(errors(syncTargetsFor(a).candidates, truth), kind === 'voiceSlow' && accomp ? 8 : 5);
      }
    }
  });
});

describe('refineOnsetTimes / fineEnvelope', () => {
  it('細かい音量が無い・範囲の中で増えていなければ、元の時刻のまま', () => {
    const items = [{ t: 1, strength: 0.5 }];
    expect(refineOnsetTimes(items, undefined, 0)).toEqual(items);
    expect(refineOnsetTimes(items, new Float32Array(400).fill(0.2), 200)).toEqual(items);
  });

  it('範囲の中の最初の立ち上がりに合わせ、強さはそのまま、時刻の順に並べる', () => {
    const env = new Float32Array(600);
    env.fill(0.5, 206, 300); // 1.03 秒から大きくなる
    env.fill(0.5, 402, 500); // 2.01 秒から
    const out = refineOnsetTimes([{ t: 2, strength: 0.3 }, { t: 1, strength: 0.9 }], env, 200);
    expect(out).toEqual([{ t: 1.03, strength: 0.9 }, { t: 2.01, strength: 0.3 }]);
  });

  it('fineEnvelope: 5ms ごとの RMS。rate は区間の長さ (サンプル数) から決まる', () => {
    const x = new Float32Array(SR);
    x.fill(0.5, SR / 2);
    const f = fineEnvelope(x, SR);
    expect(f.rate).toBeCloseTo(FINE_RATE, 0);
    expect(f.energy.length).toBe(Math.ceil(SR / Math.round(SR / FINE_RATE)));
    expect(f.energy[10]).toBe(0);
    expect(f.energy[f.energy.length - 2]).toBeCloseTo(0.5);
    // 直流は歌声の帯域 (300Hz〜) には入らない
    expect(f.vocal[f.vocal.length - 2]!).toBeLessThan(0.01);
  });
});
