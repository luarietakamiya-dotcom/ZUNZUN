import { expect, test } from '@playwright/test';

test('MV字幕は横縦・短長文・全構図の出入りも下部帯に収まり、映像の中央を描かない', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { LyricMotion, loadJizura } = await import('/src/core/lyrics/jizura-adapter.ts');
    const { defaultLyrics } = await import('/src/core/types.ts');
    const { subtitlePack } = await import('/src/core/lyrics/packs/gpt/subtitle.ts');
    const J = await loadJizura();
    let outside = 0, visible = 0, frames = 0;
    const layouts: string[] = [];
    for (const [W, H] of [[640, 360], [360, 640]]) for (const text of ['夜を越えて', '遠く離れていても同じ空の下で君の声を待っている']) {
      const lyrics = defaultLyrics(); lyrics.text = text; lyrics.motion.style = subtitlePack.styleKey;
      lyrics.motion.sections = { enabled: false, levels: {} };
      lyrics.timing.lineTimes = { '0': .4 }; lyrics.timing.lineEnds = { '0': 3.4 };
      const engine = await LyricMotion.create(lyrics, { duration: 4, beats: [], energy: new Float32Array(240), energyRate: 60 }, { projectSeed: 41, width: W!, height: H!, fps: 30 });
      const original = structuredClone(engine.plan.cuts.find(c => (c as { line: number }).line === 0)) as Record<string, unknown>;
      const canvas = document.createElement('canvas'); canvas.width = W!; canvas.height = H!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      for (const effect of subtitlePack.effects(J).filter(e => e.group === 'layout')) {
        layouts.push(effect.key);
        engine.plan.cuts = [{ ...original, text, lineText: text, start: .4, end: 3.4, dur: 3, layout: effect.key,
          params: (effect.def.plan as () => unknown)(), trans: 'none', morph: null }];
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
  expect(result).toEqual({ outside: 0, visible: 12, frames: 72, layouts: 3 });
});

test('自動の曲名・間奏カードもMVの下部字幕へ収める', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { LyricMotion } = await import('/src/core/lyrics/jizura-adapter.ts');
    const { defaultLyrics } = await import('/src/core/types.ts');
    const lyrics = defaultLyrics(); lyrics.text = '[ti:夜を越えて]\n君の声へ\n[間奏:8]'; lyrics.motion.style = 'vs-subtitle.g';
    lyrics.timing.lineTimes = { '0': 2, '1': 5 }; lyrics.timing.lineEnds = { '0': 5, '1': 13 };
    const m = await LyricMotion.create(lyrics, { duration: 13, beats: [], energy: new Float32Array(780), energyRate: 60 }, { projectSeed: 41, width: 640, height: 360, fps: 30 });
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let outside = 0, visible = 0;
    for (const t of [1, 7]) {
      m.render(ctx, t); const p = ctx.getImageData(0, 0, 640, 360).data; let count = 0;
      for (let i = 3; i < p.length; i += 4) if (p[i]! > 3) { count++; const y = Math.floor(i / 4 / 640); if (y < 277 || y >= 335) outside++; }
      if (count > 20) visible++;
    }
    return { outside, visible };
  });
  expect(result).toEqual({ outside: 0, visible: 2 });
});
