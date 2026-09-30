import { expect, test, type Page } from '@playwright/test';

/**
 * 背景の一枚絵 (core/render/background.ts) の E2E。本物の VisualizerHost + PostFX + プリセットで描く (visual.spec.ts と同じ作り)。
 * - 黒い背景 + スクリーン合成 (暗さ 0) は、背景なしとほぼ同じ絵になる (色の変換をしていないこと・合成の式の確認)
 * - 絵のある背景では絵が変わり、同じ seed・同じ背景なら同じ絵になる (決定論)
 */

test.describe.configure({ timeout: 240_000 });

type Bg = null | { kind: 'black' | 'photo'; blend?: 'screen' | 'add' | 'over'; dim?: number; opacity?: number };

interface Shot {
  url: string;
  mean: number;
  pixels: number[];
}

async function render(page: Page, presetId: string, seed: number, bg: Bg): Promise<Shot> {
  return page.evaluate(
    async ({ presetId, seed, bg }) => {
      const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
      const { visualizerRegistry } = await import('/src/visualizers/index.ts');
      const { defaultCommonParams, defaultBackground, defaultComposition } = await import('/src/core/types.ts');
      const W = 320;
      const H = 180;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(W, H);
      if (bg) {
        // 背景の絵: 黒一色か、グラデーションと図形 (「写真」の代わり)。4:3 にして cover の切り取りも通す
        const src = document.createElement('canvas');
        src.width = 400;
        src.height = 300;
        const g = src.getContext('2d')!;
        if (bg.kind === 'black') {
          g.fillStyle = '#000';
          g.fillRect(0, 0, 400, 300);
        } else {
          const grad = g.createLinearGradient(0, 0, 400, 300);
          grad.addColorStop(0, '#2a3f7a');
          grad.addColorStop(1, '#c86a3a');
          g.fillStyle = grad;
          g.fillRect(0, 0, 400, 300);
          g.fillStyle = '#e8e0c0';
          g.beginPath();
          g.arc(260, 110, 60, 0, Math.PI * 2);
          g.fill();
        }
        const blob = await new Promise<Blob>((r) => src.toBlob((b) => r(b!), 'image/png'));
        const settings = { ...defaultBackground('bg.png', 'a'.repeat(64), 'image' as const), dim: bg.dim ?? 0 };
        await host.background.load(settings, blob);
        // ビジュアライザーの重ね方と濃さは、レイヤーの設定 (composition) に持つ
        host.composition = { ...defaultComposition(), visualizerBlend: bg.blend ?? 'screen', visualizerOpacity: bg.opacity ?? 1 };
      }
      const params = defaultCommonParams() as ReturnType<typeof defaultCommonParams> & Record<string, unknown>;
      await host.setPreset(visualizerRegistry.get(presetId)!, seed, params);
      for (let i = 0; i <= 90; i++) {
        const t = i / 60;
        const bp = (t % 0.5) / 0.5;
        const bands = new Float32Array(64);
        for (let b = 0; b < 64; b++) bands[b] = 0.2 + 0.5 * Math.exp(-bp * 6) * (b < 20 ? 1 : 0.4);
        host.render(
          { t, dt: 1 / 60, bass: 0.9 * Math.exp(-bp * 6), mid: 0.4, high: 0.5, rms: 0.4, peak: 0.5, beat: Math.exp(-bp * 5), beatIndex: Math.floor(t / 0.5), spectralEnergy: 0.4, flux: 0.2, bands },
          params,
        );
      }
      const url = canvas.toDataURL('image/png');
      const tmp = document.createElement('canvas');
      tmp.width = W;
      tmp.height = H;
      const g2 = tmp.getContext('2d')!;
      g2.drawImage(canvas, 0, 0);
      const d = g2.getImageData(0, 0, W, H).data;
      let sum = 0;
      const pixels: number[] = [];
      for (let i = 0; i < d.length; i += 4) {
        sum += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
        pixels.push(d[i]!, d[i + 1]!, d[i + 2]!);
      }
      host.dispose();
      canvas.remove();
      return { url, mean: sum / (W * H), pixels };
    },
    { presetId, seed, bg },
  );
}

function maxDiff(a: number[], b: number[]): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

for (const presetId of ['solar-gate', 'milky-way', 'live-stage']) {
  test(`背景 ${presetId}: 黒い背景 + スクリーン合成は背景なしとほぼ同じ、絵のある背景では変わり、同じ seed なら同じ`, async ({ page }) => {
    await page.goto('/');
    const none = await render(page, presetId, 20260927, null);
    const black = await render(page, presetId, 20260927, { kind: 'black' });
    // 同じ値を画面外に描いてから重ねるので、8bit に丸める前後の差 (±2) まで
    expect(maxDiff(none.pixels, black.pixels)).toBeLessThanOrEqual(2);
    const photo = await render(page, presetId, 20260927, { kind: 'photo', dim: 0.35 });
    const photo2 = await render(page, presetId, 20260927, { kind: 'photo', dim: 0.35 });
    expect(photo.url).toBe(photo2.url);
    expect(photo.mean).toBeGreaterThan(none.mean + 5);
    // 暗さを上げると暗くなる。「そのまま上に」(濃さ 1) は背景が見えない = 背景なしと同じ
    const darker = await render(page, presetId, 20260927, { kind: 'photo', dim: 0.8 });
    expect(darker.mean).toBeLessThan(photo.mean);
    const over = await render(page, presetId, 20260927, { kind: 'photo', blend: 'over', opacity: 1 });
    expect(maxDiff(none.pixels, over.pixels)).toBeLessThanOrEqual(2);
  });
}
