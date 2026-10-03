import { describe, expect, it } from 'vitest';
import {
  EXPORT_SIZE_PRESETS,
  EXPORT_WARN_MB,
  EXPORT_WARN_MB_MOBILE,
  estimateExportMB,
  estimateRemainingMs,
  evenDimension,
  frameTimestamp,
  qualityLevel,
  suggestExportFileName,
  totalFrameCount,
} from './plan';

describe('evenDimension', () => {
  it('偶数はそのまま、奇数は偶数に丸める', () => {
    expect(evenDimension(1920)).toBe(1920);
    expect(evenDimension(1081)).toBe(1082);
    expect(evenDimension(1079)).toBe(1080);
  });

  it('2 未満や不正な値は 2 にする', () => {
    expect(evenDimension(0)).toBe(2);
    expect(evenDimension(-10)).toBe(2);
    expect(evenDimension(Number.NaN)).toBe(2);
  });

  it('プリセットのサイズはすべて偶数', () => {
    for (const p of EXPORT_SIZE_PRESETS) {
      expect(p.width % 2).toBe(0);
      expect(p.height % 2).toBe(0);
    }
  });
});

describe('totalFrameCount / frameTimestamp', () => {
  it('ちょうど割り切れる長さでは余分なフレームを足さない', () => {
    expect(totalFrameCount(10, 60)).toBe(600);
    expect(totalFrameCount(3, 30)).toBe(90);
  });

  it('端数がある長さでは最後のフレームを切り上げで含める', () => {
    expect(totalFrameCount(10.01, 60)).toBe(601);
  });

  it('浮動小数点誤差で 1 フレーム増えない', () => {
    // 0.1 * 3 = 0.30000000000000004 のような誤差があっても 9 フレーム (30fps で 0.3 秒)
    expect(totalFrameCount(0.1 * 3, 30)).toBe(9);
  });

  it('長さ 0 や不正な値でも最低 1 フレーム', () => {
    expect(totalFrameCount(0, 60)).toBe(1);
    expect(totalFrameCount(10, 0)).toBe(1);
  });

  it('最後のフレームの時刻は曲の長さを超えない', () => {
    const duration = 12.345;
    const fps = 60;
    const last = frameTimestamp(totalFrameCount(duration, fps) - 1, fps);
    expect(last).toBeLessThan(duration);
    expect(last).toBeGreaterThan(duration - 1 / fps - 1e-9);
  });
});

describe('qualityLevel', () => {
  it('draft/high/max を Mediabunny の品質レベルに対応させる', () => {
    expect(qualityLevel('draft')).toBe('medium');
    expect(qualityLevel('high')).toBe('high');
    expect(qualityLevel('max')).toBe('very-high');
  });
});

describe('suggestExportFileName', () => {
  it('音源の拡張子を外して プリセット名.mp4 を付ける', () => {
    expect(suggestExportFileName('my song.mp3', 'solar-gate')).toBe('my song_solar-gate.mp4');
  });

  it('ファイル名に使えない文字は _ に置き換える', () => {
    expect(suggestExportFileName('a/b:c?.wav', 'x')).toBe('a_b_c__x.mp4');
  });

  it('音源名が空でもファイル名を作れる', () => {
    expect(suggestExportFileName('', '')).toBe('zunzun_visualizer.mp4');
  });
});

describe('estimateRemainingMs', () => {
  it('経過時間と進捗から残り時間を見積もる', () => {
    expect(estimateRemainingMs(1000, 100, 400)).toBe(3000);
  });

  it('まだ進捗が無いときは null', () => {
    expect(estimateRemainingMs(0, 0, 400)).toBeNull();
    expect(estimateRemainingMs(1000, 0, 400)).toBeNull();
  });
});

describe('estimateExportMB (書き出したファイルの大きさの目安)', () => {
  it('1080p・30fps・高画質で 1 分は 90MB 前後。長さ・画素数・fps に比例し、画質で変わる', () => {
    const base = estimateExportMB(1920, 1080, 30, 60, 'high');
    expect(base).toBeGreaterThan(70);
    expect(base).toBeLessThan(110);
    expect(estimateExportMB(1920, 1080, 30, 120, 'high')).toBeCloseTo(base * 2, 5);
    expect(estimateExportMB(1920, 1080, 60, 60, 'high')).toBeGreaterThan(base * 1.8);
    expect(estimateExportMB(1280, 720, 30, 60, 'high')).toBeLessThan(base * 0.5);
    expect(estimateExportMB(1920, 1080, 30, 60, 'draft')).toBeLessThan(base);
    expect(estimateExportMB(1920, 1080, 30, 60, 'max')).toBeGreaterThan(base);
  });

  it('スマホの注意 (300MB) は、1080p・30fps・高画質なら約 3 分半の曲から。PC の注意 (1.5GB) は約 1 時間から', () => {
    const perSec = estimateExportMB(1920, 1080, 30, 1, 'high');
    expect(EXPORT_WARN_MB_MOBILE / perSec).toBeGreaterThan(180);
    expect(EXPORT_WARN_MB_MOBILE / perSec).toBeLessThan(270);
    expect(EXPORT_WARN_MB / perSec).toBeGreaterThan(1000);
    // 1280×720・30fps・軽めなら、スマホでも 10 分の曲まで注意が出ない
    expect(estimateExportMB(1280, 720, 30, 600, 'draft')).toBeLessThan(EXPORT_WARN_MB_MOBILE);
  });

  it('壊れた値は 0 (NaN にならない)', () => {
    expect(estimateExportMB(Number.NaN, 1080, 30, 60, 'high')).toBe(0);
    expect(estimateExportMB(1920, 1080, 0, 60, 'high')).toBe(0);
    expect(estimateExportMB(1920, 1080, 30, -1, 'high')).toBe(0);
  });
});

