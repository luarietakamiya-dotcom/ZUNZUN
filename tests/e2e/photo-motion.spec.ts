import { expect, test } from '@playwright/test';

/**
 * 「写真に動き」の E2E: 写真 1 枚の場面 3 つと部品から組み立てる場面 2 つが読み込まれて映り (真っ黒でない)、音があると絵が変わる
 * (スピーカーのふくらみ・光る所)。同じ音なら同じ絵 (乱数を使わない)。
 */

test.describe.configure({ timeout: 180_000 });

for (const photo of ['speaker-rack', 'stage-lights', 'speaker-alley', 'rack-parts', 'alley-lights']) {
  test(`写真に動き (${photo}): 写真が映り、低音・音量で絵が変わり、同じ音なら同じ絵`, async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async (photo) => {
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
        const params = { ...defaultCommonParams(), photo, cameraMotion: 0, sensitivity: 1 };
        await host.setPreset(visualizerRegistry.get('photo-motion')!, 1, params);
        for (let i = 0; i < 40; i++) {
          const hit = loud && i >= 32;
          const bands = new Float32Array(64).fill(loud ? 0.7 : 0);
          host.render({ t: i / 60, dt: 1 / 60, bass: hit ? 1 : 0, mid: 0, high: loud ? 0.8 : 0, rms: loud ? 0.9 : 0, peak: 0, beat: hit ? 1 : 0, beatIndex: hit ? 1 : -1, spectralEnergy: 0, flux: 0, bands }, params);
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
      let mean = 0;
      let diff = 0;
      let same = 0;
      for (let i = 0; i < quiet.length; i += 4) {
        mean += (quiet[i]! + quiet[i + 1]! + quiet[i + 2]!) / 3;
        diff += Math.abs(loud[i]! - quiet[i]!) + Math.abs(loud[i + 1]! - quiet[i + 1]!) + Math.abs(loud[i + 2]! - quiet[i + 2]!);
        same = Math.max(same, Math.abs(loud[i]! - again[i]!), Math.abs(loud[i + 1]! - again[i + 1]!), Math.abs(loud[i + 2]! - again[i + 2]!));
      }
      const n = quiet.length / 4;
      return { mean: mean / n, diff: diff / n, same };
    }, photo);
    // 写真が映っている (真っ黒ではない)
    expect(r.mean, JSON.stringify(r)).toBeGreaterThan(12);
    // 音で絵が変わる
    expect(r.diff, JSON.stringify(r)).toBeGreaterThan(2);
    // 同じ音なら同じ絵
    expect(r.same, JSON.stringify(r)).toBeLessThanOrEqual(1);
  });
}
