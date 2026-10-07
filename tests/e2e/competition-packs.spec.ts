import { expect, test } from '@playwright/test';

// ソフトウェア描画の画素再現を検査。GPUの丸め差は別の統合レビューで記録する。
test.use({ launchOptions: {
  args: ['--disable-accelerated-2d-canvas'],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
} });

for (const portrait of [false, true]) {
  test(`競作: 全GPT/質感Claude構図の${portrait ? '縦' : '横'}・同時刻再現とキャッシュ干渉`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    const result = await page.evaluate(async ({ portrait }) => {
      const { LyricMotion, loadJizura } = await import('/src/core/lyrics/jizura-adapter.ts');
      const { defaultLyrics } = await import('/src/core/types.ts');
      const { GPT_PACKS } = await import('/src/core/lyrics/packs/gpt/index.ts');
      const { CLAUDE_PACKS } = await import('/src/core/lyrics/packs/claude/index.ts');
      const J = await loadJizura(), packs = [...GPT_PACKS, ...CLAUDE_PACKS.slice(6)];
      const W = portrait ? 180 : 320, H = portrait ? 320 : 180;
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      let frames = 0, mismatched = 0, empty = 0, layouts = 0, p95ms = 0;
      const differences: { key: string; text: string; t: number; max: number; pixels: number; bounds: number[] }[] = [];
      const slowest: { key: string; ms: number }[] = [];
      for (const pack of packs) for (const text of ['止まらない', '夜明けの向こうへこの歌を届けたい']) {
        const lyrics = defaultLyrics(); lyrics.motion.style = pack.styleKey; lyrics.motion.sections = { enabled: false, levels: {} }; lyrics.text = text;
        lyrics.timing.lineTimes = { '0': .4 }; lyrics.timing.lineEnds = { '0': 3.4 };
        const audio = { duration: 4, beats: Array.from({ length: 8 }, (_, i) => i * .5), energy: new Float32Array(240).fill(.5), energyRate: 60 };
        const options = { projectSeed: 41, width: W, height: H, fps: 30 };
        let a = await LyricMotion.create(lyrics, audio, options);
        type Cut = { line: number; start: number; end: number; dur: number; text: string; lineText: string; layout: string; params: Record<string, unknown>; trans: string; morph: unknown };
        const original = structuredClone((a.plan.cuts as Cut[]).find(c => c.line === 0)!);
        for (const effect of pack.effects(J).filter(e => e.group === 'layout' && !e.def.compatibility)) {
          if (!(effect.def.fits as (n: number) => boolean)([...text].length)) continue;
          const params = (effect.def.plan as (r: unknown) => Record<string, unknown>)({ pick: (v: unknown[]) => v[0], range: (a: number, b: number) => (a + b) / 2 });
          const c: Cut = { ...original, start: .4, end: 3.4, dur: 3, text, lineText: text, layout: effect.key, params, trans: 'none', morph: null };
          a = await LyricMotion.create(lyrics, audio, options); a.plan.cuts = [structuredClone(c)]; layouts++;
          const times = [.55, .8, 1.25, 1.75, 2.5, 3.15], durations: number[] = [];
          const read = (m: typeof a, t: number) => { const before = performance.now(); m.render(ctx, t, { fast: false }); durations.push(performance.now() - before); frames++; return ctx.getImageData(0, 0, W, H).data.slice(); };
          const expected = times.map(t => read(a, t));
          // 書き出しは作成直後に先頭から描く。作成時の作業層リセットも含めて比較。
          const b = await LyricMotion.create(lyrics, audio, options); b.plan.cuts = [structuredClone(c)];
          // 書き出しと同じ順序で、別インスタンスの同じコマを比較する。
          for (let i = 0; i < times.length; i++) {
            const actual = read(b, times[i]!);
            if (actual.some((n, j) => n !== expected[i]![j])) { mismatched++; differences.push({ key: effect.key, text, t: times[i]!, bounds: actual.reduce((b,v,j)=>{if(v!==expected[i]![j]){const x=Math.floor(j/4)%W,y=Math.floor(j/4/W);b[0]=Math.min(b[0]!,x);b[1]=Math.min(b[1]!,y);b[2]=Math.max(b[2]!,x);b[3]=Math.max(b[3]!,y);}return b;},[W,H,0,0]), max: actual.reduce((n, v, j) => Math.max(n, Math.abs(v - expected[i]![j])), 0), pixels: actual.reduce((n, v, j) => n + Number(v !== expected[i]![j]), 0) }); }
            if (!actual.some((n, j) => j % 4 === 3 && n > 25)) empty++;
          }
          durations.sort((a, b) => a - b); const ms = durations[Math.floor(durations.length * .95)]!;
          slowest.push({ key: effect.key, ms }); p95ms = Math.max(p95ms, ms);
        }
      }
      return { frames, layouts, mismatched, empty, p95ms, differences, slowest: slowest.sort((a, b) => b.ms - a.ms).slice(0, 5) };
    }, { portrait });
    console.log('competition review', portrait, result);
    expect(result.layouts).toBeGreaterThanOrEqual(42);
    expect(result.mismatched).toBe(0);
    expect(result.empty).toBe(0);
  });
}
