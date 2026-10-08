import { expect, test } from '@playwright/test';

test('月と羽根は横縦・短長文・月の両相・挿入と羽根の時間を通して字幕帯に収まる', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { LyricMotion, loadJizura } = await import('/src/core/lyrics/jizura-adapter.ts');
    const { defaultLyrics } = await import('/src/core/types.ts');
    const { moonFeatherPack } = await import('/src/core/lyrics/packs/gpt/moon-feather.ts');
    const J = await loadJizura();
    let outside = 0, visible = 0, frames = 0;
    const layouts: string[] = [];
    for (const [W, H] of [[640, 360], [360, 640]]) for (const text of ['夜を越えて', '遠く離れていても同じ空の下で君の声を待っている']) {
      const lyrics = defaultLyrics(); lyrics.text = text; lyrics.motion.style = moonFeatherPack.styleKey;
      lyrics.motion.sections = { enabled: false, levels: {} };
      lyrics.timing.lineTimes = { '0': .4 }; lyrics.timing.lineEnds = { '0': 3.4 };
      const engine = await LyricMotion.create(lyrics, { duration: 4, beats: [], energy: new Float32Array(240), energyRate: 60 }, { projectSeed: 41, width: W!, height: H!, fps: 30 });
      const original = structuredClone(engine.plan.cuts.find(c => (c as { line: number }).line === 0)) as Record<string, unknown>;
      const canvas = document.createElement('canvas'); canvas.width = W!; canvas.height = H!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      for (const phase of [.18, 1]) {
        const effect = moonFeatherPack.effects(J).find(e => e.group === 'layout')!;
        layouts.push(effect.key);
        engine.plan.cuts = [{ ...original, text, lineText: text, start: .4, end: 3.4, dur: 3, layout: effect.key,
          params: { moonPhase: phase }, trans: 'none', morph: null }];
        for (const t of [.42, .55, .85, 1.75, 3.2, 3.38]) {
          engine.render(ctx, t, { fast: false }); frames++;
          const pixels = ctx.getImageData(0, 0, W!, H!).data;
          let drawn = 0;
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 3) {
            drawn++;
            const y = Math.floor(i / 4 / W!);
            if (y < Math.floor(H! * .77) || y >= Math.ceil(H! * .93)) outside++;
          }
          if (t === 1.75 && drawn > 20) visible++;
        }
      }
    }
    return { outside, visible, frames, layouts: new Set(layouts).size };
  });
  expect(result).toEqual({ outside: 0, visible: 8, frames: 48, layouts: 1 });
});

test('実際のプラン生成でも歌詞見出しから月相が変わり、.cと.gが別々に登録される', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { LyricMotion, loadJizura } = await import('/src/core/lyrics/jizura-adapter.ts');
    const { defaultLyrics } = await import('/src/core/types.ts');
    const lyrics = defaultLyrics();
    lyrics.text = '[Intro]\n月の光へ\n[Chorus]\n羽根が舞う';
    lyrics.motion.style = 'vs-moonfeather.g';
    lyrics.timing.lineTimes = { '0': 2, '1': 5 };
    lyrics.timing.lineEnds = { '0': 5, '1': 8 };
    const m = await LyricMotion.create(lyrics, { duration: 8, beats: [], energy: new Float32Array(480), energyRate: 60 }, { projectSeed: 41, width: 640, height: 360, fps: 30 });
    const J = await loadJizura();
    const styles = Object.values(J.STYLES).map(style => style.name);
    return { phases: [...new Set(m.plan.cuts.filter(c => c.line >= 0).map(c => c.params.moonPhase))], separate: styles.includes('月と羽根・字幕.g') && styles.some(name => name.startsWith('月と羽根・字幕.c')) };
  });
  expect(result).toEqual({ phases: [.18, 1], separate: true });
});
