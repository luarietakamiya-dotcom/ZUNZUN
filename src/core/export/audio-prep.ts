/**
 * 書き出し用の音声の下ごしらえ (ブラウザ API 依存のため Vitest の対象外)。
 *
 * AAC エンコーダ (WebCodecs) が確実に受け付けるのは 44.1kHz / 48kHz・2ch 以下なので、
 * それ以外 (96kHz のハイレゾ音源、5.1ch など) は OfflineAudioContext で 48kHz・最大 2ch に
 * 変換してから渡す。追加の依存は不要 (Web Audio API 標準の機能だけで行う)。
 */

const ENCODER_FRIENDLY_RATES = [44100, 48000];
const FALLBACK_RATE = 48000;

export async function prepareAudioForEncode(buffer: AudioBuffer): Promise<AudioBuffer> {
  if (ENCODER_FRIENDLY_RATES.includes(buffer.sampleRate) && buffer.numberOfChannels <= 2) return buffer;

  const channels = Math.min(2, buffer.numberOfChannels);
  const length = Math.max(1, Math.ceil(buffer.duration * FALLBACK_RATE));
  const ctx = new OfflineAudioContext(channels, length, FALLBACK_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

/**
 * AudioBuffer の [startSample, endSample) を切り出した新しい AudioBuffer を作る。
 * 音声を少しずつ (映像フレームと交互に) エンコーダへ渡すために使う。
 */
export function sliceAudioBuffer(src: AudioBuffer, startSample: number, endSample: number): AudioBuffer {
  const start = Math.max(0, Math.min(src.length, Math.floor(startSample)));
  const end = Math.max(start + 1, Math.min(src.length, Math.floor(endSample)));
  const out = new AudioBuffer({ length: end - start, numberOfChannels: src.numberOfChannels, sampleRate: src.sampleRate });
  for (let c = 0; c < src.numberOfChannels; c++) {
    out.copyToChannel(src.getChannelData(c).subarray(start, end), c);
  }
  return out;
}
