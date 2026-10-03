import { visualizerRegistry } from '../core/visualizer/registry';
import { debugBarsModule } from './_debug';
import { edgeEqualizerModule } from './edge-equalizer';
import { cityScrollModule } from './city-scroll';
import { cyberSpaceModule } from './cyber-space';
import { liveStageModule } from './live-stage';
import { milkyWayModule } from './milky-way';
import { noneModule } from './none';
import { photoMotionModule } from './photo-motion';
import { ripplesModule } from './ripples';
import { solarGateModule } from './solar-gate';
import { speakerConeModule } from './speaker-cone';
import { speakerMegaModule } from './speaker-mega';
import { speakerRackModule } from './speaker-rack';
import { speakerTwinModule } from './speaker-twin';

/**
 * プリセットの登録一覧。新しいプリセットを追加するときは、そのフォルダを作って
 * ここに import + register の 2 行を足すだけでよい (Host/Registry 本体は変更不要)。
 * 登録順がプリセット選択の並び順になり、先頭が既定のプリセットになる (先頭は何も描かない「なし」。2026-10-03)。
 */
visualizerRegistry.register(noneModule);
visualizerRegistry.register(solarGateModule);
visualizerRegistry.register(milkyWayModule);
visualizerRegistry.register(liveStageModule);
visualizerRegistry.register(speakerRackModule);
visualizerRegistry.register(speakerConeModule);
visualizerRegistry.register(speakerTwinModule);
visualizerRegistry.register(speakerMegaModule);
visualizerRegistry.register(edgeEqualizerModule);
visualizerRegistry.register(ripplesModule);
visualizerRegistry.register(photoMotionModule);
visualizerRegistry.register(cityScrollModule);
visualizerRegistry.register(cyberSpaceModule);
visualizerRegistry.register(debugBarsModule);

export { visualizerRegistry };
