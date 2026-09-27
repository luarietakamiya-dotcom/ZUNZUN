import { AudioEngine } from './audio';
import { sha256Hex } from './hash';
import { defaultCommonParams, defaultProject, type CommonParams, type OverlayLayer, type ProjectFile } from './types';

type Listener = () => void;

/**
 * アプリ全体で 1 つだけ持つ、ごく小さな状態置き場。
 * AudioEngine のインスタンス、seed、Visualizer の選択中プリセット/共通パラメータ、
 * オーバーレイの設定を持つ。Step 5 (Project JSON) の Save/Load はここを介して読み書きする
 * (core/project/*.ts 参照)。
 *
 * オーバーレイの Three.js 側リソース (テクスチャ/スプライト) はここでは持たない。
 * Visualizer タブは表示のたびに VisualizerHost ごと作り直される (ui/panels/visualizer.ts) ため、
 * ここに残すのは「タブをまたいでも保つべき設定」(OverlayLayer[]) と、そのために必要な
 * 元画像 File (メモリ上のみ。Project JSON には ref/sha256 だけを保存し、本体は含めない) だけ。
 */
class Store {
  readonly audio = new AudioEngine();

  private _seed: number = defaultProject().seed;
  private _presetId: string | null = null;
  private _params: CommonParams = defaultCommonParams();
  private _expectedAudio: ProjectFile['audio'] = null;
  private _overlays: OverlayLayer[] = [];
  private readonly overlayFiles = new Map<string, File>();
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

  get overlays(): OverlayLayer[] {
    return this._overlays;
  }

  /** id に対応する元画像。Project JSON 読み込み直後など、まだ再選択されていない場合は undefined。 */
  getOverlayFile(id: string): File | undefined {
    return this.overlayFiles.get(id);
  }

  /** 画像ファイルから新しいオーバーレイレイヤーを追加する。既定値は最前面・画面中央・30%サイズ。 */
  async addOverlayImage(file: File): Promise<string> {
    const sha256 = await sha256Hex(await file.arrayBuffer());
    const id = crypto.randomUUID();
    const maxZ = this._overlays.reduce((m, o) => Math.max(m, o.z), -1);
    const layer: OverlayLayer = {
      id,
      ref: file.name,
      sha256,
      x: 0.5,
      y: 0.5,
      scale: 0.3,
      rotation: 0,
      opacity: 1,
      z: maxZ + 1,
      glow: 0,
      float: 0,
      beat: 0,
    };
    this._overlays = [...this._overlays, layer];
    this.overlayFiles.set(id, file);
    this.emit();
    return id;
  }

  /**
   * Project JSON 読み込み後などに、既存レイヤーの設定値を保ったまま元画像だけを再リンクする。
   * sha256 が一致するかどうかは呼び出し側 (Overlay パネル) が判定して表示する。
   */
  relinkOverlayImage(id: string, file: File): void {
    if (!this._overlays.some((o) => o.id === id)) return;
    this.overlayFiles.set(id, file);
    this.emit();
  }

  updateOverlay(id: string, patch: Partial<Omit<OverlayLayer, 'id' | 'ref' | 'sha256'>>): void {
    this._overlays = this._overlays.map((o) => (o.id === id ? { ...o, ...patch } : o));
    this.emit();
  }

  /** UI のスライダー 1 個ずつの更新用 (setParam と同じパターン)。1 フィールドだけを安全に書き換える。 */
  setOverlayField<K extends keyof Omit<OverlayLayer, 'id' | 'ref' | 'sha256'>>(
    id: string,
    key: K,
    value: OverlayLayer[K],
  ): void {
    this._overlays = this._overlays.map((o) => (o.id === id ? { ...o, [key]: value } : o));
    this.emit();
  }

  removeOverlay(id: string): void {
    this._overlays = this._overlays.filter((o) => o.id !== id);
    this.overlayFiles.delete(id);
    this.emit();
  }

  /** レイヤー順 (z) を 1 つ前面/背面に入れ替える。UI の「前面へ/背面へ」ボタンから呼ぶ。 */
  reorderOverlay(id: string, direction: 'up' | 'down'): void {
    const sorted = [...this._overlays].sort((a, b) => a.z - b.z);
    const index = sorted.findIndex((o) => o.id === id);
    const swapWith = direction === 'up' ? index + 1 : index - 1;
    if (index < 0 || swapWith < 0 || swapWith >= sorted.length) return;
    const a = sorted[index]!;
    const b = sorted[swapWith]!;
    const aZ = a.z;
    this._overlays = this._overlays.map((o) => {
      if (o.id === a.id) return { ...o, z: b.z };
      if (o.id === b.id) return { ...o, z: aZ };
      return o;
    });
    this.emit();
  }

  /**
   * Project JSON を読み込んだときに、seed/preset/共通パラメータ/オーバーレイ設定をまとめて反映する。
   * 音源本体・オーバーレイ画像本体はプロジェクトに含まれないため、ここでは触らない
   * (Settings/Music/Overlay パネル側で、再選択を案内する)。
   */
  applyProject(project: ProjectFile): void {
    this._seed = project.seed >>> 0;
    this._presetId = project.visualizer.preset;
    this._params = { ...project.visualizer.common };
    this._expectedAudio = project.audio;
    this._overlays = project.overlays;
    this.overlayFiles.clear();
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
