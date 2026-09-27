import { AudioEngine } from './audio';
import { defaultCommonParams, defaultProject, type CommonParams, type ProjectFile } from './types';

type Listener = () => void;

/**
 * アプリ全体で 1 つだけ持つ、ごく小さな状態置き場。
 * AudioEngine のインスタンス、seed、Visualizer の選択中プリセット/共通パラメータを持つ。
 * Step 5 (Project JSON) の Save/Load はここを介して読み書きする (core/project/*.ts 参照)。
 */
class Store {
  readonly audio = new AudioEngine();

  private _seed: number = defaultProject().seed;
  private _presetId: string | null = null;
  private _params: CommonParams = defaultCommonParams();
  private _expectedAudio: ProjectFile['audio'] = null;
  private readonly listeners = new Set<Listener>();

  /**
   * 直近で読み込んだ Project JSON が参照していた音源情報 (再リンク照合用)。
   * 音源本体は Project JSON に含まれないため、Music タブで音源を選び直したときに
   * ここと sha256 を突き合わせて、同じファイルかどうかを判定する。
   */
  get expectedAudio(): ProjectFile['audio'] {
    return this._expectedAudio;
  }

  /** Visualizer プリセットの乱数を決める project.seed。既定値は起動時刻から作る (defaultProject() 参照) */
  get seed(): number {
    return this._seed;
  }

  setSeed(seed: number): void {
    this._seed = seed >>> 0;
    this.emit();
  }

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

  /**
   * Project JSON を読み込んだときに、seed/preset/共通パラメータをまとめて反映する。
   * 音源本体はプロジェクトに含まれないため、ここでは触らない (Settings パネル側で
   * project.audio の有無を見て、Music タブからの読み込み直しを案内する)。
   */
  applyProject(project: ProjectFile): void {
    this._seed = project.seed >>> 0;
    this._presetId = project.visualizer.preset;
    this._params = { ...project.visualizer.common };
    this._expectedAudio = project.audio;
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
