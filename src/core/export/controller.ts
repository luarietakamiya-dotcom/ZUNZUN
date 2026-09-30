import { tr } from '../i18n';
/**
 * 書き出しジョブの状態管理 (idle / running / done / error / cancelled)。
 *
 * Export パネルはタブ切り替えのたびに作り直される (ui/shell.ts) ため、進行中のジョブの状態を
 * パネルの中に持つと、別タブへ移動して戻ってきたときに進捗が見えなくなったり、同じ書き出しを
 * 二重に始められてしまう。そこで状態はこのモジュール単位のシングルトンに置き、パネルは
 * 購読して表示するだけにする。
 *
 * 実際のレンダリング/エンコード処理 (runner) は外から渡す。そのためこのクラス自体は
 * WebCodecs や Three.js に依存せず、Vitest で状態遷移を検証できる。
 */

export interface ExportResult {
  blob: Blob;
  fileName: string;
  videoCodec: string;
  audioCodec: string;
  frames: number;
}

export type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number; startedAt: number }
  | { kind: 'done'; result: ExportResult; elapsedMs: number }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' };

export interface ExportRunContext {
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
}

export type ExportRunner = (ctx: ExportRunContext) => Promise<ExportResult>;

type Listener = () => void;

export class ExportController {
  private _status: ExportStatus = { kind: 'idle' };
  private abort: AbortController | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  get status(): ExportStatus {
    return this._status;
  }

  get isRunning(): boolean {
    return this._status.kind === 'running';
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * 書き出しを開始し、終わる (完了/失敗/キャンセル) まで待つ。
   * 実行中にもう一度呼ぶと例外を投げる (二重書き出し防止)。
   */
  async start(runner: ExportRunner): Promise<void> {
    if (this.isRunning) throw new Error(tr('すでに書き出し中です', 'An export is already running'));
    const abort = new AbortController();
    this.abort = abort;
    const startedAt = this.now();
    this.set({ kind: 'running', done: 0, total: 0, startedAt });

    try {
      const result = await runner({
        signal: abort.signal,
        onProgress: (done, total) => {
          if (this.abort === abort && !abort.signal.aborted) {
            this.set({ kind: 'running', done, total, startedAt });
          }
        },
      });
      if (abort.signal.aborted) this.set({ kind: 'cancelled' });
      else this.set({ kind: 'done', result, elapsedMs: this.now() - startedAt });
    } catch (err) {
      if (abort.signal.aborted) this.set({ kind: 'cancelled' });
      else this.set({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  /** 実行中の書き出しを中止する。runner 側は signal を見て途中で抜ける。 */
  cancel(): void {
    this.abort?.abort();
  }

  /** 完了/失敗/キャンセル後の表示を消して idle に戻す (実行中は何もしない)。 */
  reset(): void {
    if (!this.isRunning) this.set({ kind: 'idle' });
  }

  private set(status: ExportStatus): void {
    this._status = status;
    for (const listener of this.listeners) listener();
  }
}

export const exportController = new ExportController();
