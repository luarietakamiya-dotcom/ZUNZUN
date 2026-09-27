/**
 * ブラウザの Web Audio API に依存するデコード処理。
 * jsdom には AudioContext が無いため、ここは単体テスト (Vitest) の対象外とし、
 * ロジックは analyze.ts / timeline.ts 側に寄せている。動作確認は Playwright (E2E) で行う。
 */

export interface DecodedAudio {
  /** 参照用の生ファイル */
  file: File;
  /** 元の AudioBuffer (再生に使う) */
  audioBuffer: AudioBuffer;
  /** チャンネル平均を取ったモノラル PCM (-1..1) */
  mono: Float32Array;
  sampleRate: number;
  duration: number;
}

/** File (音源) をデコードし、再生用の AudioBuffer と解析用のモノラル PCM を返す。 */
export async function decodeAudioFile(file: File): Promise<DecodedAudio> {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error('この環境は Web Audio API (AudioContext) に対応していません');
  const ac = new AC();
  let audioBuffer: AudioBuffer;
  try {
    const arrayBuffer = await file.arrayBuffer();
    audioBuffer = await ac.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    try {
      await ac.close();
    } catch {
      // 一部ブラウザでは close() が既に呼ばれていると例外を投げるが、無視してよい
    }
  }

  const { sampleRate, length, numberOfChannels, duration } = audioBuffer;
  const mono = new Float32Array(length);
  for (let c = 0; c < numberOfChannels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i]! += data[i]! / numberOfChannels;
  }

  return { file, audioBuffer, mono, sampleRate, duration };
}
