import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultLyrics, type LyricsSettings } from '../types';
import { LyricMotion } from './jizura-adapter';
import { LyricMotionProvider, motionKey, wantsMotion, type MotionRequest } from './motion-provider';

const lyrics = (o: Partial<LyricsSettings> = {}): LyricsSettings => ({ ...defaultLyrics(), text: 'あ\nい', ...o });
const req = (o: Partial<MotionRequest> = {}): MotionRequest => ({
  lyrics: lyrics(),
  analysis: null,
  projectSeed: 1,
  width: 1920,
  height: 1080,
  fps: 30,
  ...o,
});

/** 本物の JIZURA を読み込まないように、LyricMotion.create を差し替える */
function stubCreate(): { calls: number; resolveAll: () => Promise<void> } {
  const pending: (() => void)[] = [];
  const state = {
    calls: 0,
    resolveAll: async () => {
      while (pending.length) pending.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
  vi.spyOn(LyricMotion, 'create').mockImplementation(() => {
    state.calls++;
    const n = state.calls;
    return new Promise((resolve) => pending.push(() => resolve({ id: n } as unknown as LyricMotion)));
  });
  return state;
}

afterEach(() => vi.restoreAllMocks());

describe('wantsMotion / motionKey', () => {
  it('歌詞が無い・空・オフのときは出さない', () => {
    expect(wantsMotion(req({ lyrics: null }))).toBe(false);
    expect(wantsMotion(req({ lyrics: lyrics({ text: '  \n ' }) }))).toBe(false);
    expect(wantsMotion(req({ lyrics: lyrics({ motion: { ...defaultLyrics().motion, enabled: false } }) }))).toBe(false);
    expect(wantsMotion(req())).toBe(true);
  });

  it('比率が同じ書き出しサイズどうしは同じキー、比率・時刻・スタイルが変わればキーも変わる', () => {
    const a = req() as MotionRequest & { lyrics: LyricsSettings };
    expect(motionKey({ ...a, width: 1280, height: 720 })).toBe(motionKey(a));
    expect(motionKey({ ...a, width: 1080, height: 1920 })).not.toBe(motionKey(a));
    const moved = { ...a, lyrics: lyrics({ timing: { ...defaultLyrics().timing, lineTimes: { '0': 1 } } }) };
    expect(motionKey(moved)).not.toBe(motionKey(a));
    const styled = { ...a, lyrics: lyrics({ motion: { ...defaultLyrics().motion, style: 'crimson' } }) };
    expect(motionKey(styled)).not.toBe(motionKey(a));
  });
});

describe('変拍子 (R3) と作り直し', () => {
  const rhythm = { enabled: true, bars: [1, 2.75, 4.5], meters: [{ bar: 0, pattern: '2+2+3' }] };

  it('変拍子モードがオンの間は、小節・拍子が変わるとキーも変わる。オフの間は変わらない', () => {
    const a = req({ rhythm }) as MotionRequest & { lyrics: LyricsSettings };
    expect(motionKey(a)).not.toBe(motionKey({ ...a, rhythm: null }));
    expect(motionKey({ ...a, rhythm: { ...rhythm, bars: [1, 2.7, 4.5] } })).not.toBe(motionKey(a));
    expect(motionKey({ ...a, rhythm: { ...rhythm, meters: [{ bar: 0, pattern: '3+2+2' }] } })).not.toBe(motionKey(a));
    const off = { ...a, rhythm: { ...rhythm, enabled: false } };
    expect(motionKey({ ...off, rhythm: { ...off.rhythm, bars: [9] } })).toBe(motionKey(off));
    expect(motionKey(off)).toBe(motionKey({ ...a, rhythm: null }));
  });

  it('変拍子モードなら、拍子から作った拍をビートにして、小節の並びと一緒に create へ渡す', async () => {
    const spy = vi.spyOn(LyricMotion, 'create').mockResolvedValue({} as LyricMotion);
    let now = 0;
    const p = new LyricMotionProvider(() => now);
    const analysis = { duration: 10, beats: [0.5, 1], rms: new Float32Array(4), frameRate: 60 } as unknown as MotionRequest['analysis'];
    p.get(req({ rhythm, analysis }));
    now = 400;
    p.get(req({ rhythm, analysis }));
    await new Promise((r) => setTimeout(r, 0));
    const [, audio, opts] = spy.mock.calls[0]!;
    expect(audio!.beats.slice(0, 4)).toEqual([1, 1.5, 2, 2.75]);
    expect(opts.rhythm!.accents).toEqual([1, 2.75, 4.5]);
  });
});

describe('背景の色と作り直し', () => {
  const palette = { dark: '#101830', light: '#f4e8d0', accent: '#d06a30', accent2: '#3050a0' };
  it('背景の色を使うスタイル (余白) のときだけ、背景の色が変わるとキーも変わる', () => {
    const cinema = req({ lyrics: lyrics({ motion: { ...defaultLyrics().motion, style: 'zz-cinema' } }) }) as MotionRequest & { lyrics: LyricsSettings };
    expect(motionKey({ ...cinema, palette })).not.toBe(motionKey(cinema));
    const noir = req() as MotionRequest & { lyrics: LyricsSettings };
    expect(motionKey({ ...noir, palette })).toBe(motionKey(noir));
  });
});

describe('LyricMotionProvider', () => {
  it('設定が落ち着いてから (350ms) 作り、同じ設定の間は作り直さない', async () => {
    const stub = stubCreate();
    let now = 0;
    const p = new LyricMotionProvider(() => now);
    expect(p.get(req())).toBeNull();
    now = 100;
    p.get(req());
    expect(stub.calls).toBe(0);
    now = 400;
    p.get(req());
    expect(stub.calls).toBe(1);
    await stub.resolveAll();
    const m = p.get(req());
    expect(m).toEqual({ id: 1 });
    now = 5000;
    expect(p.get(req())).toBe(m);
    expect(stub.calls).toBe(1);
  });

  it('作り直している間はひとつ前のものを返し続け、できたら差し替える', async () => {
    const stub = stubCreate();
    let now = 0;
    const p = new LyricMotionProvider(() => now);
    p.get(req());
    now = 400;
    p.get(req());
    await stub.resolveAll();
    const first = p.get(req());
    const changed = req({ lyrics: lyrics({ text: 'う' }) });
    expect(p.get(changed)).toBe(first);
    now = 800;
    expect(p.get(changed)).toBe(first);
    expect(p.isBuilding).toBe(true);
    await stub.resolveAll();
    expect(p.get(changed)).toEqual({ id: 2 });
    expect(p.isBuilding).toBe(false);
  });

  it('作るのに失敗したら null とエラーを返し、同じ設定では作り直さない', async () => {
    vi.spyOn(LyricMotion, 'create').mockRejectedValue(new Error('boom'));
    let now = 0;
    const p = new LyricMotionProvider(() => now);
    p.get(req());
    now = 400;
    p.get(req());
    await new Promise((r) => setTimeout(r, 0));
    expect(p.get(req())).toBeNull();
    expect(p.lastError).toBe('boom');
    now = 2000;
    p.get(req());
    expect(LyricMotion.create).toHaveBeenCalledTimes(1);
  });

  it('時刻だけの変更 (タイムラインで合わせているとき) は、手を止めて 1.5 秒たってから 1 回だけ作り直す', async () => {
    const stub = stubCreate();
    let now = 0;
    const p = new LyricMotionProvider(() => now);
    p.get(req());
    now = 400;
    p.get(req());
    await stub.resolveAll();
    expect(stub.calls).toBe(1);
    const moved = (t: number): MotionRequest => req({ lyrics: lyrics({ timing: { ...defaultLyrics().timing, lineTimes: { '0': t } } }) });
    // 少しずつ何度も動かす (0.5 秒ごと) 間は作り直さない
    for (let k = 1; k <= 6; k++) {
      now = 400 + k * 500;
      p.get(moved(k * 0.1));
      now += 400;
      p.get(moved(k * 0.1));
    }
    expect(stub.calls).toBe(1);
    // 手を止めて 1.5 秒たったら作り直す
    now += 900;
    p.get(moved(6 * 0.1));
    expect(stub.calls).toBe(1);
    now += 300;
    p.get(moved(6 * 0.1));
    expect(stub.calls).toBe(2);
    await stub.resolveAll();
    // 時刻以外 (文字) の変更は今までどおり 350ms
    const t0 = now;
    p.get(req({ lyrics: lyrics({ text: 'え', timing: { ...defaultLyrics().timing, lineTimes: { '0': 0.6 } } }) }));
    now = t0 + 400;
    p.get(req({ lyrics: lyrics({ text: 'え', timing: { ...defaultLyrics().timing, lineTimes: { '0': 0.6 } } }) }));
    expect(stub.calls).toBe(3);
  });
});
