import { visualizerRegistry } from '../core/visualizer/registry';
import { debugBarsModule } from './_debug';
import { solarGateModule } from './solar-gate';

/**
 * プリセットの登録一覧。新しいプリセットを追加するときは、そのフォルダを作って
 * ここに import + register の 2 行を足すだけでよい (Host/Registry 本体は変更不要)。
 * 登録順がプリセット選択の並び順になり、先頭が既定のプリセットになる。
 * 今後 milky-way / live-stage をここに追加していく。
 */
visualizerRegistry.register(solarGateModule);
visualizerRegistry.register(debugBarsModule);

export { visualizerRegistry };
