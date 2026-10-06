import type { MotionPack } from '../types';
import { hyperClaudePack } from './hyper';
import { gothicClaudePack } from './gothic';

/** Claude 版リリックモーション（語尾 `.c`）の一覧。競作: docs/AI_COLLABORATION.md「競作の取り決め」 */
export const CLAUDE_PACKS: readonly MotionPack[] = [hyperClaudePack, gothicClaudePack];
