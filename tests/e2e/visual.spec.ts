import { expect, test, type Page } from '@playwright/test';

/**
 * 描画の E2E (docs/ARCHITECTURE.md「Verification」):
 * - Visualizer: プリセットごとに、合成した 120 BPM の音で決まった時刻まで描き、真っ黒でないこと・
 *   同じ seed なら同じ画像になること・seed が違えば違う画像になることを確かめる
 * - 歌詞モーション (同梱した JIZURA): 同じ seed なら同じ画像、透過で描けていること
 *
 * 開発サーバー (Vite) のモジュールをページの中で直接 import して、本物の VisualizerHost + PostFX で描く。
 * GPU の無い環境でも動くように、playwright.config.ts で SwiftShader を使っている。描画は遅いので小さめのサイズで描く。
 */

test.describe.configure({ timeout: 180_000 });

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page).toHaveTitle('ZUNZUN');
}

interface Shot {
  url: string;
  mean: number;
}

/** 合成した 120 BPM の音で、プリセットを seconds 秒まで描いた最後のコマ */
async function renderPreset(page: Page, presetId: string, seed: number, seconds: number): Promise<Shot> {
  return page.evaluate(
    async ({ presetId, seed, seconds }) => {
      const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
      const { visualizerRegistry } = await import('/src/visualizers/index.ts');
      const { defaultCommonParams } = await import('/src/core/types.ts');
      const mod = visualizerRegistry.get(presetId);
      if (!mod) throw new Error(`preset not found: ${presetId}`);
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 270;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(480, 270);
      const params = defaultCommonParams() as ReturnType<typeof defaultCommonParams> & Record<string, unknown>;
      await host.setPreset(mod, seed, params);
      const n = Math.round(seconds * 60);
      for (let i = 0; i <= n; i++) {
        const t = i / 60;
        const bp = (t % 0.5) / 0.5;
        const hat = Math.exp(-((t % 0.125) / 0.125) * 5);
        const bands = new Float32Array(64);
        for (let b = 0; b < 64; b++) bands[b] = 0.2 + 0.5 * Math.exp(-bp * 6) * (b < 20 ? 1 : 0.4);
        host.render(
          {
            t,
            dt: 1 / 60,
            bass: 0.9 * Math.exp(-bp * 6),
            mid: 0.4,
            high: 0.8 * hat,
            rms: 0.4,
            peak: 0.5,
            beat: Math.exp(-bp * 5),
            beatIndex: Math.floor(t / 0.5),
            spectralEnergy: 0.4,
            flux: 0.2,
            bands,
          },
          params,
        );
      }
      const url = canvas.toDataURL('image/png');
      const tmp = document.createElement('canvas');
      tmp.width = 480;
      tmp.height = 270;
      const g = tmp.getContext('2d')!;
      g.drawImage(canvas, 0, 0);
      const d = g.getImageData(0, 0, 480, 270).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      host.dispose();
      canvas.remove();
      return { url, mean: sum / (480 * 270) };
    },
    { presetId, seed, seconds },
  );
}

for (const presetId of ['solar-gate', 'milky-way', 'live-stage', 'speaker-rack']) {
  test(`Visualizer ${presetId}: 真っ黒でなく、同じ seed なら同じ画像、seed が違えば違う画像`, async ({ page }) => {
    await openApp(page);
    const a = await renderPreset(page, presetId, 20260927, 2.1);
    const b = await renderPreset(page, presetId, 20260927, 2.1);
    const c = await renderPreset(page, presetId, 12345, 2.1);
    expect(a.mean).toBeGreaterThan(3);
    expect(a.url).toBe(b.url);
    expect(a.url).not.toBe(c.url);
  });
}

test('歌詞モーション: 重ねるときに使う場面転換・レイアウトは、映像を覆い隠さない (JIZURA 更新時の見張り)', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const { buildJizuraProject, COVERING_LAYOUTS, COVERING_TRANSITIONS, keepLightTextSchemes, loadJizura } = await import(
      '/src/core/lyrics/jizura-adapter.ts'
    );
    const { defaultLyrics } = await import('/src/core/types.ts');
    const J = (await loadJizura()) as unknown as {
      order(group: string): string[];
      plan(p: Record<string, unknown>, a: null): Parameters<typeof keepLightTextSchemes>[0];
      Renderer: new () => { frame(ctx: CanvasRenderingContext2D, plan: unknown, t: number, o: Record<string, unknown>): void };
      lum(c: string): number;
      defaultProject(): Record<string, unknown> & { timing: Record<string, unknown> };
      cutAt(plan: unknown, t: number): { start: number } | null;
    };
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d')!;
    const covering: [string, number][] = [];
    /** 2 行目にだけ指定を当てて (JIZURA の行ごとの指定)、区間 [t0, t1) で画面の何割が不透明になるかの最大 */
    const maxCover = (override: Record<string, string>, t0: number, t1: number): number => {
      const lyrics = { ...defaultLyrics(), text: 'あいうえお\nかきくけこさしす', timing: { ...defaultLyrics().timing, lineTimes: { '0': 0.5, '1': 3 }, lineEnds: { '1': 6 } } };
      const project = buildJizuraProject(lyrics, J.defaultProject(), { seed: 1, aspect: '16:9', fps: 30 });
      project.overrides = { 1: override };
      const plan = keepLightTextSchemes(J.plan(project, null), (c) => J.lum(c));
      const r = new J.Renderer();
      let max = 0;
      for (let t = t0; t < t1; t += 0.1) {
        r.frame(ctx, plan, t, { scale: 160 / 1920, transparent: true, fast: true });
        const d = ctx.getImageData(0, 0, 160, 90).data;
        let op = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i]! > 200) op++;
        max = Math.max(max, op / (160 * 90));
      }
      return max;
    };
    // 場面転換: 切り替わりの前後で、画面の半分以上を覆わない
    const transitions = J.order('trans').filter((k) => !COVERING_TRANSITIONS.includes(k));
    for (const k of transitions) {
      const v = maxCover({ trans: k }, 2.4, 3.8);
      if (v > 0.5) covering.push([`trans:${k}`, v]);
    }
    // レイアウト: 場面転換を覆わないものに固定して、行の間に画面の 9 割以上を塗らない。
    // (COVERING_LAYOUTS は 8 割以上で決めたが、文字で埋める「wall」などは書体の読み込み具合で 8 割前後を行き来するので、
    //  見張りは背景ごと塗るものだけを確実に捕まえる 9 割にしている)
    const neutral = transitions[0]!;
    const layouts = J.order('layout').filter((k) => !COVERING_LAYOUTS.includes(k));
    for (const k of layouts) {
      const v = maxCover({ layout: k, trans: neutral }, 3.05, 5.9);
      if (v >= 0.9) covering.push([`layout:${k}`, v]);
    }
    const unknown = [
      ...COVERING_TRANSITIONS.filter((k) => !J.order('trans').includes(k)),
      ...COVERING_LAYOUTS.filter((k) => !J.order('layout').includes(k)),
    ];
    return { covering, unknown, checked: transitions.length + layouts.length };
  });
  // 新しく映像を覆うものが見つかったら、COVERING_TRANSITIONS / COVERING_LAYOUTS に足す
  expect(result.covering).toEqual([]);
  // 一覧にあるのに JIZURA に無い名前は、JIZURA 側で名前が変わった可能性がある
  expect(result.unknown).toEqual([]);
  expect(result.checked).toBeGreaterThan(100);
});

test('歌詞モーション (JIZURA): 透過で描け、同じ seed なら同じ画像、seed が違えば違う画像', async ({ page }) => {
  await openApp(page);
  const render = (seed: number) =>
    page.evaluate(async (seed) => {
      const { LyricMotion } = await import('/src/core/lyrics/jizura-adapter.ts');
      const { defaultLyrics } = await import('/src/core/types.ts');
      const lyrics = {
        ...defaultLyrics(),
        text: '夜明けの色を/覚えてる\nほどけた声が遠くで鳴った\n*透明*なままじゃ終われない!',
        timing: { ...defaultLyrics().timing, lineTimes: { '0': 0.5, '1': 3, '2': 5.5 }, lineEnds: { '2': 8 } },
      };
      const audio = { duration: 10, beats: Array.from({ length: 20 }, (_, i) => i * 0.5), energy: new Float32Array(600).fill(0.5), energyRate: 60 };
      // create() は書体の準備が終わってから返す (1 回目だけ別の書体で描かれることが無いように)
      const motion = await LyricMotion.create(lyrics, audio, { projectSeed: seed, width: 640, height: 360, fps: 30 });
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d')!;
      // 状態を持つ演出もあるので、決まった刻みで順に描いてから最後のコマを見る
      for (let t = 0; t <= 1.5; t += 1 / 30) motion.render(ctx, t);
      const d = ctx.getImageData(0, 0, 640, 360).data;
      let opaque = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) opaque++;
      return { url: canvas.toDataURL('image/png'), opaque: opaque / (640 * 360), lines: motion.plan.lines.map((l) => [l.start, l.end]) };
    }, seed);
  const a = await render(7);
  const b = await render(7);
  const c = await render(8);
  // 透過: 文字のあるところだけ不透明 (全面が塗られていない)
  expect(a.opaque).toBeGreaterThan(0.001);
  expect(a.opaque).toBeLessThan(0.9);
  expect(a.url).toBe(b.url);
  expect(a.url).not.toBe(c.url);
  // ZUNZUN で手で決めた開始・終了が、JIZURA のカット割りにそのまま使われている
  expect(a.lines[0]![0]).toBe(0.5);
  expect(a.lines[2]).toEqual([5.5, 8]);
});
