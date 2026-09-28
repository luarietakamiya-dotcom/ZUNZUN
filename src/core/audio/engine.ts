import type { AudioFrame } from '../types';
import { sha256Hex } from '../hash';
import { analyzeSamples, type AnalyzeOptions, type AudioAnalysis } from './analyze';
import { decodeAudioFile } from './decode';
import { AudioPlayer } from './player';
import { AudioTimeline } from './timeline';

/**
 * core/audio のまとめ役。responsibility は docs/ARCHITECTURE.md の
 * 「デコード、オフライン特徴抽出、BPM・ビートグリッド、再生と時刻の管理」に対応する。
 *
 * UI 側は load() のあと、毎フレーム currentFrame() を読んで Visualizer / Overlay に渡す。
 * 書き出し (Step 7) は再生せず、timeline.at(t) を fps 刻みで直接呼ぶ。
 */
export class AudioEngine {
  private _analysis: AudioAnalysis | null = null;
  private _timeline: AudioTimeline | null = null;
  private _player: AudioPlayer | null = null;
  private _audioBuffer: AudioBuffer | null = null;
  private _fileName = '';
  private _sha256 = '';
  private _lastT = 0;

  get isLoaded(): boolean {
    return this._timeline != null;
  }

  get analysis(): AudioAnalysis | null {
    return this._analysis;
  }

  get timeline(): AudioTimeline | null {
    return this._timeline;
  }

  /** デコード済みの音声 (書き出し時に音声トラックとしてエンコードする元データ)。 */
  get audioBuffer(): AudioBuffer | null {
    return this._audioBuffer;
  }

  get fileName(): string {
    return this._fileName;
  }

  /** Project JSON の audio.sha256 用。読み込み直したファイルが同じものかの照合に使う */
  get sha256(): string {
    return this._sha256;
  }

  get sampleRate(): number {
    return this._analysis?.sampleRate ?? 0;
  }

  get duration(): number {
    return this._timeline?.duration ?? 0;
  }

  get bpm(): number {
    return this._timeline?.bpm ?? 0;
  }

  get isPlaying(): boolean {
    return this._player?.isPlaying ?? false;
  }

  /** 音源を読み込み、デコード + オフライン解析を行う。既存の音源があれば破棄する。 */
  async load(file: File, opts?: AnalyzeOptions): Promise<void> {
    this.dispose();
    const decoded = await decodeAudioFile(file);
    this._analysis = analyzeSamples(decoded.mono, decoded.sampleRate, opts);
    this._timeline = new AudioTimeline(this._analysis);
    this._player = new AudioPlayer(decoded.audioBuffer);
    this._audioBuffer = decoded.audioBuffer;
    this._fileName = file.name;
    this._lastT = 0;
    this._sha256 = await sha256Hex(decoded.raw);
  }

  /**
   * 一時停止・シークした位置から再生する。
   * 以前は _lastT (currentFrame() を呼んだときだけ更新される) から再生していたため、Visualizer タブ以外
   * (Lyrics タブなど) で一時停止 → 再生すると、止めた位置ではなく古い位置に戻ってしまっていた。
   * 位置は AudioPlayer 自身が pause/seek で覚えているので、それに任せる。
   */
  play(): void {
    this._player?.play();
  }

  /** 現在の再生位置 (秒)。currentFrame() と違い、内部の状態 (dt 計算用の前回時刻) を進めない。 */
  get currentTime(): number {
    return this._player ? this._player.currentTime() : this._lastT;
  }

  /**
   * いまスピーカーから聞こえている位置 (秒)。出力の遅れのぶん currentTime より少し前になる。
   * 歌詞のタップ同期と、Lyrics タブの「今の行」の表示に使う (AudioPlayer.heardTime 参照)。
   */
  get heardTime(): number {
    return this._player ? this._player.heardTime() : this._lastT;
  }

  /** 出力の遅れの見積もり (秒)。再生を一度も始めていなければ 0 */
  get outputLatency(): number {
    return this._player?.outputLatency() ?? 0;
  }

  pause(): void {
    this._player?.pause();
  }

  seek(seconds: number): void {
    this._player?.seek(seconds);
    this._lastT = seconds;
  }

  setVolume(v: number): void {
    this._player?.setVolume(v);
  }

  /** 現在の再生位置に対応する AudioFrame。再生していなければ最後の seek 位置のフレームを返す。 */
  currentFrame(): AudioFrame | null {
    if (!this._timeline) return null;
    const t = this._player ? this._player.currentTime() : this._lastT;
    const frame = this._timeline.at(t, this._lastT);
    this._lastT = t;
    return frame;
  }

  /** 書き出し用: 再生に関係なく、任意の時刻のフレームを直接取り出す。 */
  frameAt(t: number, prevT = t): AudioFrame | null {
    return this._timeline ? this._timeline.at(t, prevT) : null;
  }

  dispose(): void {
    this._player?.dispose();
    this._player = null;
    this._audioBuffer = null;
    this._analysis = null;
    this._timeline = null;
    this._fileName = '';
    this._sha256 = '';
    this._lastT = 0;
  }
}
