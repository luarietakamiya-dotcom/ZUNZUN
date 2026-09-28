/**
 * 取り消し・やり直し (Ctrl/Cmd+Z / Y) の履歴。値そのもの (不変に扱うスナップショット) を積む。
 * タップ同期 (L3) とタイムライン編集 (L4) の両方で使う。
 */
export class History<T> {
  private readonly past: T[] = [];
  private readonly future: T[] = [];

  constructor(
    private present: T,
    private readonly limit = 200,
  ) {}

  get current(): T {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 新しい状態を積む。やり直しの履歴は消える。 */
  push(next: T): void {
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future.length = 0;
  }

  /** 1 つ前の状態に戻す。戻せなければ null。 */
  undo(): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.present);
    this.present = prev;
    return prev;
  }

  /** 取り消した状態をやり直す。やり直せなければ null。 */
  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.present);
    this.present = next;
    return next;
  }

  /** 履歴を捨てて、今の状態だけにする (歌詞を丸ごと差し替えたときなど)。 */
  reset(present: T): void {
    this.past.length = 0;
    this.future.length = 0;
    this.present = present;
  }
}
