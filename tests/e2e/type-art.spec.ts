import { expect, test } from '@playwright/test';

for (const style of ['vs-hyper', 'vs-gothic']) for (const portrait of [false, true]) {
  test(`文字アート: ${style} ${portrait ? '縦' : '横'}、行内連続性・速い拍・fast一致`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    const result = await page.evaluate(async ({ style, portrait }) => {
      const { LyricMotion } = await import('/src/core/lyrics/jizura-adapter.ts');
      const { defaultLyrics } = await import('/src/core/types.ts');
      const lyrics = defaultLyrics(); lyrics.motion.style = style; lyrics.motion.motion = 1; lyrics.motion.decor = 1;
      lyrics.motion.sections = { enabled: false, levels: {} };
      lyrics.text = '光を追いかけて\n夜空に描いた言葉を君の明日まで届けたい';
      lyrics.timing.lineTimes = { '0': 0.4, '1': 4.4 }; lyrics.timing.lineEnds = { '0': 4.3, '1': 8.3 };
      const W = portrait ? 180 : 320, H = portrait ? 320 : 180;
      const motion = await LyricMotion.create(lyrics, { duration: 9, beats: Array.from({ length: 36 }, (_, i) => i * 0.25), energy: new Float32Array(540).fill(0.8), energyRate: 60 }, { projectSeed: 41, width: W, height: H, fps: 30 });
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const history: Float32Array[] = [], flashes: number[] = [], ms: number[] = [];
      let flashing = false, boundaryMin = 1, mismatch = 0;
      const cuts = motion.plan.cuts as { line: number; start: number; end: number }[];
      const boundaries = cuts.filter((c, i) => i > 0 && c.line === cuts[i - 1]!.line && c.line >= 0).map(c => c.start);
      for (let i = 0; i < 270; i++) {
        const t = i / 30, before = performance.now(); motion.render(ctx, t, { fast: true }); ms.push(performance.now() - before);
        const pixels = ctx.getImageData(0, 0, W, H).data, lum = new Float32Array(W * H); let visible = 0;
        for (let j = 0; j < lum.length; j++) {
          const a = pixels[j * 4 + 3]! / 255;
          const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          lum[j] = a * (0.2126 * lin(pixels[j * 4]!) + 0.7152 * lin(pixels[j * 4 + 1]!) + 0.0722 * lin(pixels[j * 4 + 2]!));
          if (a > 0.1) visible++;
        }
        if (boundaries.some(b => Math.abs(t - b) < 0.08)) boundaryMin = Math.min(boundaryMin, visible / lum.length);
        let bright = false;
        for (const old of history) { let count = 0; for (let j = 0; j < lum.length; j++) if (lum[j]! - old[j]! >= 0.1) count++; if (count / lum.length >= 0.25) bright = true; }
        if (bright && !flashing) flashes.push(t); flashing = bright; history.push(lum); if (history.length > 6) history.shift();
        if (i % 30 === 15) {
          motion.render(ctx, t, { fast: false }); const normal = ctx.getImageData(0, 0, W, H).data;
          for (let j = 0; j < normal.length; j++) mismatch = Math.max(mismatch, Math.abs(normal[j]! - pixels[j]!));
        }
      }
      ms.sort((a, b) => a - b);
      return { maxFlashes: Math.max(0, ...flashes.map(t => flashes.filter(f => f >= t && f < t + 1).length)), boundaryMin, boundaryCount: boundaries.length, mismatch, p95ms: ms[Math.floor(ms.length * 0.95)] };
    }, { style, portrait });
    console.log(style, portrait, result);
    expect(result.boundaryCount).toBeGreaterThan(0); expect(result.boundaryMin).toBeGreaterThan(0.01);
    expect(result.maxFlashes).toBeLessThanOrEqual(3); expect(result.mismatch).toBe(0);
  });
}
