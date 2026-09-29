import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny';
import type { AudioAnalysis } from '../audio/analyze';
import type { AudioTimeline } from '../audio/timeline';
import { buildJizuraAudio, LyricMotion, motionRhythmGrid } from '../lyrics/jizura-adapter';
import { wantsMotion } from '../lyrics/motion-provider';
import type { CommonParams, ExportSettings, LyricsSettings, OverlayLayer, RhythmSettings } from '../types';
import { VisualizerHost } from '../visualizer/host';
import type { VisualizerModule } from '../visualizer/registry';
import { prepareAudioForEncode, sliceAudioBuffer } from './audio-prep';
import type { ExportResult, ExportRunContext } from './controller';
import { evenDimension, frameTimestamp, qualityLevel, totalFrameCount } from './plan';

/** renderMp4 に渡す、書き出し開始時点のスナップショット。store には依存しない。 */
export interface Mp4ExportJob {
  width: number;
  height: number;
  fps: number;
  quality: ExportSettings['quality'];
  audioBuffer: AudioBuffer;
  timeline: AudioTimeline;
  preset: VisualizerModule;
  seed: number;
  params: CommonParams & Record<string, unknown>;
  overlays: { config: OverlayLayer; file: File }[];
  /** 歌詞と歌詞モーションの設定 (歌詞を使わなければ null) */
  lyrics: LyricsSettings | null;
  /** 歌詞モーションに渡すビート・音量の元 (プレビューと同じ解析結果) */
  analysis: AudioAnalysis | null;
  /** 小節と拍子 (変拍子モードがオンのときだけ歌詞モーションに使う。省略 = 使わない) */
  rhythm?: RhythmSettings | null;
  fileName: string;
}

// NOTE: Mediabunny の新しい版では `bitrate` / QUALITY_* 定数は非推奨 (`quality: new Quality('high')` 推奨) だが、
// package.json は ^1.0.0 指定で、ローカルにどの 1.x が入っているかこのセッションからは確認できない。
// `bitrate: QUALITY_*` は 1.x のどの版でも型が通る書き方なので、あえてこちらを使っている。
// ロックファイルで版を固定したら `quality: new Quality(...)` へ置き換えてよい。
const QUALITY = {
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  'very-high': QUALITY_VERY_HIGH,
} as const;

/** 音声は 1 秒ずつ、映像より少し先行させて渡す (トラック間のインターリーブをエンコーダ任せにしない)。 */
const AUDIO_CHUNK_SEC = 1;
const AUDIO_LEAD_SEC = 1;
/** 何フレームごとに一度メインスレッドを明け渡して、進捗表示などの UI 更新を通すか */
const YIELD_EVERY_FRAMES = 8;

function abortError(): DOMException {
  return new DOMException('書き出しがキャンセルされました', 'AbortError');
}

/**
 * プレビューと同じ AudioTimeline・同じ VisualizerHost (プリセット + PostFX + オーバーレイ) を、
 * 実時間ではなく 1/fps 刻みの固定時刻で回して MP4 (H.264 + AAC) に書き出す。
 * docs/ARCHITECTURE.md の「解析は事前 (offline)、描画は時刻駆動」の書き出し側。
 *
 * 映像は専用の (DOM に載せない) canvas に書き出しサイズぴったりで描く。
 * プレビュー用の canvas とは別の WebGL コンテキストなので、プレビューの表示には影響しない。
 */
export async function renderMp4(job: Mp4ExportJob, ctx: ExportRunContext): Promise<ExportResult> {
  const { signal, onProgress } = ctx;
  const width = evenDimension(job.width);
  const height = evenDimension(job.height);
  const fps = job.fps;
  const quality = QUALITY[qualityLevel(job.quality)];

  if (!(await canEncodeVideo('avc', { width, height, bitrate: quality }))) {
    throw new Error(`このブラウザでは ${width}×${height} の H.264 エンコードができません。サイズを下げるか Chrome/Edge を使ってください。`);
  }

  const audio = await prepareAudioForEncode(job.audioBuffer);
  const audioOpts = { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate, bitrate: quality };
  // AAC を優先。AAC エンコーダが無い環境 (一部の Linux 版 Chromium など) では Opus にフォールバックする
  const audioCodec = (await canEncodeAudio('aac', audioOpts))
    ? ('aac' as const)
    : (await canEncodeAudio('opus', audioOpts))
      ? ('opus' as const)
      : null;
  if (!audioCodec) throw new Error('このブラウザでは音声 (AAC/Opus) のエンコードができません。Chrome/Edge を使ってください。');
  if (signal.aborted) throw abortError();

  const canvas = document.createElement('canvas');
  const host = new VisualizerHost(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  let started = false;

  try {
    host.resize(width, height);
    await host.setPreset(job.preset, job.seed, job.params);
    await host.overlay.loadFrom(job.overlays);
    // 歌詞モーション: 書き出し開始時の設定で作る (プレビューと同じ seed・時刻・設定なので同じ絵になる。書き出しは軽い描画を使わない)
    const lyricReq = { lyrics: job.lyrics, analysis: job.analysis, projectSeed: job.seed, width, height, fps };
    if (wantsMotion(lyricReq)) {
      const rhythm = motionRhythmGrid(job.rhythm);
      host.lyrics.setMotion(
        await LyricMotion.create(lyricReq.lyrics, job.analysis ? buildJizuraAudio(job.analysis, rhythm) : null, { projectSeed: job.seed, width, height, fps, rhythm }),
      );
    }
    if (signal.aborted) throw abortError();

    const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: quality });
    const audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: quality });
    output.addVideoTrack(videoSource, { frameRate: fps });
    output.addAudioTrack(audioSource);
    await output.start();
    started = true;

    // 音声はサンプル数 (整数) で管理し、1 秒単位の切り出しを繰り返しても誤差が積もらないようにする
    const totalSamples = audio.length;
    const chunkSamples = Math.max(1, Math.round(AUDIO_CHUNK_SEC * audio.sampleRate));
    let samplesAdded = 0;
    const addAudioUntil = async (tSec: number): Promise<void> => {
      const targetSample = Math.min(totalSamples, Math.ceil(tSec * audio.sampleRate));
      while (samplesAdded < targetSample) {
        const end = Math.min(totalSamples, samplesAdded + chunkSamples);
        await audioSource.add(sliceAudioBuffer(audio, samplesAdded, end));
        samplesAdded = end;
      }
    };

    const total = totalFrameCount(job.timeline.duration, fps);
    const frameDuration = 1 / fps;
    onProgress(0, total);

    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw abortError();
      const t = frameTimestamp(i, fps);
      await addAudioUntil(t + AUDIO_LEAD_SEC);

      const frame = job.timeline.at(t, Math.max(0, t - frameDuration));
      host.render(frame, job.params);
      await videoSource.add(t, frameDuration);

      onProgress(i + 1, total);
      if ((i + 1) % YIELD_EVERY_FRAMES === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    await addAudioUntil(Number.POSITIVE_INFINITY);
    if (signal.aborted) throw abortError();

    await output.finalize();
    const buffer = target.buffer;
    if (!buffer) throw new Error('MP4 の生成に失敗しました (出力バッファが空です)');

    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      fileName: job.fileName,
      videoCodec: 'H.264',
      audioCodec: audioCodec === 'aac' ? 'AAC' : 'Opus',
      frames: total,
    };
  } catch (err) {
    if (started) {
      try {
        await output.cancel();
      } catch {
        // すでに終了/キャンセル済みなら無視する
      }
    }
    throw err;
  } finally {
    host.dispose();
  }
}
