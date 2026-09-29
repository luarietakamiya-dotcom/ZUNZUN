import { expect, test, type Page } from '@playwright/test';

/**
 * オリジナルの歌詞モーション (演出パック、src/core/lyrics/packs/) の E2E。本物の JIZURA で描く。
 * - 5 つのスタイルとも、同じ seed なら同じ画像になり、何かが描かれている。
 *   比べるときは書き出しと同じく「作る → 最初から順に描く」を 1 つずつ行う (交互に描いたり時刻を行き来すると、
 *   つなぎのために覚えた直前のコマが違うので、既存のスタイルでも一致しない)。
 * - 決定論の直し (jizura-adapter の installGlyphIdPatch) の見張り: ノワールを 3 回作って描き、最初の 1 回から全部一致する。
 *   直す前は、文字の破片の形が作るたびに変わり、232 コマ中 9 コマが違った
 * - 「衝撃」は、一度描いて温めてから 2 回を比べる (ページを開いて最初の 1 回だけ 1 コマ違うことがある。
 *   JIZURA の内側の作業用 canvas が途中で大きくなるときの初期化が原因と思われ、アダプタからは消せない。docs/HANDOFF.md)
 * - 余白 (動画に寄り添う): 画面の中央 (横 50%・縦 40%) をほぼ空け、画面全体もほとんど覆わない
 */

test.describe.configure({ timeout: 240_000 });

// 歌詞モーションは 2D canvas だけで描くので、WebGL 用の SwiftShader の設定 (playwright.config.ts) を外して起動する。
// SwiftShader の設定のままだと、ぼかしや影 (「余白」が常に使う) の描画が描くたびに少し変わり、同じ seed でも一致しなかった
// (2026-09-30。ノワールは一致した)。PW_CHROMIUM は、同梱の Chromium の場所を指定したいときだけ使う (クラウドの試験環境など)
test.use({ launchOptions: { args: [], ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) } });

const LINES = ['夜明けの色を/覚えてる', 'ほどけた声が/遠くで鳴った', '静かな/部屋に', '月の光が/落ちてくる', 'ねえ/まだ/間に合うかな', '消えないように'];

async function measure(page: Page, style: string, warmUp: boolean): Promise<{ same: boolean; drawn: number; centerMax: number; centerMean: number; allMax: number }> {
  return page.evaluate(
    async ({ style, LINES, warmUp }) => {
      const A = await import('/src/core/lyrics/jizura-adapter.ts');
      const { defaultLyrics } = await import('/src/core/types.ts');
      const lyrics = {
        ...defaultLyrics(),
        text: LINES.join('\n'),
        motion: { ...defaultLyrics().motion, style },
        timing: { ...defaultLyrics().timing, lineTimes: Object.fromEntries(LINES.map((_, i) => [String(i), 1 + i * 2.5])) },
      };
      const analysis = { duration: 17, beats: Array.from({ length: 36 }, (_, i) => i * 0.47), rms: new Float32Array(17 * 60).fill(0.3), frameRate: 60 };
      const make = () => A.LyricMotion.create(lyrics, A.buildJizuraAudio(analysis, null), { projectSeed: 11, width: 640, height: 360, fps: 30 });
      const W = 320;
      const H = 180;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d')!;
      const frame = (m: typeof m2, t: number): Uint8ClampedArray => {
        g.clearRect(0, 0, W, H);
        m.render(g, t);
        return g.getImageData(0, 0, W, H).data;
      };
      const times: number[] = [];
      for (let t = 0.6; t < 16; t += 0.1) times.push(t);
      // 書き出しと同じく、それぞれを最初から順に描く
      if (warmUp) {
        const m0 = await make();
        for (const t of times) frame(m0, t);
      }
      const m2 = await make();
      const second = times.map((t) => frame(m2, t).slice());
      const m1 = await make();
      let same = true;
      let drawn = 0;
      let centerMax = 0;
      let centerSum = 0;
      let allMax = 0;
      let n = 0;
      for (const [k, t] of times.entries()) {
        const a = frame(m1, t);
        const b = second[k]!;
        let cen = 0;
        let all = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (a[i + 3] !== b[i + 3] || a[i] !== b[i]) same = false;
          if (a[i + 3]! > 25) {
            all++;
            const p = i / 4;
            const x = p % W;
            const y = Math.floor(p / W);
            if (x > W * 0.25 && x < W * 0.75 && y > H * 0.3 && y < H * 0.7) cen++;
          }
        }
        const cf = cen / (W * 0.5 * H * 0.4);
        centerMax = Math.max(centerMax, cf);
        centerSum += cf;
        allMax = Math.max(allMax, all / (W * H));
        drawn += all;
        n++;
      }
      return { same, drawn, centerMax, centerMean: centerSum / n, allMax };
    },
    { style, LINES, warmUp },
  );
}

test('決定論: ノワールを作って描くのを 3 回くり返すと、最初の 1 回から全部同じ画像になる (文字の破片の番号の直し)', async ({ page }) => {
  await page.goto('/');
  // measure は 2 回作って比べるので、それを 2 回 (= 3 回以上作る) 行う
  expect((await measure(page, 'noir', false)).same).toBe(true);
  expect((await measure(page, 'noir', false)).same).toBe(true);
});

for (const style of ['zz-calm', 'zz-intense', 'zz-rock', 'zz-pop', 'zz-cinema']) {
  test(`演出パック ${style}: 同じ seed なら同じ画像で、何かが描かれている`, async ({ page }) => {
    await page.goto('/');
    // 温め直しは「衝撃」だけ (ページを開いて最初の 1 回だけ 1 コマ違うことがあるため)
    const r = await measure(page, style, style === 'zz-intense');
    expect(r.same).toBe(true);
    expect(r.drawn).toBeGreaterThan(1000);
    if (style === 'zz-cinema') {
      // 動画の見せ場 (中央) をほぼ空け、画面全体もほとんど覆わない
      expect(r.centerMean).toBeLessThan(0.02);
      expect(r.centerMax).toBeLessThan(0.15);
      expect(r.allMax).toBeLessThan(0.06);
    }
  });
}
