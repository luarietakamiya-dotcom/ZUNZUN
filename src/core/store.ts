import { AudioEngine } from './audio';
import { defaultCommonParams, type CommonParams } from './types';

type Listener = () => void;

/**
 * アプリ全体で 1 つだけ持つ、ごく小さな状態置き場。
 * 今のところ AudioEngine のインスタンスと、Visualizer の選択中プリセット/共通パラメータだけを持つ。
 * Step 5 (Project JSON) で ProjectFile の読み書きと繋ぎ込む。
 */
class Store {
  readonly audio = new AudioEngine();

  private _presetId: string | null = null;
  private _params: CommonParams = defaultCommonParams();
  private readonly listeners = new Set<Listener>();

  get presetId(): string | null {
    return this._presetId;
  }

  setPresetId(id: string): void {
    this._presetId = id;
    this.emit();
  }

  get params(): CommonParams {
    return this._params;
  }

  setParam<K extends keyof CommonParams>(key: K, value: CommonParams[K]): void {
    this._params = { ...this._params, [key]: value };
    this.emit();
  }

  /** state が変わるたびに呼ばれる。戻り値の関数で購読解除する。 */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const store = new Store();
