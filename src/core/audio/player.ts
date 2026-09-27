/**
 * AudioContext + AudioBufferSourceNode による再生管理。
 * ブラウザ依存のため単体テストの対象外 (decode.ts と同じ扱い)。
 *
 * シーク可能にするため、AudioBufferSourceNode は毎回作り直す (Web Audio の一般的な作法)。
 * 再生開始時の AudioContext.currentTime を基準に、現在の再生位置を計算する。
 */
export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private startedAtCtx = 0; // ctx.currentTime のうち再生を開始した時刻
  private startedAtMedia = 0; // そのときの再生位置 (秒)
  private playing = false;
  private volume = 1;

  constructor(private buffer: AudioBuffer) {}

  get duration(): number {
    return this.buffer.duration;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** 現在の再生位置 (秒)。停止中は最後に seek/pause した位置を返す。 */
  currentTime(): number {
    if (!this.playing || !this.ctx) return this.startedAtMedia;
    const elapsed = this.ctx.currentTime - this.startedAtCtx;
    return Math.min(this.buffer.duration, this.startedAtMedia + elapsed);
  }

  play(fromSeconds?: number): void {
    const at = fromSeconds ?? this.currentTime();
    this.stopSource();
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!this.ctx) this.ctx = new AC();
    if (!this.gain) {
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    src.start(0, Math.max(0, Math.min(at, this.buffer.duration)));
    this.source = src;
    this.startedAtCtx = this.ctx.currentTime;
    this.startedAtMedia = at;
    this.playing = true;
    src.onended = () => {
      if (this.source === src) this.playing = false;
    };
  }

  pause(): void {
    if (!this.playing) return;
    this.startedAtMedia = this.currentTime();
    this.stopSource();
    this.playing = false;
  }

  seek(seconds: number): void {
    const clamped = Math.max(0, Math.min(seconds, this.buffer.duration));
    if (this.playing) this.play(clamped);
    else this.startedAtMedia = clamped;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  dispose(): void {
    this.stopSource();
    if (this.ctx) void this.ctx.close().catch(() => {});
    this.ctx = null;
    this.gain = null;
  }

  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        // 既に停止済みなら無視
      }
      this.source.disconnect();
      this.source = null;
    }
  }
}
