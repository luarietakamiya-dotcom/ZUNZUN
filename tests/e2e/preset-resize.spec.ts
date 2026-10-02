import { expect, test } from '@playwright/test';

/**
 * プリセットの準備 (init) の途中で画面の大きさが変わっても、準備が終わったあとのプリセットは今の大きさで描く。
 * 2026-10-02 ユーザー報告「写真に動きが、他のタブに行って戻ると (拡大されて) こうなる」の再発防止。
 */

test('準備の途中で大きさが変わっても、終わったあとは今の大きさ (写真に動き・流れる街並み・サイバー空間)', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
    const { visualizerRegistry } = await import('/src/visualizers/index.ts');
    const { defaultCommonParams } = await import('/src/core/types.ts');
    const out: Record<string, number> = {};
    for (const id of ['photo-motion', 'city-scroll', 'cyber-space']) {
      const canvas = document.createElement('canvas');
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1 });
      // 作った直後は仮の大きさ (正方形)。絵を読んでいる間に、本当の大きさ (16:9) が決まる
      host.resize(300, 300);
      const ready = host.setPreset(visualizerRegistry.get(id)!, 1, { ...defaultCommonParams() });
      host.resize(640, 360);
      await ready;
      const preset = (host as unknown as { current: { preset: { aspect: number } } }).current.preset;
      out[id] = preset.aspect;
      host.dispose();
      canvas.remove();
    }
    return out;
  });
  for (const [id, aspect] of Object.entries(r)) expect(aspect, id).toBeCloseTo(640 / 360, 5);
});

test('「ビジュアライザー」タブを開き直しても、写真に動きの見え方は最初と同じ (拡大されない)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zunzun.lang', 'en'));
  await page.goto('/');
  // カメラのゆっくりした動きを止めて、時間で絵が変わらないようにする
  await page.evaluate(async () => (await import('/src/core/store.ts')).store.setParam('cameraMotion', 0));
  await page.getByRole('tab', { name: 'Visualizer' }).click();
  await page.locator('section.panel select').first().selectOption('photo-motion');
  await page.waitForTimeout(2500);
  const shot = async (): Promise<Buffer> => page.locator('.visualizer-canvas').screenshot();
  const first = await shot();
  const diffTo = async (b: Buffer): Promise<number> =>
    page.evaluate(
      async ([a, b]) => {
        const load = async (s: string) => {
          const i = new Image();
          i.src = s;
          await i.decode();
          return i;
        };
        const A = await load(a!);
        const B = await load(b!);
        const c = document.createElement('canvas');
        c.width = A.width;
        c.height = A.height;
        const g = c.getContext('2d')!;
        g.drawImage(A, 0, 0);
        const da = g.getImageData(0, 0, c.width, c.height).data;
        g.drawImage(B, 0, 0, c.width, c.height);
        const db = g.getImageData(0, 0, c.width, c.height).data;
        let s = 0;
        for (let k = 0; k < da.length; k += 4) s += Math.abs(da[k]! - db[k]!) + Math.abs(da[k + 1]! - db[k + 1]!) + Math.abs(da[k + 2]! - db[k + 2]!);
        return s / (da.length / 4) / 3;
      },
      ['data:image/png;base64,' + first.toString('base64'), 'data:image/png;base64,' + b.toString('base64')],
    );
  for (const other of ['Music', 'Overlay']) {
    await page.getByRole('tab', { name: other }).click();
    await page.waitForTimeout(500);
    await page.getByRole('tab', { name: 'Visualizer' }).click();
    await page.waitForTimeout(2500);
    expect(await diffTo(await shot()), other).toBeLessThan(6);
  }
});
