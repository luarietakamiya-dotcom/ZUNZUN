import { describe, expect, it } from 'vitest';
import { formatTime, parseTimeInput } from './time-format';

describe('formatTime', () => {
  it('分:秒.1/100 秒で表す', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(83.456)).toBe('1:23.46');
    expect(formatTime(59.999)).toBe('1:00.00');
    expect(formatTime(3725.5)).toBe('62:05.50');
  });

  it('負の値・NaN は -- で表す', () => {
    expect(formatTime(-1)).toBe('--:--.--');
    expect(formatTime(Number.NaN)).toBe('--:--.--');
  });
});

describe('parseTimeInput', () => {
  it('秒だけ・分:秒・時:分:秒を受け付ける', () => {
    expect(parseTimeInput('83.5')).toBe(83.5);
    expect(parseTimeInput('1:23.45')).toBeCloseTo(83.45);
    expect(parseTimeInput(' 1:23 ')).toBe(83);
    expect(parseTimeInput('0:01:23.4')).toBeCloseTo(83.4);
    expect(parseTimeInput('1:00:00')).toBe(3600);
  });

  it('全角の数字・記号も読む', () => {
    expect(parseTimeInput('１：２３．５')).toBeCloseTo(83.5);
  });

  it('formatTime の結果を読み戻せる', () => {
    for (const t of [0, 1.23, 83.46, 3725.5]) expect(parseTimeInput(formatTime(t))).toBeCloseTo(t, 2);
  });

  it('読めない・範囲外の入力は null', () => {
    for (const bad of ['', 'abc', '1:2:3:4', '1:75', '1:60:00', '-3', '1..2', ':5']) expect(parseTimeInput(bad)).toBeNull();
  });
});
