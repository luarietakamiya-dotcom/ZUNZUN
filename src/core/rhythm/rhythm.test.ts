import { describe, expect, it } from 'vitest';
import type { AudioAnalysis } from '../audio/analyze';
import { barLengthEstimate, BarTapSession, fillGaps, fillToEnd } from './bars';
import { buildRhythmGrid, groupsForBar, normalizeBars, rhythmPositionAt } from './grid';
import { formatGrouping, parseGrouping } from './grouping';
import { barIndexAt, describeGrouping, removeMeter, setMeter } from './edit';
import { barSnapTargetsFor } from './targets';

describe('parseGrouping / formatGrouping', () => {
  it('「2+2+3」はまとまり、数字 1 つは等分', () => {
    expect(parseGrouping('2+2+3')).toEqual([2, 2, 3]);
    expect(parseGrouping('3+3+2')).toEqual([3, 3, 2]);
    expect(parseGrouping('4')).toEqual([1, 1, 1, 1]);
    expect(parseGrouping('5')).toEqual([1, 1, 1, 1, 1]);
    expect(parseGrouping('３＋２')).toEqual([3, 2]);
    expect(parseGrouping(' 2 + 2 + 3 ')).toEqual([2, 2, 3]);
  });

  it('読めない・大きすぎる指定は null', () => {
    // まとまりは 1〜16、合計は 32 まで (数字 1 つの等分は 32 まで)
    for (const bad of ['', 'abc', '2+', '+2', '2++3', '0+2', '33', '16+17', '9+9+9+9', '2.5+2', '-3']) expect(parseGrouping(bad)).toBeNull();
    expect(parseGrouping('16+16')).toEqual([16, 16]);
    expect(parseGrouping('17')).toHaveLength(17);
  });

  it('表示用の書き方に戻す', () => {
    expect(formatGrouping([2, 2, 3])).toBe('2+2+3');
    expect(formatGrouping([1, 1, 1, 1, 1, 1, 1])).toBe('7');
  });
});

describe('buildRhythmGrid', () => {
  it('7/8 (2+2+3): 1 小節に 3 拍、長・長・短の間隔。小節の頭がアクセント', () => {
    // 1 小節 = 1.75 秒 (8 分音符 0.25 秒 × 7)
    const g = buildRhythmGrid({ bars: [1, 2.75, 4.5], meters: [{ bar: 0, pattern: '2+2+3' }] });
    expect(g.bars).toHaveLength(3);
    expect(g.beats.slice(0, 4)).toEqual([1, 1.5, 2, 2.75]);
    expect(g.pulses.slice(0, 3).map((p) => [p.group, p.groupsInBar, p.barHead, +p.length.toFixed(3)])).toEqual([
      [0, 3, true, 0.5],
      [1, 3, false, 0.5],
      [2, 3, false, 0.75],
    ]);
    expect(g.accents).toEqual([1, 2.75, 4.5]);
    // 最後の小節は、ひとつ前と同じ長さとみなす
    expect(g.bars[2]).toMatchObject({ start: 4.5, end: 6.25 });
  });

  it('途中で拍子が変わる: 2 小節目から 4', () => {
    const g = buildRhythmGrid({ bars: [0, 1.75, 3.75, 5.75], meters: [{ bar: 0, pattern: '2+2+3' }, { bar: 1, pattern: '4' }] });
    expect(g.bars.map((b) => b.groups.length)).toEqual([3, 4, 4, 4]);
    expect(g.beats.slice(3, 8)).toEqual([1.75, 2.25, 2.75, 3.25, 3.75]);
  });

  it('小節の頭が 1 つだけ・短すぎる小節は作らない。拍子が無い・壊れているときは 4', () => {
    expect(buildRhythmGrid({ bars: [3], meters: [] }).bars).toEqual([]);
    const g = buildRhythmGrid({ bars: [0, 0.1, 2, 4], meters: [{ bar: 0, pattern: 'xx' }] });
    // 0.1 は 0 に近すぎないが短すぎる小節 (0 → 0.1) になるので捨てる
    expect(g.bars.map((b) => [b.start, b.groups.length])).toEqual([
      [0.1, 4],
      [2, 4],
      [4, 4],
    ]);
  });

  it('groupsForBar: その小節以前で最後に指定された拍子', () => {
    const meters = [{ bar: 4, pattern: '3+2' }, { bar: 0, pattern: '4' }, { bar: 8, pattern: '7' }];
    expect(groupsForBar(meters, 0)).toEqual([1, 1, 1, 1]);
    expect(groupsForBar(meters, 5)).toEqual([3, 2]);
    expect(groupsForBar(meters, 20)).toHaveLength(7);
  });

  it('rhythmPositionAt: 時刻がどの小節・どのまとまりの中か', () => {
    const g = buildRhythmGrid({ bars: [1, 2.75, 4.5], meters: [{ bar: 0, pattern: '2+2+3' }] });
    expect(rhythmPositionAt(g, 0.5)).toBeNull();
    const p = rhythmPositionAt(g, 2.375)!;
    expect(p.pulse.group).toBe(2);
    expect(p.phase).toBeCloseTo(0.5);
    expect(p.barPhase).toBeCloseTo(1.375 / 1.75);
    expect(rhythmPositionAt(g, 7)).toBeNull();
  });
});

describe('normalizeBars', () => {
  it('昇順に並べ、近すぎるもの・負・NaN を除く', () => {
    expect(normalizeBars([3, 1, 1.02, -1, Number.NaN, 2])).toEqual([1, 2, 3]);
  });
});

describe('小節を埋める', () => {
  it('barLengthEstimate: 最後の数小節の長さの中央値', () => {
    expect(barLengthEstimate([0, 2, 4, 6.1, 8])).toBeCloseTo(2);
    expect(barLengthEstimate([1])).toBeNull();
  });

  it('fillToEnd: 最後の小節から曲の終わりまで同じ長さで埋める (半端な端数は作らない)', () => {
    expect(fillToEnd([0, 2, 4], 11)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(fillToEnd([0, 2, 4], 10.9)).toEqual([0, 2, 4, 6, 8]);
    expect(fillToEnd([5], 100)).toEqual([5]);
  });

  it('fillGaps: 間が小節の長さのほぼ整数倍なら同じ長さで埋める', () => {
    // 2 秒の小節を 3 つ叩いてから、4 小節あけて (8.1 秒後) 叩いた
    expect(fillGaps([0, 2, 4, 12.1])).toEqual([0, 2, 4, 6.025, 8.05, 10.075, 12.1]);
    // 整数倍から大きく外れる間はそのまま
    expect(fillGaps([0, 2, 4, 9])).toEqual([0, 2, 4, 9]);
  });
});

describe('BarTapSession', () => {
  it('始めた時刻より後ろの小節の頭は消し、叩くたびに足し、1 つ戻れる', () => {
    const s = new BarTapSession([0, 2, 4, 6], 3.5);
    expect(s.bars).toEqual([0, 2]);
    expect(s.tap(4.01)).toEqual([0, 2, 4.01]);
    expect(s.tap(4.05)).toEqual([0, 2, 4.01]); // 近すぎる連打は無視
    s.tap(6);
    expect(s.tapCount).toBe(2);
    expect(s.back()).toEqual([0, 2, 4.01]);
    expect(s.back()).toEqual([0, 2]);
    // タップより前からあった小節の頭は、1 つ戻るでは消さない
    expect(s.back()).toBeNull();
    expect(s.canBack).toBe(false);
  });
});

describe('barSnapTargetsFor', () => {
  it('音全体の立ち上がりを候補に、ビートを昇順に。解析結果ごとに一度だけ計算する', () => {
    const flux = new Float32Array(240);
    for (let f = 60; f < 70; f++) flux[f] = 0.9;
    const analysis = { flux, frameRate: 60, beats: [2, 1] } as unknown as AudioAnalysis;
    const a = barSnapTargetsFor(analysis);
    expect(barSnapTargetsFor(analysis)).toBe(a);
    expect(a.beats).toEqual([1, 2]);
    expect(a.candidates.some((t) => Math.abs(t - 1) < 0.05)).toBe(true);
  });
});

describe('拍子の区間の編集', () => {
  it('setMeter: 同じ小節は置き換え、昇順に並べ、書き方をそろえる。読めない拍子は null', () => {
    const base = [{ bar: 0, pattern: '4' }];
    const a = setMeter(base, 4, '２＋２＋３')!;
    expect(a).toEqual([{ bar: 0, pattern: '4' }, { bar: 4, pattern: '2+2+3' }]);
    expect(setMeter(a, 2, '1+1+1')).toEqual([{ bar: 0, pattern: '4' }, { bar: 2, pattern: '3' }, { bar: 4, pattern: '2+2+3' }]);
    expect(setMeter(a, 4, '5')).toEqual([{ bar: 0, pattern: '4' }, { bar: 4, pattern: '5' }]);
    expect(setMeter(a, 0, '3+3')![0]).toEqual({ bar: 0, pattern: '3+3' });
    expect(setMeter(a, 1, 'abc')).toBeNull();
    expect(setMeter(a, -1, '4')).toBeNull();
    // 1 小節目の指定が無ければ 4 を足す
    expect(setMeter([], 3, '5')).toEqual([{ bar: 0, pattern: '4' }, { bar: 3, pattern: '5' }]);
    expect(base).toEqual([{ bar: 0, pattern: '4' }]);
  });

  it('removeMeter: 1 小節目の指定は消さない', () => {
    const m = [{ bar: 0, pattern: '4' }, { bar: 4, pattern: '2+2+3' }];
    expect(removeMeter(m, 4)).toEqual([{ bar: 0, pattern: '4' }]);
    expect(removeMeter(m, 0)).toEqual(m);
  });

  it('barIndexAt: その時刻を含む小節の番号 (前なら -1)', () => {
    const bars = [1, 3, 5];
    expect(barIndexAt(bars, 0.5)).toBe(-1);
    expect(barIndexAt(bars, 1)).toBe(0);
    expect(barIndexAt(bars, 4.99)).toBe(1);
    expect(barIndexAt(bars, 100)).toBe(2);
    expect(barIndexAt([], 3)).toBe(-1);
  });

  it('describeGrouping', () => {
    expect(describeGrouping('2+2+3')).toBe('7 等分を 2・2・3 にまとめる');
    expect(describeGrouping('4')).toBe('4 等分');
    expect(describeGrouping('x')).toBeNull();
  });
});
