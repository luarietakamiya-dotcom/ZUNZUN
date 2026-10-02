import { expect, test } from '@playwright/test';

/**
 * 「サイバー空間」の E2E: 3 つの空間の絵が読み込まれて映り (真っ黒でない)、音があると明るく光る。
 * 同じ音・同じ seed なら同じ絵 (乱数は ctx.rng だけ)。
 */

test.describe.configure({ timeout: 180_000 });

for (const scene of ['neon-gate', 'crystal-void', 'sky-hall']) {
  test(`サイバー空間 (${scene}): 絵が映り、音で光り、同じ音なら同じ絵`, async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async (scene) => {
      const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
      const { visualizerRegistry } = await import('/src/visualizers/index.ts');
      const { defaultCommonParams } = await import('/src/core/types.ts');
      const W = 320;
      const H = 180;
      const shot = async (loud: boolean): Promise<Uint8ClampedArray> => {
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        document.body.appendChild(canvas);
        const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
        host.resize(W, H);
        const params = { ...defaultCommonParams(), scene, sensitivity: 1 };
        await host.setPreset(visualizerRegistry.get('cyber-space')!, 1, params);
        for (let i = 0; i < 40; i++) {
          host.render({ t: i / 30, dt: 1 / 30, bass: loud ? 0.8 : 0, mid: 0, high: 0, rms: loud ? 0.9 : 0, peak: 0, beat: loud && i % 15 === 0 ? 1 : 0, beatIndex: loud ? Math.floor(i / 15) : -1, spectralEnergy: 0, flux: 0, bands: new Float32Array(64) }, params);
        }
        const tmp = document.createElement('canvas');
        tmp.width = W;
        tmp.height = H;
        const g = tmp.getContext('2d')!;
        g.drawImage(canvas, 0, 0);
        const data = g.getImageData(0, 0, W, H).data;
        host.dispose();
        canvas.remove();
        return data;
      };
      const quiet = await shot(false);
      const loud = await shot(true);
      const again = await shot(true);
      let mq = 0;
      let ml = 0;
      let same = 0;
      for (let i = 0; i < quiet.length; i += 4) {
        mq += (quiet[i]! + quiet[i + 1]! + quiet[i + 2]!) / 3;
        ml += (loud[i]! + loud[i + 1]! + loud[i + 2]!) / 3;
        same = Math.max(same, Math.abs(loud[i]! - again[i]!), Math.abs(loud[i + 1]! - again[i + 1]!), Math.abs(loud[i + 2]! - again[i + 2]!));
      }
      const n = quiet.length / 4;
      return { quiet: mq / n, loud: ml / n, same };
    }, scene);
    expect(r.quiet, JSON.stringify(r)).toBeGreaterThan(12);
    expect(r.loud, JSON.stringify(r)).toBeGreaterThan(r.quiet + 5);
    expect(r.same, JSON.stringify(r)).toBeLessThanOrEqual(1);
  });
}
