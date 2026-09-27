import type { VisualizerManifest, VisualizerPreset } from '../types';

/** 1 プリセットぶんの登録単位。カタログ情報 (manifest) とインスタンスを作る factory。 */
export interface VisualizerModule {
  manifest: VisualizerManifest;
  create(): VisualizerPreset;
}

/**
 * Visualizer プリセットの登録先。852wa/JIZURA の `J.register` (src/05b_registry.js) と同様、
 * 「id をキーに登録し、順序も別に保つ」考え方を型付きで再実装している。
 *
 * 新しいプリセットを増やすときは、このクラスや Host には手を入れず、
 * src/visualizers/<id>/ を追加して src/visualizers/index.ts に import 行を 1 行足すだけでよい。
 */
export class VisualizerRegistry {
  private readonly modules = new Map<string, VisualizerModule>();
  private readonly order: string[] = [];

  register(mod: VisualizerModule): void {
    const { id } = mod.manifest;
    if (this.modules.has(id)) {
      throw new Error(`visualizer preset "${id}" is already registered`);
    }
    this.modules.set(id, mod);
    this.order.push(id);
  }

  get(id: string): VisualizerModule | undefined {
    return this.modules.get(id);
  }

  has(id: string): boolean {
    return this.modules.has(id);
  }

  /** 登録順の manifest 一覧 (Visualizer パネルのサムネイル表示に使う)。 */
  list(): VisualizerManifest[] {
    return this.order.map((id) => this.modules.get(id)!.manifest);
  }
}

/** アプリ全体で 1 つだけ使うレジストリ。src/visualizers/index.ts がここに登録する。 */
export const visualizerRegistry = new VisualizerRegistry();
