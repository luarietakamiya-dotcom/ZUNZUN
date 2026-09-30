import { AudioEngine } from './audio';
import { sha256Hex } from './hash';
import { moveLayer, normalizeComposition } from './render/composition';
import {
  defaultCommonParams,
  defaultLyrics,
  defaultProject,
  type CommonParams,
  type ExportSettings,
  type LyricsSettings,
  type LyricsTiming,
  type OverlayLayer,
  type ProjectFile,
  type RhythmSettings,
  type BackgroundSettings,
  defaultBackground,
  defaultView,
  type ViewSettings,
  defaultComposition,
  type CompositionSettings,
  defaultMediaLayer,
  type MediaLayer,
} from './types';
import { tr } from './i18n';

type Listener = () => void;

/** 背景のファイルの大きさの上限 (sha256 をファイル全体から計算するため) */
export const MAX_BACKGROUND_BYTES = 2 * 2 ** 30;

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
  private _exportSettings: ExportSettings = defaultProject().export;
  private _lyrics: LyricsSettings | null = null;
  private _rhythm: RhythmSettings | null = null;
  private _background: BackgroundSettings | null = null;
  /** 背景の元のファイル (メモリ上だけ。Project JSON には ref/sha256 だけを保存する) */
  private _backgroundFile: File | null = null;
  private _view: ViewSettings = defaultView();
  private _composition: CompositionSettings = defaultComposition();
  private _media: MediaLayer[] = [];
  /** 素材の元のファイル (メモリ上だけ。Project JSON には ref/sha256 だけを保存する) */
  private readonly mediaFiles = new Map<string, File>();

  /** 素材レイヤー (画像・動画)。Project JSON の media に保存される */
  get media(): MediaLayer[] {
    return this._media;
  }

  getMediaFile(id: string): File | undefined {
    return this.mediaFiles.get(id);
  }

  /** 素材を足す (レイヤーのいちばん手前に入る)。戻り値は素材の id */
  async addMedia(file: File, kind: MediaLayer['kind']): Promise<string> {
    if (file.size > MAX_BACKGROUND_BYTES) throw new Error(tr(`ファイルが大きすぎます (${(file.size / 2 ** 30).toFixed(1)}GB)。2GB までにしてください`, `The file is too large (${(file.size / 2 ** 30).toFixed(1)} GB). Please keep it under 2 GB`));
    const sha256 = await sha256Hex(await file.arrayBuffer());
    const id = crypto.randomUUID();
    this._media = [...this._media, defaultMediaLayer(id, file.name, sha256, kind)];
    this.mediaFiles.set(id, file);
    this._composition = { ...this._composition, order: [...this._composition.order, `media:${id}`] };
    this.emit();
    return id;
  }

  /** プロジェクトを開いたあと、素材のファイルを選び直す */
  relinkMedia(id: string, file: File): void {
    if (!this._media.some((m) => m.id === id)) return;
    this.mediaFiles.set(id, file);
    this.emit();
  }

  updateMedia(id: string, patch: Partial<Omit<MediaLayer, 'id' | 'ref' | 'sha256' | 'kind'>>): void {
    this._media = this._media.map((m) => (m.id === id ? { ...m, ...patch } : m));
    this.emit();
  }

  removeMedia(id: string): void {
    this._media = this._media.filter((m) => m.id !== id);
    this.mediaFiles.delete(id);
    const key = `media:${id}`;
    this._composition = { ...this._composition, order: this._composition.order.filter((o) => o !== key), hidden: this._composition.hidden.filter((o) => o !== key) };
    this.emit();
  }

  /** レイヤーの順番と重ね方。Project JSON の composition に保存される */
  get composition(): CompositionSettings {
    return this._composition;
  }

  updateComposition(patch: Partial<CompositionSettings>): void {
    this._composition = { ...this._composition, ...patch };
    this.emit();
  }

  /** レイヤーを 1 つ手前 (1) か奥 (-1) へ */
  moveLayer(id: string, dir: 1 | -1): void {
    this.updateComposition({ order: moveLayer(this._composition.order, id, dir) });
  }

  setLayerVisible(id: string, visible: boolean): void {
    const hidden = this._composition.hidden.filter((h) => h !== id);
    if (!visible) hidden.push(id);
    this.updateComposition({ hidden });
  }
  private readonly listeners = new Set<Listener>();

  /** ビジュアライザーの見え方 (拡大・位置・傾き)。Project JSON の visualizer.view に保存される */
  get view(): ViewSettings {
    return this._view;
  }

  updateView(patch: Partial<ViewSettings>): void {
    this._view = { ...this._view, ...patch };
    this.emit();
  }

  /** 小節と拍子 (変拍子モード)。使っていない間は null。Project JSON の rhythm に保存される。 */
  get rhythm(): RhythmSettings | null {
    return this._rhythm;
  }

  /** 小節と拍子を丸ごと差し替える (null で使わない状態に戻す)。 */
  setRhythm(next: RhythmSettings | null): void {
    this._rhythm = next;
    this.emit();
  }

  /** 背景の一枚絵・動画の設定。使わない間は null。Project JSON の background に保存される */
  get background(): BackgroundSettings | null {
    return this._background;
  }

  /** 背景の元のファイル。Project JSON を読み込んだ直後など、まだ選び直していなければ null */
  get backgroundFile(): File | null {
    return this._backgroundFile;
  }

  /**
   * 背景のファイルを選ぶ。同じファイル (sha256 が同じ) を選び直したときは設定をそのまま使い、別のファイルなら
   * 既定の設定で始める (種類が変わったとき以外は、見た目の調整値は引き継ぐ)。
   */
  async setBackgroundFile(file: File, kind: BackgroundSettings['kind']): Promise<void> {
    // sha256 はファイル全体を読んで計算するので、大きすぎるものは断る (動画は数百 MB でも数秒かかり、メモリも一時的に使う)
    if (file.size > MAX_BACKGROUND_BYTES) throw new Error(tr(`ファイルが大きすぎます (${(file.size / 2 ** 30).toFixed(1)}GB)。2GB までにしてください`, `The file is too large (${(file.size / 2 ** 30).toFixed(1)} GB). Please keep it under 2 GB`));
    const sha256 = await sha256Hex(await file.arrayBuffer());
    const cur = this._background;
    if (cur && cur.sha256 === sha256) this._background = { ...cur, ref: file.name, kind };
    else if (cur && cur.kind === kind) this._background = { ...cur, ref: file.name, sha256 };
    else this._background = defaultBackground(file.name, sha256, kind);
    this._backgroundFile = file;
    this.emit();
  }

  updateBackground(patch: Partial<Omit<BackgroundSettings, 'ref' | 'sha256' | 'kind'>>): void {
    if (!this._background) return;
    this._background = { ...this._background, ...patch };
    this.emit();
  }

  removeBackground(): void {
    this._background = null;
    this._backgroundFile = null;
    this.emit();
  }

  /** Export タブの書き出し設定 (サイズ/fps/画質)。Project JSON の export に保存される。 */
  get exportSettings(): ExportSettings {
    return this._exportSettings;
  }

  setExportSettings(patch: Partial<ExportSettings>): void {
    this._exportSettings = { ...this._exportSettings, ...patch };
    this.emit();
  }

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

  /** 歌詞と同期タイミング。歌詞を使わない (まだ入力していない) 間は null。Project JSON の lyrics に保存される。 */
  get lyrics(): LyricsSettings | null {
    return this._lyrics;
  }

  /** 歌詞を丸ごと差し替える (null で歌詞なしに戻す)。Lyrics タブの入力・タップ・タイムライン編集はここを通す。 */
  setLyrics(next: LyricsSettings | null): void {
    this._lyrics = next;
    this.emit();
  }

  /** 歌詞のタイミングの一部だけを書き換える。歌詞がまだ無ければ既定値から作る。 */
  updateLyricsTiming(patch: Partial<LyricsTiming>): void {
    const base = this._lyrics ?? defaultLyrics();
    this._lyrics = { ...base, timing: { ...base.timing, ...patch } };
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
    this._view = { ...(project.visualizer.view ?? defaultView()) };
    this._media = (project.media ?? []).map((m) => ({ ...m, chroma: { ...m.chroma } }));
    this.mediaFiles.clear();
    this._composition = normalizeComposition(project.composition, { mediaIds: this._media.map((m) => m.id) });
    this._expectedAudio = project.audio;
    this._overlays = project.overlays;
    this.overlayFiles.clear();
    this._exportSettings = { ...project.export };
    this._lyrics = project.lyrics;
    this._rhythm = project.rhythm;
    this._background = project.background;
    this._backgroundFile = null;
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
