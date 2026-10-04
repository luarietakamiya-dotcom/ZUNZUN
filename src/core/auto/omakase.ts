import type { AudioAnalysis } from '../audio/analyze';

/**
 * 「おまかせで作る」の選び方 (2026-10-04 UI 刷新の段階 5)。曲の分析結果から、ビジュアライザーと歌詞のスタイルの組み合わせを選ぶ。
 * 同じ曲 (と同じ背景の有無) なら、いつも同じ結果。「別のおまかせ」は、点数の高い順の次の候補 (index を進める)。
 * 点数は経験則 (曲の印象 = 激しさ・低音寄りか高音寄りか と、各種類の持ち味の近さ)。実際の曲で見て、表の値を調整する前提。
 */

/** 曲の印象 (どれも 0..1) */
export interface SongFeatures {
  bpm: number;
  /** 激しさ: テンポ・音の動き (flux)・音量から */
  energy: number;
  /** 低音寄り (1) か、そうでない (0) か */
  bass: number;
  /** 高音寄り・明るい音 (1) か、低い音が中心 (0) か */
  tone: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const mean = (a: ArrayLike<number>): number => {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    if (Number.isFinite(v)) {
      s += v;
      n++;
    }
  }
  return n > 0 ? s / n : 0;
};

/** 分析結果から、曲の印象を出す */
export function songFeatures(a: Pick<AudioAnalysis, 'bpm' | 'rms' | 'flux' | 'bass' | 'mid' | 'high' | 'bands'>): SongFeatures {
  const bpm = Number.isFinite(a.bpm) && a.bpm > 0 ? a.bpm : 100;
  const bpmN = clamp01((bpm - 70) / 90);
  const fluxN = clamp01(mean(a.flux) * 3);
  const rmsN = clamp01(mean(a.rms) * 3);
  const energy = clamp01(0.4 * bpmN + 0.35 * fluxN + 0.25 * rmsN);
  const b = mean(a.bass);
  const m = mean(a.mid);
  const h = mean(a.high);
  const bassShare = b / Math.max(1e-6, b + m + h);
  const bass = clamp01((bassShare - 0.25) / 0.5);
  // 音の明るさ: 64 帯域の重心 (0 = 低い方、1 = 高い方)
  let sum = 0;
  let weighted = 0;
  const frames = a.bands.length;
  const step = Math.max(1, Math.floor(frames / 400));
  for (let f = 0; f < frames; f += step) {
    const row = a.bands[f]!;
    for (let k = 0; k < row.length; k++) {
      const v = Number.isFinite(row[k]!) ? Math.max(0, row[k]!) : 0;
      sum += v;
      weighted += v * k;
    }
  }
  // 実際の曲の重心は 0.25〜0.4 あたりが多いので、0.15 を 0・0.5 を 1 に伸ばす
  const tone = sum > 1e-6 ? clamp01((weighted / sum / 63 - 0.15) / 0.35) : 0.5;
  return { bpm, energy, bass, tone };
}

/** 各ビジュアライザーの持ち味: 合う激しさ (energy)・低音寄りを好むか (bass)・黒い背景に光だけを描くので背景の絵に重ねる向きか (overlay) */
const PRESET_TRAITS: Record<string, { energy: number; bass: number; overlay?: boolean }> = {
  'solar-gate': { energy: 0.5, bass: 0.5 },
  'milky-way': { energy: 0.08, bass: 0.2 },
  'live-stage': { energy: 0.6, bass: 0.5 },
  'speaker-rack': { energy: 0.5, bass: 0.8 },
  'speaker-cone': { energy: 0.5, bass: 0.9, overlay: true },
  'speaker-twin': { energy: 0.55, bass: 0.8, overlay: true },
  'speaker-mega': { energy: 0.9, bass: 0.9, overlay: true },
  'edge-equalizer': { energy: 0.6, bass: 0.5, overlay: true },
  'spectrum-wave': { energy: 0.35, bass: 0.4, overlay: true },
  'led-matrix': { energy: 0.7, bass: 0.6, overlay: true },
  ripples: { energy: 0.25, bass: 0.4, overlay: true },
  kaleidoscope: { energy: 0.5, bass: 0.5 },
  'photo-motion': { energy: 0.5, bass: 0.6 },
  'city-scroll': { energy: 0.35, bass: 0.3 },
  'cyber-space': { energy: 0.85, bass: 0.7 },
};

/** 歌詞のスタイル (演出パック) の持ち味: 合う激しさ・低音寄りか (bass)・明るい曲向きか (bright)。表示名は画面用 */
const STYLE_TRAITS: { key: string; name: { ja: string; en: string }; energy: number; bass: number; bright: number }[] = [
  { key: 'zz-calm', name: { ja: '静寂', en: 'Calm' }, energy: 0.1, bass: 0.3, bright: 0.4 },
  { key: 'zz-cinema', name: { ja: '余白', en: 'Space' }, energy: 0.3, bass: 0.4, bright: 0.5 },
  { key: 'zz-design', name: { ja: '図案', en: 'Design' }, energy: 0.45, bass: 0.4, bright: 0.7 },
  { key: 'zz-pop', name: { ja: '弾む', en: 'Pop' }, energy: 0.55, bass: 0.3, bright: 0.8 },
  { key: 'zz-rock', name: { ja: '轟音', en: 'Rock' }, energy: 0.75, bass: 0.8, bright: 0.3 },
  { key: 'zz-intense', name: { ja: '衝撃', en: 'Intense' }, energy: 0.92, bass: 0.7, bright: 0.6 },
];

export interface OmakaseResult {
  presetId: string;
  lyricStyle: string;
  lyricStyleName: { ja: string; en: string };
  features: SongFeatures;
  /** 何番目の候補か (0 = いちばん合うもの) */
  rank: number;
}

export interface OmakaseOptions {
  /** 背景の絵や動画が入っているか (入っていれば、黒に光を描くものを重ねる向きとして選びやすく、歌詞は「余白」を選びやすくする) */
  hasBackground?: boolean;
  /** 今使えるビジュアライザーの id (登録されていないものは選ばない)。省略すると、持ち味の表にあるもの全部 */
  availablePresets?: readonly string[];
}

/** 候補の数 (「別のおまかせ」で回る範囲) */
const RANK_RANGE = 6;

const near = (a: number, b: number): number => 1 - Math.abs(a - b);

/** 点数の高い順に並べたビジュアライザーの id (同点は表の順) */
export function rankPresets(f: SongFeatures, opt: OmakaseOptions = {}): string[] {
  const avail = opt.availablePresets ? new Set(opt.availablePresets) : null;
  const ids = Object.keys(PRESET_TRAITS).filter((id) => !avail || avail.has(id));
  const scored = ids.map((id, order) => {
    const t = PRESET_TRAITS[id]!;
    let score = near(f.energy, t.energy) + 0.35 * near(f.bass, t.bass);
    if (t.overlay) score += opt.hasBackground ? 0.3 : -0.15;
    else if (opt.hasBackground) score -= 0.1; // 画面いっぱいに描くものは、背景を隠す
    return { id, score, order };
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.id);
}

function rankStyles(f: SongFeatures, opt: OmakaseOptions): typeof STYLE_TRAITS {
  const scored = STYLE_TRAITS.map((s, order) => {
    let score = near(f.energy, s.energy) + 0.3 * near(f.bass, s.bass) + 0.3 * near(f.tone, s.bright);
    if (s.key === 'zz-cinema' && opt.hasBackground) score += 0.35; // 背景が絵のときは、雰囲気を壊さない歌詞
    return { s, score, order };
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((x) => x.s);
}

/** おまかせの結果。index 0 = いちばん合う組み合わせ、1, 2, … = 「別のおまかせ」 (RANK_RANGE で一周する) */
export function pickOmakase(f: SongFeatures, index = 0, opt: OmakaseOptions = {}): OmakaseResult | null {
  const presets = rankPresets(f, opt);
  if (presets.length === 0) return null;
  const range = Math.min(RANK_RANGE, presets.length);
  const i = ((Math.floor(index) % range) + range) % range;
  const styles = rankStyles(f, opt);
  const style = styles[i % Math.min(3, styles.length)]!;
  return { presetId: presets[i]!, lyricStyle: style.key, lyricStyleName: style.name, features: f, rank: i };
}

/** 激しさの言葉 (画面用) */
export function energyWord(energy: number): { ja: string; en: string } {
  if (energy < 0.3) return { ja: 'おだやか', en: 'calm' };
  if (energy < 0.6) return { ja: 'ふつう', en: 'moderate' };
  return { ja: '激しめ', en: 'intense' };
}
