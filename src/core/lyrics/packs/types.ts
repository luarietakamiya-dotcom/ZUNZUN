/**
 * ZUNZUN のオリジナルの歌詞モーション (演出パック) の型。docs/ARCHITECTURE.md「オリジナルの歌詞モーション」。
 * 1 つのパック = 1 つのスタイル + そのスタイルのときだけ出るオリジナルの演出 + 使う/使わない JIZURA の演出の決まり。
 * JIZURA は改変しない (J.register で足し、J.STYLES にスタイルを足す)。演出は JIZURA の「部品セット」(set) に入れるので、
 * そのパックのスタイルを選んだときだけ候補に入る (既存のスタイルのカット割りは変わらない。変拍子パックと同じ仕組み)。
 */

/** JIZURA のうち、パックが使う分だけ */
export interface PackJ {
  register(group: string, key: string, def: Record<string, unknown>, pack?: string): unknown;
  STYLES: Record<string, Record<string, unknown> & { name: string }>;
  order(group: string): string[];
  registry(group: string): Record<string, { tags?: string[]; pack?: string } | undefined>;
  GROUP_KEYS: string[];
  clamp(x: number, a?: number, b?: number): number;
  lerp(a: number, b: number, t: number): number;
  smooth(a: number, b: number, x: number): number;
  noise1(x: number, seed?: number): number;
  /** 0..1 の決まった乱数 (引数から決まる) */
  r(a: number, b?: number, c?: number, d?: number, e?: number): number;
  rs(a: number, b?: number, c?: number, d?: number, e?: number): number;
  rgba(hex: string, a?: number): string;
  mix(h1: string, h2: string, t: number): string;
  TAU: number;
  /** レイアウトで文字を描く (登場・表示中・退場の演出がかかる)。文字の枠を返す */
  mainDraw(env: unknown, item: Record<string, unknown>): PackBox | null;
  /** 行を 1 行 maxPer 文字くらいで折り返す */
  splitLines(text: string, maxPer: number): string[] | string;
  /** 枠 (maxW × maxH) に収まる文字の大きさ */
  fitSize(text: string[] | string, font: string, maxW: number, maxH: number, opt?: Record<string, unknown>): number;
}

/** 背景から読み取った色 (core/render/palette.ts の BgPalette と同じ形) */
export interface PackPalette {
  dark: string;
  light: string;
  accent: string;
  accent2: string;
}

/** パックがスタイルを作り直すときに使える情報 */
export interface PackContext {
  /** 背景の色 (背景が無い・まだ読み取れていなければ null) */
  palette?: PackPalette | null;
}

/** 文字ごとの変化 (JIZURA の charFns が返すもの) */
export interface CharMod {
  dx?: number;
  dy?: number;
  rot?: number;
  s?: number;
  sx?: number;
  sy?: number;
  a?: number;
  blur?: number;
  color?: string;
  skew?: number;
  hide?: boolean;
}

/** JIZURA が演出に渡す、描く文字 (item) のうち使う分 */
export interface PackItem {
  size: number;
  seed?: number;
  alpha?: number;
  blur?: number;
  track?: number;
  color?: string;
  shadow?: { color: string; blur: number; dx?: number; dy?: number } | null;
  charFns: ((i: number, g: { i: number }, n: number) => CharMod | null)[];
}

export interface PackScheme {
  fg: string;
  sub?: string;
  accent: string;
  accent2?: string;
  bg: string;
}

/** JIZURA が演出に渡す描画の環境 (makeEnv) のうち使う分。座標は plan の設計サイズ (例: 1920×1080) */
export interface PackEnv {
  W: number;
  H: number;
  t: number;
  /** カットの中の時刻 (秒) */
  lt: number;
  pIn: number;
  pOut: number;
  pass: string;
  sc: PackScheme;
  fx: { motion?: number; decor?: number };
  cut: { dur: number; seed?: number; inDur: number; outDur: number };
  /** 今の拍 (plan.beats から。拍が無い曲では null)。index = 何拍目、since = 拍からの経過 (秒)、len = 拍の長さ (秒) */
  beat?: { index: number; since: number; len: number } | null;
  /** 今の音の大きさ (0..1、JIZURA の plan.energy。無ければ null) */
  energy?: number | null;
  line(pts: [number, number][], color: string, lw?: number, a?: number, ghost?: boolean): void;
  circle(cx: number, cy: number, r: number, fill: string | null, stroke: string | null, lw?: number, a?: number, ghost?: boolean): void;
}

/** 登場・退場・表示中の動きに JIZURA が渡す長さ */
export interface PackCtx {
  dur: number;
  inDur: number;
  outDur: number;
}

export interface PackBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface PackEffect {
  group: 'layout' | 'enter' | 'hold' | 'exit' | 'decor' | 'treat' | 'bg' | 'cam' | 'fx' | 'trans';
  key: string;
  def: Record<string, unknown> & { name: string };
}

export interface MotionPack {
  /** パックの名前 (JIZURA の pack) */
  id: string;
  /** JIZURA の部品セットの名前 (project の同名のキーが true のときだけ、このパックの演出が選ばれる) */
  set: string;
  /** このパックのスタイルのキー (J.STYLES) */
  styleKey: string;
  /** スタイルを作る (J.STYLES の既存のスタイルを元にしてよい) */
  buildStyle(J: PackJ): Record<string, unknown> & { name: string };
  /** オリジナルの演出 */
  effects(J: PackJ): PackEffect[];
  /**
   * このパックのスタイルで描くときの JIZURA の project の調整 (使わない演出の無効化、fx の上書きなど)。
   * project.enabled[group][key] = false で無効にする。オリジナルの演出は触らないこと
   */
  configure?(project: Record<string, unknown>, J: PackJ): void;
  /**
   * 描くたびにスタイルを作り直すパック (背景の色を使うものなど)。J.STYLES[styleKey] を上書きしてよい。
   * スタイルの材料 (ctx) が変わったら歌詞モーションを作り直すよう、呼び出し側は ctx をキーに含める
   */
  refreshStyle?(J: PackJ, ctx: PackContext): void;
}
