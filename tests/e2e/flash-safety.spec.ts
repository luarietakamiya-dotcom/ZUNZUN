import { expect, test, type Page } from '@playwright/test';

/**
 * 光過敏への配慮の見張り。ビジュアライザーを 1 コマずつ描いて、画面の明るさの急な変化を数える。
 * 「光った」とみなすのは、0.2 秒以内に画面の 25% 以上の画素が明るさ 0.1 以上 (相対輝度) 明るくなったとき
 * (光過敏のガイドライン「広い範囲 (画面の 1/4 程度) の明るさの大きな変化」に近い数え方。正式な検査の代わりではない)。
 * 1 秒あたり 3 回を超えないこと、真っ白に近い画素がずっと画面の大部分を覆わないことを確かめる。
 * 全プリセット (新しく足したらここにも足す) と、Live Stage の「光を客席へ」を強くしたカメラ位置いくつかで測る。
 * 画面は 160x90 (小さい画面でしか出ない明るさの暴れ (2026-09 に Live Stage の光の筋で見つかった) も拾える)。
 * 数えるのは、明るくなり始めた回 (光ったまま続く間は 1 回)。曲は 120 BPM の強い拍・低音で、いちばん光りやすい条件にする。
 */

test.describe.configure({ timeout: 300_000 });

const FPS = 30;
const SECONDS = 8;

async function measure(page: Page, preset: string, extra: Record<string, unknown>): Promise<{ flashesPerSecondMax: number; whiteMax: number; flashTimes: number[] }> {
  return page.evaluate(
    async ({ preset, extra, FPS, SECONDS }) => {
      const { VisualizerHost } = await import('/src/core/visualizer/host.ts');
      const { visualizerRegistry } = await import('/src/visualizers/index.ts');
      const { defaultCommonParams } = await import('/src/core/types.ts');
      const W = 160;
      const H = 90;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      document.body.appendChild(canvas);
      const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
      host.resize(W, H);
      const params = { ...defaultCommonParams(), intensity: 1, sensitivity: 1, ...extra } as ReturnType<typeof defaultCommonParams> & Record<string, unknown>;
      await host.setPreset(visualizerRegistry.get(preset)!, 20260927, params);
      const tmp = document.createElement('canvas');
      tmp.width = W;
      tmp.height = H;
      const tg = tmp.getContext('2d', { willReadFrequently: true })!;
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const history: Float32Array[] = [];
      const back = Math.round(0.2 * FPS);
      const flashTimes: number[] = [];
      let flashing = false;
      let whiteMax = 0;
      for (let i = 0; i < FPS * SECONDS; i++) {
        const t = i / FPS;
        const bp = (t % 0.5) / 0.5;
        const bands = new Float32Array(64).fill(0.5);
        host.render(
          { t, dt: 1 / FPS, bass: Math.exp(-bp * 5), mid: 0.6, high: 0.8, rms: 0.6, peak: 0.8, beat: Math.exp(-bp * 5), beatIndex: Math.floor(t / 0.5), spectralEnergy: 0.6, flux: 0.5, bands },
          params,
        );
        tg.drawImage(canvas, 0, 0);
        const d = tg.getImageData(0, 0, W, H).data;
        const lum = new Float32Array(W * H);
        let white = 0;
        for (let k = 0; k < lum.length; k++) {
          lum[k] = 0.2126 * lin(d[k * 4]!) + 0.7152 * lin(d[k * 4 + 1]!) + 0.0722 * lin(d[k * 4 + 2]!);
          if (lum[k]! > 0.85) white++;
        }
        whiteMax = Math.max(whiteMax, white / lum.length);
        // 0.2 秒前のどのコマと比べても、25% 以上の画素が 0.1 以上明るくなったか
        let flash = false;
        for (const prev of history) {
          let up = 0;
          for (let k = 0; k < lum.length; k++) if (lum[k]! - prev[k]! >= 0.1) up++;
          if (up / lum.length >= 0.25) {
            flash = true;
            break;
          }
        }
        if (flash && !flashing) flashTimes.push(t);
        flashing = flash;
        history.push(lum);
        if (history.length > back) history.shift();
      }
      host.dispose();
      canvas.remove();
      // どの 1 秒の間にも、光った回数が何回あるか (いちばん多いところ)
      let flashesPerSecondMax = 0;
      for (const t0 of flashTimes) flashesPerSecondMax = Math.max(flashesPerSecondMax, flashTimes.filter((t) => t >= t0 && t < t0 + 1).length);
      return { flashesPerSecondMax, whiteMax, flashTimes };
    },
    { preset, extra, FPS, SECONDS },
  );
}

const CASES: [string, Record<string, unknown>][] = [
  ['solar-gate', {}],
  ['speaker-cone', {}],
  ['spectrum-wave', {}],
  ['spectrum-wave', { height: 1, ribbons: 1, fill: 1, mirror: 1 }],
  ['edge-equalizer', {}],
  ['edge-equalizer', { length: 1.5, style: 'led', peaks: 1, pulse: 1 }],
  ['speaker-mega', {}],
  ['speaker-mega', { size: 1.6, rays: 1, equalizer: 1, waves: 1, rainbow: 1 }],
  ['speaker-twin', {}],
  ['speaker-twin', { size: 1.3, spacing: 1, alternate: 1, strip: 1 }],
  ['ripples', {}],
  ['ripples', { amount: 1, speed: 1, size: 1.5 }],
  ['speaker-cone', { size: 1.4, equalizer: 1, waves: 1 }],
  ['milky-way', {}],
  ['_debug-bars', {}],
  ['speaker-rack', {}],
  ['speaker-rack', { framing: 'closeup' }],
  ['speaker-rack', { layout: 'alley' }],
  ['photo-motion', { photo: 'speaker-rack' }],
  ['photo-motion', { photo: 'speaker-rack-lit' }],
  ['photo-motion', { photo: 'stage-lights' }],
  ['photo-motion', { photo: 'speaker-alley' }],
  ['photo-motion', { photo: 'rack-parts' }],
  ['photo-motion', { photo: 'alley-lights' }],
  ['city-scroll', { scene: 'neon-night', sparkle: 1, particles: 'lights', particleAmount: 1 }],
  ['city-scroll', { scene: 'all', sparkle: 1, speed: 1 }],
  ['cyber-space', { scene: 'neon-gate', neon: 1, rings: 1, zoom: 1, warp: 1, rgbSplit: 1 }],
  ['cyber-space', { scene: 'crystal-void', neon: 1, rings: 1, zoom: 1, warp: 1 }],
  ['cyber-space', { scene: 'sky-hall', neon: 1, rings: 1, zoom: 1, warp: 1, colorShift: 1 }],
  ['cyber-space', { scene: 'neon-gate', neon: 1, chase: 1, sweep: 1, colorBeat: 1, flicker: 1 }],
  ['cyber-space', { scene: 'sky-hall', neon: 1, chase: 1, sweep: 1, colorBeat: 1, flicker: 1 }],
  ['live-stage', {}],
  ['live-stage', { towardCrowd: 1 }],
  ['live-stage', { towardCrowd: 1, cameraSpot: 'front' }],
  ['live-stage', { towardCrowd: 1, cameraSpot: 'side' }],
  ['live-stage', { stageSet: 'band' }],
  ['live-stage', { stageSet: 'band', towardCrowd: 1 }],
  ['live-stage', { stageSet: 'band', towardCrowd: 1, cameraSpot: 'front' }],
];

for (const [preset, extra] of CASES) {
  test(`光過敏への配慮: ${preset} ${JSON.stringify(extra)} — 広い範囲が急に明るくなるのは毎秒 3 回まで、真っ白が画面を覆わない`, async ({ page }) => {
    await page.goto('/');
    const r = await measure(page, preset, extra);
    expect(r.flashesPerSecondMax, `flashes at ${r.flashTimes.map((t) => t.toFixed(2)).join(', ')}`).toBeLessThanOrEqual(3);
    expect(r.whiteMax).toBeLessThan(0.25);
  });
}
