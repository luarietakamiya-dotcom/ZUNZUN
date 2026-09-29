import type { AudioAnalysis } from '../audio/analyze';
import { findOnsetCandidates } from '../lyrics/candidates';
import type { SnapTargets } from '../lyrics/snap';

/**
 * 小節の頭のタップの吸着先。小節の頭はキックなど打楽器の出だしと重なることが多いので、
 * 音全体の立ち上がり (flux) の候補を優先し、無ければ自動検出のビートへ寄せる (snapTime の順番どおり)。
 * 歌詞の吸着先 (歌声の帯域の立ち上がり) とは別物。解析結果ごとに 1 度だけ計算する。
 */
const cache = new WeakMap<AudioAnalysis, SnapTargets>();

export function barSnapTargetsFor(analysis: AudioAnalysis): SnapTargets {
  let t = cache.get(analysis);
  if (!t) {
    t = {
      candidates: findOnsetCandidates(analysis.flux, analysis.frameRate, { window: 0.08 }).map((c) => c.t),
      beats: analysis.beats.slice().sort((a, b) => a - b),
    };
    cache.set(analysis, t);
  }
  return t;
}
