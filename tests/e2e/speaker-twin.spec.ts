import { expect, test } from '@playwright/test';

/**
 * Twin Speakers (背景の絵に重ねる前提の、スピーカー 2 台のエフェクト。2026-10-03 ユーザー要望) の E2E。本物の VisualizerHost + PostFX で描く。
 * - シェーダーのエラー (コンパイル失敗など) が出ない (実際に起きた: GLSL の予約語 half を変数名にして、真っ黒になった)
 * - 映る・左右の両方に映る・同じ入力なら同じ絵・強く鳴る側が替わると絵が変わる
 * - 背景の絵に「スクリーン」で重ねると、絵は見えたまま、光だけが乗る
 */

test.describe.configure({ timeout: 120_000 });

test('Twin Speakers: シェーダーのエラーなく、左右の両方に映り、同じ入力なら同じ絵。拍で強い側が替わると絵が変わる。背景に光だけが乗る', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text().slice(0, 300));
  });
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
    const { visualizerRegistry } = await import('/src/visualizers/index.ts');
    const { defaultCommonParams, defaultBackground } = await import('/src/core/types.ts');
    const W = 160;
    const H = 90;
    const shot = async (beatIndex: number, withBackground: boolean): Promise<Uint8ClampedArray> => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(W, H);
      const params = { ...defaultCommonParams(), alternate: 1 } as ReturnType<typeof defaultCommonParams> & Record<string, unknown>;
      await host.setPreset(visualizerRegistry.get('speaker-twin')!, 1, params);
      if (withBackground) {
        const src = document.createElement('canvas');
        src.width = 64;
        src.height = 36;
        const g = src.getContext('2d')!;
        g.fillStyle = '#006400';
        g.fillRect(0, 0, 64, 36);
        const blob = await new Promise<Blob>((res) => src.toBlob((b) => res(b!), 'image/png'));
        await host.background.load({ ...defaultBackground('g.png', 'a'.repeat(64), 'image'), dim: 0 }, new File([blob], 'g.png', { type: 'image/png' }));
      }
      for (let i = 0; i < 40; i++) {
        host.render({ t: i / 30, dt: 1 / 30, bass: 0.9, mid: 0.3, high: 0.6, rms: 0.5, peak: 0.4, beat: 0.5, beatIndex, spectralEnergy: 0.3, flux: 0.2, bands: new Float32Array(64).fill(0.5) }, params);
      }
      const tmp = document.createElement('canvas');
      tmp.width = W;
      tmp.height = H;
      const tg = tmp.getContext('2d', { willReadFrequently: true })!;
      tg.drawImage(canvas, 0, 0);
      const d = tg.getImageData(0, 0, W, H).data;
      host.dispose();
      canvas.remove();
      return d;
    };
    /** 画面の左半分・右半分の、明るさの平均 */
    const halves = (d: Uint8ClampedArray): [number, number] => {
      let l = 0;
      let rr = 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const v = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
          if (x < W / 2) l += v;
          else rr += v;
        }
      return [l / ((W / 2) * H), rr / ((W / 2) * H)];
    };
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let s = 0;
      for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
      return s / (a.length / 4);
    };
    const even = await shot(0, false);
    const even2 = await shot(0, false);
    const odd = await shot(1, false);
    const onBg = await shot(0, true);
    let brighter = 0;
    let kept = 0;
    for (let i = 0; i < onBg.length; i += 4) {
      const sum = onBg[i]! + onBg[i + 1]! + onBg[i + 2]!;
      if (sum > 100 + 100) brighter++;
      if (onBg[i]! < 20 && onBg[i + 1]! > 80 && onBg[i + 1]! < 120) kept++;
    }
    return { halvesEven: halves(even), halvesOdd: halves(odd), same: diff(even, even2), changed: diff(even, odd), brighter: brighter / (W * H), kept: kept / (W * H) };
  });
  expect(errors).toEqual([]);
  // 左右の両方に映る
  expect(r.halvesEven[0]).toBeGreaterThan(1);
  expect(r.halvesEven[1]).toBeGreaterThan(1);
  expect(r.same).toBe(0);
  // 偶数拍 = 左が強い、奇数拍 = 右が強い (左右の明るさの大小が入れ替わる)
  expect(r.halvesEven[0] - r.halvesEven[1]).toBeGreaterThan(r.halvesOdd[0] - r.halvesOdd[1]);
  expect(r.changed).toBeGreaterThan(0.3);
  expect(r.brighter).toBeGreaterThan(0.01);
  expect(r.kept).toBeGreaterThan(0.3);
});
