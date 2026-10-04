import { describe, expect, it } from 'vitest';
import { sectionCuesFrom } from './section-cues';
import type { Section } from './sections';

const sec = (start: number, kind: Section['kind'] = 'verse'): Section => ({ kind, label: '', start, end: start + 10 });

describe('sectionCuesFrom', () => {
  it('区切りの始まりの時刻を境目にする。最初の区切り (0 秒付近) は境目にしない', () => {
    expect(sectionCuesFrom([sec(0, 'intro'), sec(12), sec(40, 'chorus'), sec(70)])).toEqual([12, 40, 70]);
  });
  it('近すぎる区切りは間引く', () => {
    expect(sectionCuesFrom([sec(0), sec(20), sec(23), sec(50)])).toEqual([20, 50]);
  });
  it('区切りが 2 つ未満なら null (音の変化から自動)', () => {
    expect(sectionCuesFrom([])).toBeNull();
    expect(sectionCuesFrom([sec(0)])).toBeNull();
    expect(sectionCuesFrom([sec(0), sec(0.5)])).toBeNull();
  });
  it('壊れた時刻は無視する', () => {
    expect(sectionCuesFrom([sec(0), sec(Number.NaN), sec(30)])).toEqual([30]);
  });
});
