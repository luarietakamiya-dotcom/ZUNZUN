import { rhythmPositionAt, type RhythmGrid, type RhythmPosition } from '../rhythm';

/**
 * 変拍子パック (R4)。docs/ARCHITECTURE.md「変拍子（リズム）の方針」。同梱した JIZURA は改変せず、JIZURA の拡張の仕組み
 * J.register で ZUNZUN 独自の演出を足し、それを選びやすくした変拍子用スタイルを J.STYLES に足す。
 *
 * 演出は plan.zzRhythm (jizura-adapter の attachRhythm が添える小節とまとまりの並び) から
 * 「何小節目・何番目のまとまり・その中の進み具合」を読んで動く。小節の外や、変拍子モードでない plan では何もしない。
 * - 文字の動き (hold) zzGroupPulse「まとまりの脈動」: まとまりの頭で文字が一瞬大きくなる。小節の頭 (アクセント) がいちばん強い
 * - 装飾 (decor) zzMeterBar「拍子の目盛り」: 画面の下端 (または上端) に 2+2+3 の区切りの帯を出し、今のまとまりが進み具合で埋まる
 * - カメラ (cam) zzBarPunch「小節の頭で寄る」: 小節の頭で少し寄り、小節ごとに左右交互にわずかに傾く
 *
 * 既存のスタイル・既存のプロジェクトの見た目を変えないために、3 つとも JIZURA の「部品セット」(set) の仕組みで
 * ODD_METER_SET に入れる。JIZURA はセットがオンのプロジェクト (project[ODD_METER_SET] === true) でしか
 * ランダムに選ばない (J.randomOk)。オフの間は候補の一覧にも入らないので、既存のカット割りの乱数の流れも変わらない。
 * ZUNZUN は「変拍子モードがオン、かつ変拍子用スタイル (またはそれを元にしたマイスタイル)」のときだけオンにする (buildJizuraProject)。
 * 重みを 0 にするだけでは不十分: JIZURA の重み付きの抽選 (rng.wpick) は、足し合わせの誤差で最後の候補を返すことがあり、
 * 登録した演出は一覧の最後に付くため。
 */

export const ODD_METER_STYLE_KEY = 'zz-oddmeter';
/** JIZURA の部品セットの名前 (project の同名のキーが true のときだけ選ばれる) */
export const ODD_METER_SET = 'zzOddMeter';
export const ODD_METER_PACK = 'zunzun-oddmeter';

/**
 * 変拍子用スタイルでは使わない JIZURA の演出。拍の番号を 4 で割って「4 拍でひと回り」にしているもの
 * (2026-09-29、commit 8da975f の同梱ファイルから `index % 4` / `/ 4` を探した)。不規則な拍では区切りがずれる。
 */
export const FOUR_BEAT_EFFECTS: Readonly<Record<string, readonly string[]>> = {
  hold: ['windGust', 'pluckString'],
};

// ------------------------------------------------------------------ JIZURA の型 (使う分だけ)

interface Scheme {
  fg: string;
  sub?: string;
  accent: string;
}

/** JIZURA が演出に渡す描画の環境 (makeEnv)。座標は plan の設計サイズ (例: 1920×1080) */
export interface PackEnv {
  W: number;
  H: number;
  t: number;
  lt: number;
  pOut: number;
  sc: Scheme;
  fx: { motion?: number };
  st: { fonts: { mono?: string[] } };
  plan: { zzRhythm?: RhythmGrid };
  rect(x: number, y: number, w: number, h: number, color: string, alpha?: number, ghost?: boolean): void;
  draw(item: Record<string, unknown>): unknown;
}

interface PackItem {
  size: number;
}

export interface PackApi {
  register(group: string, key: string, def: Record<string, unknown>, pack?: string): unknown;
  STYLES: Record<string, Record<string, unknown> & { name: string }>;
  __zunzunOddMeter?: boolean;
}

// ------------------------------------------------------------------ 演出

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function positionOf(env: PackEnv): { grid: RhythmGrid; pos: RhythmPosition } | null {
  const grid = env.plan?.zzRhythm;
  if (!grid) return null;
  const pos = rhythmPositionAt(grid, env.t);
  return pos ? { grid, pos } : null;
}

/** まとまりの脈動の強さ (時刻 t)。0..1 の減衰 × 強さ。小節の外なら 0 (テスト用に公開) */
export function groupPulseAmount(grid: RhythmGrid, t: number): number {
  const pos = rhythmPositionAt(grid, t);
  if (!pos) return 0;
  const since = t - pos.pulse.t;
  const dur = Math.min(0.3, pos.pulse.length * 0.7);
  if (!(dur > 0) || since >= dur) return 0;
  const decay = (1 - since / dur) ** 2;
  const bar = grid.bars[pos.pulse.bar]!;
  const units = bar.groups[pos.pulse.group] ?? 1;
  // 小節の頭がいちばん強く、長いまとまり (2+2+3 の 3) の頭は短いまとまりの頭より少し強い
  const strength = pos.pulse.barHead ? 1 : Math.min(0.65, 0.3 + 0.1 * units);
  return decay * strength;
}

/** 小節の頭で寄る量 (時刻 t)。{ 拡大, 傾き(度) } (テスト用に公開) */
export function barPunchAmount(grid: RhythmGrid, t: number): { s: number; rot: number } {
  const pos = rhythmPositionAt(grid, t);
  if (!pos) return { s: 0, rot: 0 };
  const bar = grid.bars[pos.pulse.bar]!;
  const since = t - bar.start;
  const k = Math.exp(-since * 7);
  return { s: k, rot: (pos.pulse.bar % 2 ? 1 : -1) * Math.exp(-since * 5) };
}

const groupPulse = {
  name: 'まとまりの脈動 (変拍子)',
  tags: ['pop', 'graphic'],
  // 文字の動きの重みはスタイルでは変えられず、ほかの文字の動きも多数あるので大きめにする。JIZURA は同じ動きが続くと
  // 重みを下げるので、これでも 2 割ほどのカット (8 行 26 カットで 5) に留まる (部品セットがオフの間は候補に入らない)
  w: 14,
  set: ODD_METER_SET,
  apply(env: PackEnv, it: PackItem, amt: number) {
    const grid = env.plan?.zzRhythm;
    if (!grid) return;
    const k = amt * (env.fx?.motion ?? 0.7);
    const a = groupPulseAmount(grid, env.t);
    if (k < 0.01 || a <= 0) return;
    it.size *= 1 + 0.09 * a * k;
  },
};

const meterBar = {
  name: '拍子の目盛り (変拍子)',
  layer: 'front',
  tags: ['graphic', 'editorial'],
  w: 1,
  set: ODD_METER_SET,
  // 帯は画面の上端か下端の決まった位置に置く (歌詞の位置は登場の動きの途中で大きく変わり、重なると読みにくかった)
  draw(env: PackEnv, _bb: unknown, P: { low?: boolean }) {
    const at = positionOf(env);
    if (!at) return;
    const { grid, pos } = at;
    const { W, H, sc } = env;
    const e = clamp01(env.lt / 0.3) * (1 - clamp01(env.pOut));
    if (e <= 0) return;
    const bar = grid.bars[pos.pulse.bar]!;
    const units = bar.groups.reduce((s, g) => s + g, 0);
    const width = W * 0.36;
    const x0 = (W - width) / 2;
    const h = Math.max(4, H * 0.012);
    const gap = Math.max(3, H * 0.007);
    const y = P?.low === false ? H * 0.1 : H * 0.88;
    const usable = width - gap * (bar.groups.length - 1);
    let x = x0;
    bar.groups.forEach((g, i) => {
      const w = (usable * g) / units;
      const cur = i === pos.pulse.group;
      env.rect(x, y, w, h, sc.fg, (i < pos.pulse.group ? 0.45 : 0.16) * e, false);
      if (cur) env.rect(x, y, w * clamp01(pos.phase), h, sc.accent, 0.95 * e, false);
      // まとまりの頭の目印 (小節の頭は長く)
      const tick = i === 0 ? h * 2.4 : h * 1.4;
      env.rect(x, y + h - tick, Math.max(2, h * 0.28), tick, i === 0 ? sc.accent : sc.fg, 0.9 * e, false);
      x += w + gap;
    });
    const size = Math.min(26, Math.max(11, H * 0.019));
    env.draw({
      text: `BAR ${pos.pulse.bar + 1}  ${bar.groups.join('+')}/${units}`,
      font: (env.st.fonts.mono && env.st.fonts.mono[0]) || 'mono',
      size,
      align: 'left',
      x: x0,
      y: y - size * 0.9,
      color: sc.sub ?? sc.fg,
      alpha: 0.9 * e,
      ghost: false,
    });
  },
};

const barPunch = {
  name: '小節の頭で寄る (変拍子)',
  tags: ['pop', 'graphic', 'glitch'],
  w: 1,
  set: ODD_METER_SET,
  get(env: PackEnv) {
    const grid = env.plan?.zzRhythm;
    const m = env.fx?.motion ?? 0.7;
    // 小節の外はふつうの「ゆっくり寄る」と同じ程度に
    const base = 1 + 0.02 * m * clamp01(env.lt / 4);
    if (!grid) return { s: base };
    const p = barPunchAmount(grid, env.t);
    return { s: base + 0.045 * m * p.s, rot: 0.8 * m * p.rot };
  },
};

// ------------------------------------------------------------------ スタイル

/**
 * 変拍子用スタイル: ノワール (無ければ最初のスタイル) を元に、変拍子パックの 3 つを選ばれやすくする。
 * 装飾・カメラの重みはスタイルの bias / decor で決まる (文字の動きは JIZURA の仕組み上、演出側の w で決まる)。
 */
export function buildOddMeterStyle(base: Record<string, unknown> & { name: string }): Record<string, unknown> & { name: string } {
  const st = JSON.parse(JSON.stringify(base)) as Record<string, unknown> & { name: string };
  const bias = (st.bias ?? {}) as Record<string, Record<string, number>>;
  st.bias = { ...bias, cam: { ...(bias.cam ?? {}), zzBarPunch: 12 } };
  st.decor = { ...((st.decor as Record<string, number>) ?? {}), zzMeterBar: 24 };
  st.name = '変拍子 (ZUNZUN)';
  st.desc = '小節の頭とまとまり (2+2+3 など) に合わせて脈打つ。Lyrics タブの「リズム (変拍子)」で小節と拍子を決めて使う';
  return st;
}

/** 変拍子パックを JIZURA に登録する (何度呼んでも 1 回だけ) */
export function registerOddMeterPack(J: PackApi): void {
  if (J.__zunzunOddMeter) return;
  J.register('hold', 'zzGroupPulse', groupPulse, ODD_METER_PACK);
  J.register('decor', 'zzMeterBar', meterBar, ODD_METER_PACK);
  J.register('cam', 'zzBarPunch', barPunch, ODD_METER_PACK);
  const base = J.STYLES.noir ?? Object.values(J.STYLES)[0];
  if (base) J.STYLES[ODD_METER_STYLE_KEY] = buildOddMeterStyle(base);
  J.__zunzunOddMeter = true;
}
