import { visualizerRegistry } from '../core/visualizer/registry';
import { debugBarsModule } from './_debug';

/**
 * プリセットの登録一覧。新しいプリセットを追加するときは、そのフォルダを作って
 * ここに import + register の 2 行を足すだけでよい (Host/Registry 本体は変更不要)。
 * Step 8 以降で solar-gate / milky-way / live-stage をここに追加していく。
 */
visualizerRegistry.register(debugBarsModule);

export { visualizerRegistry };
