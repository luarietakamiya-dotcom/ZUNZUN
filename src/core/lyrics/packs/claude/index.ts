import type { MotionPack } from '../types';
import { hyperClaudePack } from './hyper';
import { summerClaudePack } from './summer';
import { winterClaudePack } from './winter';
import { gothicClaudePack } from './gothic';
import { terminalClaudePack } from './terminal';
import { constellationClaudePack } from './constellation';
import { splashClaudePack } from './rich/splash';
import { popClaudePack } from './rich/pop';
import { winterRichClaudePack } from './rich/winter';
import { neonClaudePack } from './rich/neon';

/** Claude 版リリックモーション（語尾 `.c`）の一覧。競作: docs/AI_COLLABORATION.md「競作の取り決め」 */
export const CLAUDE_PACKS: readonly MotionPack[] = [hyperClaudePack, summerClaudePack, winterClaudePack, gothicClaudePack, terminalClaudePack, constellationClaudePack, splashClaudePack, popClaudePack, winterRichClaudePack, neonClaudePack];
