import { expect, test } from '@playwright/test';

/**
 * 区切りで歌詞の動きを変える (core/lyrics/section-motion.ts) の E2E。本物の JIZURA で作る。
 * - [サビ] の区切りは「激しい」の段取りから取るので、同じ長さの A メロよりカットが細かい
 * - 同じ設定なら同じ段取り (決定論)。区切りで変えない設定 (チェックを外す) なら今までどおり
 * - 描くと、どの区切りでも何かが描かれる。作る時間がどれだけ延びるかも測る (結果は注釈に出す)
 */

test.describe.configure({ timeout: 180_000 });

test('区切りで動きを変える: サビは A メロより飾りが多い。同じ設定なら同じ段取り。外せば今までどおり', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const A = await import('/src/core/lyrics/jizura-adapter.ts');
    const { defaultLyrics } = await import('/src/core/types.ts');
    // A メロ 4 行 (2〜18 秒) とサビ 4 行 (18〜34 秒)。行の長さは同じ
    const verse = ['夜明けの色を覚えてる', 'ほどけた声が遠くで鳴った', '静かな部屋に光が落ちる', '消えないように歩いていく'];
    const chorus = ['走れ世界の端まで行け', '小さな牙で夜を破れ', '夢じゃ遅すぎる今すぐ', '心臓ごと明日へ飛び込め'];
    const text = ['[Aメロ]', ...verse, '[サビ]', ...chorus].join('\n');
    const lineTimes = Object.fromEntries([...verse, ...chorus].map((_, i) => [String(i), 2 + i * 4]));
    const base = { ...defaultLyrics(), text, timing: { ...defaultLyrics().timing, lineTimes } };
    const analysis = { duration: 36, beats: Array.from({ length: 76 }, (_, i) => i * 0.47), rms: new Float32Array(36 * 60).fill(0.3), frameRate: 60 };
    const make = async (sections?: { enabled: boolean; levels: Record<string, string> }) => {
      const lyrics = { ...base, motion: { ...base.motion, ...(sections ? { sections } : {}) } };
      const t0 = performance.now();
      const m = await A.LyricMotion.create(lyrics as never, A.buildJizuraAudio(analysis, null), { projectSeed: 5, width: 640, height: 360, fps: 30 });
      return { m, ms: performance.now() - t0 };
    };
    const cutsIn = (m: { plan: { cuts: unknown[] } }, from: number, to: number) => (m.plan.cuts as { start: number; line: number }[]).filter((c) => c.line >= 0 && c.start >= from && c.start < to).length;
    // 飾りの数 (カットごとの decor) と、揺れなどの効果の数
    const decorIn = (m: { plan: { cuts: unknown[] } }, from: number, to: number) =>
      (m.plan.cuts as { start: number; line: number; decor?: unknown[] }[]).filter((c) => c.line >= 0 && c.start >= from && c.start < to).reduce((n, c) => n + (c.decor?.length ?? 0), 0);
    const eventsIn = (m: { plan: { events?: { t: number }[] } }, from: number, to: number) => (m.plan.events ?? []).filter((e) => e.t >= from && e.t < to).length;
    // 書体の読み込みを先に済ませる (時間を比べるため)
    await make({ enabled: false, levels: {} });
    const off = await make({ enabled: false, levels: {} });
    const on = await make();
    const again = await make();
    // 描いてみる (A メロ・サビの真ん中)
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const g = c.getContext('2d')!;
    const drawn = (t: number) => {
      g.clearRect(0, 0, 320, 180);
      on.m.render(g, t);
      const d = g.getImageData(0, 0, 320, 180).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 20) n++;
      return n;
    };
    return {
      levels: on.m.sectionLevels?.map((s) => s.level) ?? null,
      offLevels: off.m.sectionLevels,
      verseOn: cutsIn(on.m, 2, 18),
      chorusOn: cutsIn(on.m, 18, 34),
      verseOff: cutsIn(off.m, 2, 18),
      chorusOff: cutsIn(off.m, 18, 34),
      decorVerseOn: decorIn(on.m, 2, 18),
      decorChorusOn: decorIn(on.m, 18, 34),
      decorChorusOff: decorIn(off.m, 18, 34),
      evVerseOn: eventsIn(on.m, 2, 18),
      evChorusOn: eventsIn(on.m, 18, 34),
      evChorusOff: eventsIn(off.m, 18, 34),
      same: JSON.stringify(on.m.plan.cuts) === JSON.stringify(again.m.plan.cuts),
      drawnVerse: drawn(8),
      drawnChorus: drawn(24),
      msOff: off.ms,
      msOn: on.ms,
    };
  });
  test.info().annotations.push({ type: 'time', description: `作る時間: 区切りで変えない ${r.msOff.toFixed(0)}ms / 変える ${r.msOn.toFixed(0)}ms` });
  console.log(JSON.stringify(r));
  expect(r.levels).toEqual(['normal', 'intense']);
  expect(r.offLevels).toBeNull();
  // 区切りで変えないときは、A メロとサビのカットの数は同じくらい (同じ長さの行なので)
  expect(Math.abs(r.verseOff - r.chorusOff)).toBeLessThanOrEqual(1);
  // 変えると、サビ (激しい) の方が飾りが多い。カットの数は、短い行では言葉の区切りの数で上限に当たるので比べない
  expect(r.decorChorusOn).toBeGreaterThan(r.decorVerseOn);
  expect(r.decorChorusOn).toBeGreaterThan(r.decorChorusOff);
  expect(r.chorusOn).toBeGreaterThanOrEqual(r.chorusOff);
  expect(r.same).toBe(true);
  expect(r.drawnVerse).toBeGreaterThan(50);
  expect(r.drawnChorus).toBeGreaterThan(50);
});
