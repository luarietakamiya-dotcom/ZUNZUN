import { expect, test } from '@playwright/test';

/**
 * 書き出しの E2E (docs/ARCHITECTURE.md「Verification」: 3 秒の MP4 を書き出し、長さとフレーム数を確認)。
 * 合成した 3 秒の音 + Live Stage + 歌詞モーションで書き出し、書き出したファイルを Mediabunny で読み直して、
 * 長さ・フレーム数・大きさを確かめる。H.264 を書き出せないブラウザ (一部のヘッドレス Chromium) ではスキップする。
 */

test.describe.configure({ timeout: 180_000 });

test('3 秒の MP4 (Live Stage + 歌詞モーション) を書き出すと、長さ 3 秒・90 フレーム・指定の大きさになる', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { renderMp4 } = await import('/src/core/export/mp4.ts');
    const { canEncodeVideo, Input, BlobSource, ALL_FORMATS } = await import(
      performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/deps/mediabunny')) ?? 'mediabunny'
    );
    if (!(await canEncodeVideo('avc', { width: 640, height: 360, bitrate: 1_000_000 }))) return { skipped: 'H.264 を書き出せないブラウザ' };
    const { analyzeSamples } = await import('/src/core/audio/analyze.ts');
    const { AudioTimeline } = await import('/src/core/audio/timeline.ts');
    const { visualizerRegistry } = await import('/src/visualizers/index.ts');
    const { defaultCommonParams, defaultLyrics } = await import('/src/core/types.ts');
    const sr = 48000;
    const n = sr * 3;
    const buf = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr });
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const bp = (t % 0.5) / 0.5;
      const v = 0.5 * Math.exp(-bp * 12) * Math.sin(2 * Math.PI * 55 * t) + (t > 0.8 ? 0.2 * Math.sin(2 * Math.PI * 800 * t) : 0);
      L[i] = R[i] = v * 0.6;
    }
    const analysis = analyzeSamples(L, sr);
    const lyrics = {
      ...defaultLyrics(),
      text: '夜明けの色を/覚えてる\nほどけた声が',
      timing: { ...defaultLyrics().timing, lineTimes: { '0': 0.3, '1': 1.6 }, lineEnds: { '1': 2.9 } },
    };
    const out = await renderMp4(
      {
        width: 640,
        height: 360,
        fps: 30,
        quality: 'draft',
        audioBuffer: buf,
        timeline: new AudioTimeline(analysis),
        preset: visualizerRegistry.get('live-stage')!,
        seed: 20260927,
        params: defaultCommonParams() as ReturnType<typeof defaultCommonParams> & Record<string, unknown>,
        overlays: [],
        lyrics,
        analysis,
        fileName: 'e2e.mp4',
      },
      { signal: new AbortController().signal, onProgress: () => {} },
    );
    const input = new Input({ source: new BlobSource(out.blob), formats: ALL_FORMATS });
    const video = await input.getPrimaryVideoTrack();
    const stats = await video!.computePacketStats();
    return {
      frames: out.frames,
      packets: stats.packetCount,
      duration: await input.computeDuration(),
      width: video!.displayWidth,
      height: video!.displayHeight,
      audio: out.audioCodec,
    };
  });
  test.skip('skipped' in result, 'skipped' in result ? String(result.skipped) : '');
  if ('skipped' in result) return;
  expect(result.frames).toBe(90);
  expect(result.packets).toBe(90);
  expect(result.duration).toBeGreaterThan(2.95);
  expect(result.duration).toBeLessThan(3.1);
  expect([result.width, result.height]).toEqual([640, 360]);
  expect(['AAC', 'Opus']).toContain(result.audio);
});
