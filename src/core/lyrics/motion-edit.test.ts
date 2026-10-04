import { beforeAll, describe, expect, it } from 'vitest';
import { defaultLyrics, defaultProject } from '../types';
import { buildProjectFile } from '../project/serialize';
import { sanitizeProject } from '../project/validate';
import { applyMotionEdits, sanitizeMotionEdits } from './motion-edit';
import { buildJizuraProject, type JizuraApi } from './jizura-adapter';

let J: JizuraApi;
beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  await import('../../../vendor/jizura/jizura-engine.js');
  J = (globalThis as unknown as { J: JizuraApi }).J;
});

function fixture() {
  const lyrics = defaultLyrics();
  lyrics.text = 'ひとつめの歌詞\nふたつめの歌詞';
  lyrics.timing.lineTimes = { '0': 1, '1': 5 };
  lyrics.timing.lineEnds = { '0': 4.9, '1': 9 };
  return lyrics;
}
function project(lyrics = fixture(), seed = 7) {
  const p = buildJizuraProject(lyrics, J.defaultProject(), { seed, aspect: '16:9', fps: 30 });
  applyMotionEdits(p, lyrics.motion, ['ひとつめの歌詞', 'ふたつめの歌詞']);
  return p;
}

describe('歌詞モーションの個別編集', () => {
  it('本物のJIZURAで、行ごとの演出と分割数を使う', () => {
    const lyrics = fixture();
    lyrics.motion.lines = { '0': { text: 'ひとつめの歌詞', layout: 'center', enter: 'cut', exit: 'cut', hold: 'still', decor: [], cuts: 1 } };
    const plan = J.plan(project(lyrics), null);
    const cuts = plan.cuts as Record<string, unknown>[];
    const first = cuts.filter((c) => c.line === 0 && c.utext != null);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ layout: 'center', enter: 'cut', exit: 'cut', hold: 'still', decor: [] });
  });

  it('本物のJIZURAで、自動生成の演出候補を切り替える', () => {
    const lyrics = fixture();
    const keys = J.order('enter');
    lyrics.motion.effects = { enter: Object.fromEntries(keys.map((k) => [k, k === 'cut'])) };
    const plan = J.plan(project(lyrics), null);
    expect((plan.cuts as Record<string, unknown>[]).filter((c) => c.utext != null).every((c) => c.enter === 'cut')).toBe(true);
  });

  it('自動の場面転換で、選んだ登場・退場を上書きしない', () => {
    const lyrics = fixture();
    lyrics.timing.lineEnds['0'] = 5;
    lyrics.motion.lines = { '0': { text: 'ひとつめの歌詞', enter: 'type', exit: 'blur', cuts: 3 } };
    for (let seed = 0; seed < 20; seed++) {
      const plan = J.plan(project(lyrics, seed), null);
      const cuts = (plan.cuts as Record<string, unknown>[]).filter((c) => c.line === 0 && c.utext != null);
      expect(cuts).toHaveLength(3);
      expect(cuts.every((c) => c.enter === 'type' && c.exit === 'blur')).toBe(true);
    }
  });

  it('固定した行のカットはseedと細かさを変えても保持する', () => {
    const lyrics = fixture();
    const plan = J.plan(project(lyrics), null);
    const snapshot = J.lineSnapshot(plan, 0)!;
    expect(snapshot.length).toBeGreaterThan(0);
    lyrics.motion.lines = { '0': { text: 'ひとつめの歌詞', lock: true, lockedSeed: plan.lines[0]!.seed, lockedCuts: snapshot } };
    lyrics.motion.density = 1;
    const next = J.plan(project(lyrics, 999), null);
    expect(J.lineSnapshot(next, 0)).toEqual(snapshot);
  });

  it('歌詞を書き換えた行には古い指定を適用しない', () => {
    const lyrics = fixture();
    lyrics.motion.lines = { '0': { text: '前の歌詞', enter: 'cut' } };
    expect(project(lyrics).overrides).toEqual({});
  });

  it('パックの既定よりユーザーの選択を優先し、覆う演出の除外を保つ', () => {
    const p = { enabled: { enter: { type: false }, layout: {} } };
    const lyrics = fixture();
    lyrics.motion.effects = { enter: { type: true }, layout: { curtain: true } };
    applyMotionEdits(p, lyrics.motion, [], { layout: ['curtain'] });
    expect(p.enabled.enter.type).toBe(true);
    expect(p.enabled.layout).toEqual({ curtain: false });
  });

  it('保存して読み直しても個別設定と固定カットを複製して保持する', () => {
    const lyrics = fixture();
    const plan = J.plan(project(lyrics), null);
    lyrics.motion.effects = { enter: { type: false } };
    lyrics.motion.lines = { '0': { text: 'ひとつめの歌詞', lock: true, lockedSeed: plan.lines[0]!.seed, lockedCuts: J.lineSnapshot(plan, 0)! } };
    const defaults = defaultProject();
    const saved = buildProjectFile({ seed: defaults.seed, presetId: defaults.visualizer.preset, params: defaults.visualizer.common, audio: { isLoaded: false, fileName: '', sha256: '', duration: 0, sampleRate: 0, bpm: 0 }, overlays: [], lyrics, rhythm: null, exportSettings: defaults.export });
    expect(saved.lyrics!.motion.lines).not.toBe(lyrics.motion.lines);
    const loaded = sanitizeProject(JSON.parse(JSON.stringify(saved)));
    expect(loaded.lyrics!.motion).toEqual(lyrics.motion);
    expect(J.lineSnapshot(J.plan(project(loaded.lyrics!), null), 0)).toEqual(lyrics.motion.lines['0']!.lockedCuts);
  });

  it('壊れた固定データ・未知のグループ・危険なキーを捨てる', () => {
    const edits = sanitizeMotionEdits(JSON.parse('{"effects":{"enter":{"type":false,"__proto__":false},"unknown":{"x":false}},"lines":{"0":{"text":"歌詞","cuts":100,"lock":true,"lockedCuts":[{}]},"-1":{"text":"bad"}}}'));
    expect(edits).toEqual({ effects: { enter: { type: false } }, lines: { '0': { text: '歌詞', cuts: 12 } } });
    expect(sanitizeMotionEdits({})).toEqual({});
  });
});
