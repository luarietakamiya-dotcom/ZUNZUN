import { applyMotionEdits } from './motion-edit';
import type { AudioAnalysis } from '../audio/analyze';
import { deriveSeed, hashString, makeRng } from '../random';
import { buildRhythmGrid, rhythmPositionAt, type RhythmGrid, type RhythmPosition } from '../rhythm';
import { CUSTOM_STYLE_KEY, type LyricsCustomStyle, type LyricsSettings, type RhythmSettings } from '../types';
import { FOUR_BEAT_EFFECTS, ODD_METER_SET, ODD_METER_STYLE_KEY, registerOddMeterPack, type PackApi } from './oddmeter-pack';
import { applyMotionPack, packStyles, registerMotionPacks } from './packs';
import type { PackJ, PackPalette } from './packs/types';
import { lyricsForEngine } from './parse';
import { applyManualEnds } from './timing';
import { levelFx, mergeSectionPlans, sectionLevels, type MotionFx } from './section-motion';
import { buildLyricsView } from './view';
import type { MotionLevel } from '../types';
import { tr } from '../i18n';
import { directTypeArtPlan } from './packs/type-art-plan';
import { clearRichLayers } from './packs/claude/rich/layer';
import { prepareSubtitlePlan, subtitlePack } from './packs/gpt/subtitle';
import { MOONFEATHER_STYLE_KEY, prepareMoonPlan } from './packs/claude/moonfeather';
import { oneCutPerLine } from './mv-lines';
import { moonFeatherPack, prepareMoonPlan as prepareGptMoonPlan } from './packs/gpt/moon-feather';

/**
 * ZUNZUN と、同梱した JIZURA の歌詞モーションエンジン (vendor/jizura/jizura-engine.js、window.J) をつなぐ。
 * 同梱ファイルは改変せず、ZUNZUN に合わせる必要があるところはここで対応する (vendor/jizura/README.md):
 *
 * - 読み込み: 歌詞モーションを使うときだけ動的 import する (約 2MB。最初の画面の読み込みを重くしない)
 * - 決定論: J.Renderer は紙の質感・フィルムの粒を Math.random で作るので、Renderer を作るときと紙の質感の下準備の
 *   ときだけ Math.random を seed 付きの乱数に差し替える。カット割り (J.plan) は project.seed から J.rng で決まる
 * - 行の終了 (ZUNZUN の lineEnds): J.computeTiming を包み、core/lyrics/timing.ts と同じ applyManualEnds を当てる
 * - 音: ZUNZUN の解析結果 (ビート・音量) を、J.plan が読む形 ({ duration, beats, energy, energyRate }) にする
 * - 変拍子 (R3): 変拍子モードのときは、自動検出のビートの代わりに小節の頭と拍子から作った拍 (まとまりの頭) を beats として渡す。
 *   JIZURA が beats を使うのは、行の頭の吸着・拍ごとの色ズレの脈動・演出が読む env.beat (何拍目・拍の長さ) なので、
 *   どれも不規則な拍に従う。あわせて plan.zzRhythm に小節とまとまりの並びを添える (R4 の独自の演出が読む)
 * - 変拍子パック (R4): 読み込み時に J.register で独自の演出と変拍子用スタイルを足す (oddmeter-pack.ts)。
 *   変拍子モードがオンで、変拍子用スタイル (またはそれを元にしたマイスタイル) のときだけ選ばれるようにする
 * - フォント: J.ensureFonts で Google Fonts から読み込む (ユーザーの決定で、外部通信はフォントの取得だけ許している)
 */

// ------------------------------------------------------------------ JIZURA の型 (使う分だけ)

export interface JizuraScheme {
  bg: string;
  fg: string;
}

/** JIZURA のスタイルの定義 (J.STYLES の値)。使う項目だけ型を書き、残りはそのまま引き継ぐ */
export interface JizuraStyleDef {
  name: string;
  desc?: string;
  schemes: (JizuraScheme & Record<string, unknown>)[];
  fonts: Record<string, string[]>;
  texture?: Record<string, number>;
  ghost?: number;
  glow?: number;
  [key: string]: unknown;
}

export interface JizuraPlan {
  W: number;
  H: number;
  duration: number;
  lines: { text: string; start: number; end: number; seed?: number }[];
  cuts: unknown[];
  style: { schemes: JizuraScheme[] };
  /** J.plan が audio.beats を複製して持つビート (行の中のカットの切れ目の吸着・拍の脈動・演出の env.beat に使う) */
  beats?: number[];
  /** 動きの大きさなど (描くときにも読む。区切りで動きを変えるときは LyricMotion.render が差し替える) */
  fx?: Record<string, unknown>;
  events?: { t: number }[];
}

export interface JizuraRenderer {
  frame(ctx: CanvasRenderingContext2D, plan: JizuraPlan, t: number, opt?: Record<string, unknown>): void;
  paper(W: number, H: number): unknown;
}

export interface JizuraAudio {
  duration: number;
  beats: number[];
  energy: Float32Array;
  energyRate: number;
}

interface JizuraTiming {
  starts: number[];
  ends: number[];
  duration: number;
}

export interface JizuraApi {
  order(group: string): string[];
  registry(group: string): Record<string, { name: string; special?: boolean; tags?: string[]; pack?: string }>;
  randomOk?(project: Record<string, unknown>, group: string, key: string): boolean;
  lineSnapshot(plan: JizuraPlan, line: number): Record<string, unknown>[] | null;
  defaultProject(): Record<string, unknown> & { timing: Record<string, unknown> };
  plan(project: Record<string, unknown>, audio: JizuraAudio | null): JizuraPlan;
  Renderer: new () => JizuraRenderer;
  computeTiming(project: Record<string, unknown>, parsed: unknown, audio: JizuraAudio | null): JizuraTiming;
  parseLyrics(raw: string): { lines: unknown[]; meta: Record<string, string> };
  fontsOfPlan(plan: JizuraPlan): string[];
  ensureFonts(text: string, keys: string[] | null): Promise<void>;
  glyphs: { clear(): void; get(fontKey: string, ch: string, px: number): { res: number; pieces: { id: number }[] } } & { __zunzunIds?: boolean };
  metrics: { clear(): void };
  STYLE_ORDER: string[];
  STYLES: Record<string, JizuraStyleDef>;
  FONTS: Record<string, { label: string; kind?: string; user?: boolean }>;
  /** 色の明るさ (0..1) */
  lum(color: string): number;
  /** 文字を 1 つ描く (ぼかし・影があると、内側の作業用 canvas に描いてから重ねる) */
  drawItem(env: Record<string, unknown>, item: Record<string, unknown>): unknown;
  __zunzunTimingPatched?: boolean;
  register: PackApi['register'];
  __zunzunOddMeter?: boolean;
}

// ------------------------------------------------------------------ 読み込み

let loading: Promise<JizuraApi> | null = null;

/** JIZURA を読み込む (2 回目以降は同じものを返す)。 */
export function loadJizura(): Promise<JizuraApi> {
  loading ??= import('../../../vendor/jizura/jizura-engine.js').then(() => {
    const J = (globalThis as unknown as { J?: JizuraApi }).J;
    if (!J || typeof J.plan !== 'function') throw new Error(tr('歌詞の動きの仕組み (JIZURA) を読み込めませんでした', 'Could not load the lyric motion engine (JIZURA)'));
    installTimingPatch(J);
    installAspectPatch(J);
    installGlyphIdPatch(J);
    registerOddMeterPack(J as unknown as PackApi);
    // オリジナルの歌詞モーション (演出パック: 静寂 など)。そのスタイルのときだけ候補に入る (packs/index.ts)
    registerMotionPacks(J as unknown as PackJ);
    return J;
  });
  return loading;
}

/**
 * J.designSize に、JIZURA が持っていない比率 (ZUNZUN が書き出しに足した 2:3 と 3:2) を足す。一度だけ行う。
 * 持っていない比率は一番近い比率 (3:4 / 4:3) の板に収めるしかなく、画面に余白ができた
 * (2026-10-03 ユーザー「リリックモーションのとこも縦長にしないと」)。
 */
export function installAspectPatch(J: JizuraApi): void {
  const api = J as unknown as { designSize: (aspect: string) => [number, number]; __zunzunAspectPatched?: boolean };
  if (api.__zunzunAspectPatched || typeof api.designSize !== 'function') return;
  api.__zunzunAspectPatched = true;
  const orig = api.designSize.bind(api);
  api.designSize = (aspect) => (aspect === '2:3' ? [1080, 1620] : aspect === '3:2' ? [1620, 1080] : orig(aspect));
}

/** J.computeTiming を包んで、ZUNZUN の lineEnds (手で決めた行の終了) を反映する。一度だけ行う。 */
export function installTimingPatch(J: JizuraApi): void {
  if (J.__zunzunTimingPatched) return;
  const orig = J.computeTiming.bind(J);
  J.computeTiming = (project, parsed, audio) => {
    const tm = orig(project, parsed, audio);
    const T = (project.timing ?? {}) as { lineEnds?: Record<string, number>; tail?: number; useAudioLength?: boolean };
    if (T.lineEnds && Object.keys(T.lineEnds).length > 0) {
      applyManualEnds(tm.starts, tm.ends, T.lineEnds);
      // 全体の長さも J.computeTiming と同じ式で求め直す (最後の行の終了が変わることがあるため)
      const last = tm.ends.length ? tm.ends[tm.ends.length - 1]! : 3;
      tm.duration = audio?.duration && T.useAudioLength !== false ? Math.max(audio.duration, last + 0.2) : last + (T.tail ?? 0.9);
    }
    return tm;
  };
  J.__zunzunTimingPatched = true;
}

/**
 * 決定論のための修正: JIZURA は文字を部品 (画の塊) に分けたとき、部品に**全体で 1 つの数え上げの番号** (_pid) を付け、
 * 文字を破片に砕く演出 (J.fragments。爆散・崩落などの退場) がその番号を乱数の種に使う。番号はそれまでに文字をいくつ
 * 分けたかで決まるので、歌詞モーションを作るたびに (セッションごとにも) 破片の形が変わり、同じプロジェクトでも
 * 書き出しの数コマが違っていた (2026-09-30、既存のノワールでも 232 コマ中 9 コマ、画面の最大 13% が違った)。
 * J.glyphs.get を包み、部品の番号を「書体・文字・大きさの段階・何番目の部品か」から決まる値に付け直す (同梱ファイルは改変しない)。
 * 番号は色付きの部品の置き場 (tint) のキーにも使われるが、文字ごとに違う値なので問題ない。
 */
export function installGlyphIdPatch(J: JizuraApi): void {
  if (J.glyphs.__zunzunIds) return;
  const orig = J.glyphs.get.bind(J.glyphs);
  J.glyphs.get = (fontKey, ch, px) => {
    const g = orig(fontKey, ch, px) as ReturnType<typeof orig> & { __zzIds?: boolean };
    if (g && !g.__zzIds) {
      const base = hashString(`${fontKey}|${ch}|${g.res}`);
      // 正の整数 (J.r / J.rs の引数として元の番号と同じ種類の値)
      g.pieces.forEach((pc, k) => (pc.id = ((base + k * 2654435761) >>> 0) % 2147483647 || 1));
      g.__zzIds = true;
    }
    return g;
  };
  J.glyphs.__zunzunIds = true;
}

/**
 * 決定論のための下ごしらえ: JIZURA はぼかし・影のある文字を、内側の作業用 canvas (layerCv。ページ全体で 1 つ、
 * 大きくなるだけで小さくならない) に描いてから重ねる。描く前に消すのは「その文字の分の範囲」だけなので、
 * その外に**前に描いた文字の跡が残り、ぼかしで重ねるときにわずかに混ざる**。そのため、直前に何を描いていたかで
 * 絵が変わり、ページを開いて最初に作った歌詞モーションだけ数コマ違った (衝撃・図案で確認。2026-09-30)。
 * 歌詞モーションを作るたびに、作業用 canvas を十分な大きさまで広げたうえで**全体を透明に消しておく**
 * (透明な大きな文字を 1 つ、ぼかし付きで捨て用の canvas に描く = JIZURA が作業用 canvas のその範囲を消す)。
 * これで、どの歌詞モーションも同じ状態から描き始める (書き出しは作ってから最初から順に描くので、毎回同じ絵になる)。
 */
let warmCanvas: HTMLCanvasElement | null = null;
export function resetLayerCanvas(J: JizuraApi, width: number, height: number): void {
  if (typeof document === 'undefined' || typeof J.drawItem !== 'function') return;
  // 作業用 canvas は「出力の面積の 1.6 倍まで」の文字にだけ使われる。1 辺は出力の長い辺の 1.3 倍あればほぼ足りる
  const L = Math.max(2, Math.ceil(Math.max(width, height) * 1.3));
  if (!warmCanvas || warmCanvas.width < L) {
    warmCanvas = document.createElement('canvas');
    warmCanvas.width = L;
    warmCanvas.height = L;
  }
  const ctx = warmCanvas.getContext('2d');
  if (!ctx) return;
  const n = warmCanvas.width;
  const env = { ctx, pass: 'main', scale: 1, allowFilter: true, W: n, H: n };
  try {
    // 文字の枠 (大きさの約 1.22 倍) が canvas の 1 辺を少し超える大きさ。色は透明なので何も描かれない
    J.drawItem(env, { text: '■', font: 'gothic_bold', size: n * 0.84, x: n / 2, y: n / 2, blur: 2, color: 'rgba(0,0,0,0)' });
  } catch {
    // 下ごしらえなので、失敗しても描画は続けられる
  }
}

// ------------------------------------------------------------------ 入力の変換 (純粋関数)

/** 歌詞の画面の比率 (J.designSize + installAspectPatch で足した 2:3 / 3:2) */
export const JIZURA_ASPECTS: readonly (readonly [string, number])[] = [
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['21:9', 21 / 9],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['2:3', 2 / 3],
  ['3:2', 3 / 2],
];

/** 書き出しの幅・高さに最も近い JIZURA の比率 */
export function nearestAspect(width: number, height: number): string {
  const r = width > 0 && height > 0 ? Math.log(width / height) : 0;
  let best = '16:9';
  let bestD = Infinity;
  for (const [name, ratio] of JIZURA_ASPECTS) {
    const d = Math.abs(Math.log(ratio) - r);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/** 音量の列を JIZURA と同じく 95 パーセンタイルで 0..1 に正規化する (JIZURA の src/10_audio.js と同じ扱い) */
export function normalizeEnergy(rms: Float32Array): Float32Array {
  const out = new Float32Array(rms.length);
  if (rms.length === 0) return out;
  const sorted = Array.from(rms, (v) => (Number.isFinite(v) ? v : 0)).sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! || 1;
  for (let i = 0; i < rms.length; i++) {
    const v = rms[i]!;
    out[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, v / p95)) : 0;
  }
  return out;
}

/**
 * 歌詞モーションに使う小節と拍子。変拍子モードがオンで、小節が 1 つ以上作れるときだけ返す (それ以外は null =
 * 自動検出のビートを使う)。
 */
export function motionRhythmGrid(rhythm: RhythmSettings | null | undefined): RhythmGrid | null {
  if (!rhythm?.enabled) return null;
  const grid = buildRhythmGrid(rhythm);
  return grid.bars.length > 0 ? grid : null;
}

/**
 * ZUNZUN の解析結果を、J.plan が読む音の情報にする。rhythm (motionRhythmGrid の結果) があれば、
 * ビートは自動検出のものではなく、小節の頭と拍子から作った拍 (まとまりの頭) にする。
 * 小節の外 (最初の小節より前のイントロ・最後の小節より後ろ) には拍が無い (自動のビートは変拍子と合わないので混ぜない)。
 */
export function buildJizuraAudio(
  analysis: Pick<AudioAnalysis, 'duration' | 'beats' | 'rms' | 'frameRate'>,
  rhythm: RhythmGrid | null = null,
): JizuraAudio {
  return {
    duration: analysis.duration,
    beats: (rhythm ? rhythm.beats : analysis.beats).slice().sort((a, b) => a - b),
    energy: normalizeEnergy(analysis.rms),
    energyRate: analysis.frameRate,
  };
}

export interface JizuraProjectOptions {
  /** project.seed。Host と同じく project.seed から派生させた値を渡す (lyricMotionSeed) */
  seed: number;
  aspect: string;
  fps: number;
  /**
   * 変拍子パックを使うか (変拍子モードがオン、かつ変拍子用スタイルのとき)。オンなら部品セット ODD_METER_SET をオンにし、
   * 「4 拍でひと回り」の演出 (FOUR_BEAT_EFFECTS) を無効にする
   */
  oddMeter?: boolean;
}

/** 変拍子パックを使う組み合わせか: 小節と拍子があり (変拍子モードがオン)、変拍子用スタイルか、それを元にしたマイスタイル */
export function usesOddMeterPack(motion: LyricsSettings['motion'], rhythm: RhythmGrid | null | undefined): boolean {
  if (!rhythm) return false;
  return motion.style === ODD_METER_STYLE_KEY || (motion.style === CUSTOM_STYLE_KEY && motion.custom?.base === ODD_METER_STYLE_KEY);
}

/** project.seed から、歌詞モーション用の seed を派生させる (プリセットごとの seed と同じ作り方) */
export function lyricMotionSeed(projectSeed: number): number {
  return deriveSeed(projectSeed, 'lyrics');
}

/**
 * ZUNZUN の歌詞の設定から JIZURA のプロジェクトを作る。defaults は J.defaultProject() の結果
 * (JIZURA を読み込まずにテストできるように引数で受け取る)。
 */
export function buildJizuraProject(
  lyrics: LyricsSettings,
  defaults: Record<string, unknown> & { timing: Record<string, unknown> },
  opts: JizuraProjectOptions,
): Record<string, unknown> {
  const fx = (defaults.fx ?? {}) as Record<string, unknown>;
  const enabled = (defaults.enabled ?? {}) as Record<string, Record<string, boolean>>;
  const trans = { ...(enabled.trans ?? {}) };
  for (const k of COVERING_TRANSITIONS) trans[k] = false;
  const layout = { ...(enabled.layout ?? {}) };
  for (const k of COVERING_LAYOUTS) layout[k] = false;
  const groups: Record<string, Record<string, boolean>> = { ...enabled, trans, layout };
  if (opts.oddMeter) {
    for (const [g, keys] of Object.entries(FOUR_BEAT_EFFECTS)) {
      groups[g] = { ...(groups[g] ?? {}) };
      for (const k of keys) groups[g][k] = false;
    }
  }
  return {
    ...defaults,
    ...(opts.oddMeter ? { [ODD_METER_SET]: true } : {}),
    enabled: groups,
    lyrics: lyricsForEngine(lyrics.text, lyrics.source),
    title: '',
    artist: '',
    seed: opts.seed >>> 0,
    aspect: opts.aspect,
    fps: opts.fps,
    style: lyrics.motion.style,
    fx: { ...fx, motion: lyrics.motion.motion, decor: lyrics.motion.decor, density: lyrics.motion.density },
    timing: {
      ...defaults.timing,
      lineTimes: { ...lyrics.timing.lineTimes },
      lineEnds: { ...lyrics.timing.lineEnds },
    },
  };
}

/**
 * ビジュアライザーの上に重ねるときに使わない場面転換 (JIZURA の enabled.trans で無効にする)。
 * 途中のコマで画面の半分以上を塗りつぶすもの。JIZURA 単体 (背景を描く) なら見栄えのする演出だが、重ねると
 * その間ビジュアライザーが隠れる (クリムゾンで knCornerSwing が画面全体を赤く塗った)。
 * 2026-09-28 に commit 8da975f の 27 種を 1 つずつ強制して描いて測った結果。レイアウトや文字の処理なども
 * 測ったが、覆っていたのは同じコマで偶然選ばれた場面転換だけだった。
 * JIZURA を更新したときは tests/e2e/visual.spec.ts の「画面を覆う場面転換」のテストが新しい候補を見つける。
 */
export const COVERING_TRANSITIONS: readonly string[] = [
  'knCornerSwing',
  'knStutterCut',
  'uncover',
  'zoomThrough',
  'doorsOpen',
  'whipPan',
  'spinOut',
  'inkBlob',
  'cubeTurn',
  'hrBlink',
];

/**
 * ビジュアライザーの上に重ねるときに使わないレイアウト (JIZURA の enabled.layout で無効にする)。
 * 画面の 8 割以上を塗る (障子・カーテン・ジッパー・字幕の帯・新聞など、背景ごと描くもの) ため、重ねると映像が隠れる。
 * 場面転換を固定して、noir と crimson でレイアウト 184 種を 1 つずつ描いて測った (2026-09-28、commit 8da975f)。
 * 紙やカードを描くもの (はがき・ポラロイドなど、5〜6 割) は「歌詞が書かれた小道具」なので残した。
 * 文字の飾り (treat)・装飾 (decor)・画面効果 (fx) は画面を覆わなかった。
 */
export const COVERING_LAYOUTS: readonly string[] = [
  'hrFlashlight',
  'subtitleBar',
  'shoji',
  'zipper',
  'curtain',
  'hrDoorGap',
  'hrCctv',
  'magnets',
  'newspaper',
  'wordSearch',
];

/** 文字が明るい配色とみなす明るさ (これ以上) */
const LIGHT_TEXT_LUM = 0.45;

/**
 * 背景なしでビジュアライザーの上に重ねるための配色の選び直し。JIZURA のスタイルにはカットごとに
 * 「明るい背景 + 暗い文字」(例: noir の 2 つ目) や「暗い背景 + 暗い文字」(例: acid) の配色が混ざっていて、
 * 背景を描かずに暗い映像へ重ねると文字が読めない。文字が明るい配色だけを残し、各カットの配色番号を付け替える。
 * 同梱ファイルは改変せず、J.plan が返した plan のデータだけを調整する。文字が明るい配色が 1 つも無ければ何もしない。
 * 書き換えた plan を返す (引数の plan を直接書き換える)。
 */
export function keepLightTextSchemes(plan: JizuraPlan, lum: (color: string) => number): JizuraPlan {
  const schemes = plan.style.schemes;
  const keep = schemes.flatMap((s, i) => (lum(s.fg) >= LIGHT_TEXT_LUM ? [i] : []));
  if (keep.length === 0 || keep.length === schemes.length) return plan;
  plan.style.schemes = keep.map((i) => schemes[i]!);
  for (const cut of plan.cuts as { scheme?: number }[]) {
    if (typeof cut.scheme !== 'number') continue;
    const at = keep.indexOf(cut.scheme % schemes.length);
    cut.scheme = at >= 0 ? at : cut.scheme % keep.length;
  }
  return plan;
}

// ------------------------------------------------------------------ オリジナルのスタイル (L7)

/**
 * JIZURA のスタイルから、オリジナルのスタイルの初期値を作る (「このスタイルを元に作る」)。
 * 色は、文字が明るい配色 (重ねて読める配色) の最初のものから取る。
 */
export function customFromStyle(baseKey: string, style: JizuraStyleDef, lum: (c: string) => number): LyricsCustomStyle {
  const scheme = style.schemes.find((s) => lum(s.fg) >= LIGHT_TEXT_LUM) ?? style.schemes[0]!;
  const str = (v: unknown, fallback: string): string => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback);
  const fg = str(scheme.fg, '#ffffff');
  const accent = str(scheme.accent, '#f5a50c');
  const accent2 = str(scheme.accent2, accent);
  return {
    name: `${style.name} のアレンジ`.slice(0, 40),
    base: baseKey,
    colors: {
      fg,
      sub: str(scheme.sub, fg),
      accent,
      accent2,
      ghostA: str(scheme.ghostA, accent),
      ghostB: str(scheme.ghostB, accent2),
    },
    fonts: { display: style.fonts.display?.[0] ?? '', serif: style.fonts.serif?.[0] ?? '', body: style.fonts.body?.[0] ?? '' },
    texture: {
      grain: Math.min(1, Math.max(0, style.texture?.grain ?? 0.5)),
      scan: Math.min(1, Math.max(0, style.texture?.scan ?? 0)),
      ghost: Math.min(1.5, Math.max(0, style.ghost ?? 1)),
      glow: Math.min(1, Math.max(0, style.glow ?? 0)),
    },
  };
}

/**
 * オリジナルのスタイルから JIZURA のスタイルの定義を作る。元のスタイルを複製し、
 * - 配色は「暗い背景」のものだけを残して (明るい背景を自分で塗る配色は、明るい文字にすると読めない)、色を差し替える
 * - 書体は、JIZURA にある書体のキーが指定されていれば差し替える
 * - 質感 (粒・走査線)・色ズレの強さ・光のにじみ・名前を差し替える
 * 演出の好み (bias) や装飾 (decor) などは元のスタイルのまま。
 */
export function buildCustomStyle(
  base: JizuraStyleDef,
  custom: LyricsCustomStyle,
  lum: (c: string) => number,
  fontExists: (key: string) => boolean,
): JizuraStyleDef {
  const st = JSON.parse(JSON.stringify(base)) as JizuraStyleDef;
  const c = custom.colors;
  let schemes = st.schemes.filter((s) => lum(s.bg) < 0.5 && !s.swap && !s.paper);
  if (schemes.length === 0) schemes = [{ ...st.schemes[0]!, bg: '#000000', swap: false, paper: false }];
  st.schemes = schemes.map((s) => {
    const o: JizuraScheme & Record<string, unknown> = { ...s, fg: c.fg, sub: c.sub, accent: c.accent, accent2: c.accent2, ghostA: c.ghostA, ghostB: c.ghostB };
    // ink は「アクセントと同じ色で描く部分」か「文字と同じ色で描く部分」のどちらか。元の役割を保つ
    o.ink = s.ink === s.accent ? c.accent : c.fg;
    if (Array.isArray(s.grad)) o.grad = [c.accent, c.accent2];
    return o;
  });
  st.fonts = { ...st.fonts };
  for (const role of ['display', 'serif', 'body'] as const) {
    const key = custom.fonts[role];
    if (key && fontExists(key)) st.fonts[role] = [key];
  }
  st.texture = { ...(st.texture ?? {}), grain: custom.texture.grain, scan: custom.texture.scan };
  st.ghost = custom.texture.ghost;
  st.glow = custom.texture.glow;
  st.name = custom.name;
  return st;
}

/** オリジナルのスタイルを JIZURA のスタイル一覧に登録する (同梱ファイルは改変しない。ランダムに選ばれる一覧には入れない) */
export function registerCustomStyle(J: JizuraApi, custom: LyricsCustomStyle): void {
  const base = J.STYLES[custom.base] ?? J.STYLES.noir!;
  J.STYLES[CUSTOM_STYLE_KEY] = buildCustomStyle(base, custom, (c) => J.lum(c), (k) => !!J.FONTS[k] && !J.FONTS[k]!.user);
}

/** 書体の一覧 (選択肢の表示用): [キー, 名前]。ユーザーが読み込んだ書体は除く (このブラウザにしか無いため) */
export function jizuraFonts(J: JizuraApi): [string, string][] {
  return Object.entries(J.FONTS)
    .filter(([, f]) => !f.user)
    .map(([k, f]) => [k, f.label]);
}

/** 文字の色が暗すぎて、重ねると読みにくいか */
export function isDarkText(color: string, lum: (c: string) => number): boolean {
  return lum(color) < LIGHT_TEXT_LUM;
}

/** スタイルの一覧 (選択肢の表示用): [キー, 名前] */
export function jizuraStyles(J: JizuraApi): [string, string][] {
  // 変拍子用スタイル (R4) は JIZURA のランダムなスタイル選びに入れないため STYLE_ORDER には無い。一覧の先頭に出す
  // オリジナルの歌詞モーション (演出パック) も同じく先頭に出す
  const odd: [string, string][] = J.STYLES[ODD_METER_STYLE_KEY] ? [[ODD_METER_STYLE_KEY, J.STYLES[ODD_METER_STYLE_KEY]!.name]] : [];
  const packs = packStyles(J);
  const own = new Set([ODD_METER_STYLE_KEY, ...packs.map(([k]) => k)]);
  return [...packs, ...odd, ...J.STYLE_ORDER.filter((k) => J.STYLES[k] && !own.has(k)).map((k): [string, string] => [k, J.STYLES[k]!.name])];
}

// ------------------------------------------------------------------ 描画

/** HUD (時刻や英数字の飾り) に使われる文字。フォントの読み込み対象に足す */
const HUD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:.,-/+%#';
/** フォントの読み込みを待つ上限 (オフラインなどで返ってこないときに固まらないように) */
const FONT_TIMEOUT_MS = 10_000;

function withSeededRandom<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  Math.random = makeRng(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

export interface LyricMotionOptions {
  /** project.seed (ここから lyricMotionSeed で派生させる) */
  projectSeed: number;
  width: number;
  height: number;
  fps: number;
  /** 変拍子モードの小節と拍子 (motionRhythmGrid の結果)。audio の beats もこれから作っておくこと */
  rhythm?: RhythmGrid | null;
  /** 背景から読み取った色 (オリジナルの歌詞モーション「余白」が文字の色に使う。core/render/palette.ts) */
  palette?: PackPalette | null;
}

/** 変拍子モードで作った plan に添える、小節とまとまりの並び (ZUNZUN の拡張。JIZURA 本体は読まない) */
export type PlanWithRhythm = JizuraPlan & { zzRhythm?: RhythmGrid };

/** plan に小節とまとまりの並びを添える (null なら外す)。引数の plan を書き換えて返す */
export function attachRhythm(plan: JizuraPlan, rhythm: RhythmGrid | null): PlanWithRhythm {
  const p = plan as PlanWithRhythm;
  if (rhythm) p.zzRhythm = rhythm;
  else delete p.zzRhythm;
  return p;
}

/** plan の時刻 t が何小節目・何番目のまとまりのどこか (変拍子モードでない・小節の外なら null)。R4 の演出が使う */
export function planRhythmAt(plan: JizuraPlan, t: number): RhythmPosition | null {
  const grid = (plan as PlanWithRhythm).zzRhythm;
  return grid ? rhythmPositionAt(grid, t) : null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 読み込み中のフォントが無くなるまで待つ (上限 timeoutMs) */
async function waitFontsIdle(timeoutMs: number): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && [...fonts].some((f) => f.status === 'loading')) {
    await Promise.race([fonts.ready, sleep(200)]);
  }
}

/**
 * 書体の準備。J.ensureFonts で事前に読み込んでも、実際に描き始めてから読み込まれる書体がある
 * (Google Fonts は文字の範囲ごとに分けて配信している。E2E で、1 回目の描画だけ Noto Serif JP 700 が読み込み中で
 * 別の書体で描かれ、2 回目以降と画像が違っていた)。そこで、捨てる用の Renderer で全カットを小さく 1 回ずつ描いて
 * 読み込みを始めさせ、読み込み中の書体が無くなるまで待ってから、仮の書体で作られた文字のキャッシュを消す。
 */
async function prepareFonts(J: JizuraApi, plan: JizuraPlan, text: string): Promise<void> {
  const deadline = Date.now() + FONT_TIMEOUT_MS;
  await Promise.race([J.ensureFonts(text, J.fontsOfPlan(plan)).catch(() => undefined), sleep(FONT_TIMEOUT_MS)]);
  if (typeof document === 'undefined') return;
  const probe = document.createElement('canvas');
  probe.width = 320;
  probe.height = Math.max(1, Math.round((320 * plan.H) / plan.W));
  const ctx = probe.getContext('2d');
  if (ctx) {
    const scratch = new J.Renderer(); // 下描き専用 (この Renderer の乱数や内部のキャッシュは本番の描画に使わない)
    const cuts = plan.cuts as { start?: number; end?: number }[];
    for (const c of cuts.slice(0, 600)) {
      if (typeof c.start !== 'number' || typeof c.end !== 'number') continue;
      for (const t of [c.start + 0.15, (c.start + c.end) / 2]) {
        try {
          scratch.frame(ctx, plan, t, { scale: probe.width / plan.W, transparent: true, fast: true });
        } catch {
          // 下描きが失敗しても、本番の描画には影響させない
        }
      }
    }
  }
  await waitFontsIdle(Math.max(0, deadline - Date.now()));
  J.glyphs.clear();
  J.metrics.clear();
  clearRichLayers();
}

/**
 * 1 つの歌詞・設定に対する歌詞モーション。カット割り (plan) と Renderer を持ち、任意の時刻のコマを透過で描く。
 * 歌詞・時刻・書き出しサイズが変わったら作り直す (作り直しても同じ設定なら同じ絵になる)。
 * create() は書体の準備 (上限 10 秒) が終わってから返すので、描いた絵は何回目でも同じ書体になる。
 */
export class LyricMotion {
  private constructor(
    readonly plan: JizuraPlan,
    private readonly renderer: JizuraRenderer,
    /** 区切りごとの描くときの fx (区切りで動きを変えないときは null) */
    private readonly fxSpans: { start: number; end: number; fx: Record<string, unknown> }[] | null = null,
  ) {}

  /** 区切りで動きを変えているか (テスト・表示用) */
  get sectionLevels(): { start: number; end: number; level: MotionLevel }[] | null {
    return this.levelSpans;
  }
  private levelSpans: { start: number; end: number; level: MotionLevel }[] | null = null;

  static async create(lyrics: LyricsSettings, audio: JizuraAudio | null, opts: LyricMotionOptions): Promise<LyricMotion> {
    const J = await loadJizura();
    if (lyrics.motion.style === CUSTOM_STYLE_KEY && lyrics.motion.custom) registerCustomStyle(J, lyrics.motion.custom);
    const seed = lyricMotionSeed(opts.projectSeed);
    const project = buildJizuraProject(lyrics, J.defaultProject(), {
      seed,
      aspect: nearestAspect(opts.width, opts.height),
      fps: opts.fps,
      oddMeter: usesOddMeterPack(lyrics.motion, opts.rhythm),
    });
    applyMotionPack(project, lyrics.motion, J as unknown as PackJ, { palette: opts.palette ?? null });
    applyMotionEdits(project, lyrics.motion, buildLyricsView(lyrics).parsed.lines.map((l) => l.text), { layout: COVERING_LAYOUTS, trans: COVERING_TRANSITIONS });
    const makePlan = (fx?: MotionFx): JizuraPlan => {
      const p = fx ? { ...project, fx: { ...(project.fx as Record<string, unknown>), ...fx } } : project;
      return attachRhythm(keepLightTextSchemes(J.plan(p, audio), (c) => J.lum(c)), opts.rhythm ?? null);
    };
    // 曲の区切り (歌詞の [サビ] などの見出し) ごとに動きの強さを変える (core/lyrics/section-motion.ts)。
    // 強さごとに段取りを作り、区切りごとにその強さのカットと効果をつなぐ。描くときも区切りの強さの fx を渡す
    const lyricsView = buildLyricsView(lyrics, audio?.duration);
    const sections = lyricsView.sections;
    const spans = sectionLevels(sections, lyrics.motion.sections);
    let plan: JizuraPlan;
    let fxSpans: { start: number; end: number; fx: Record<string, unknown> }[] | null = null;
    if (spans) {
      const pfx = project.fx as Record<string, number>;
      const base: MotionFx = { motion: pfx.motion ?? lyrics.motion.motion, decor: pfx.decor ?? lyrics.motion.decor, density: pfx.density ?? lyrics.motion.density };
      const used = new Set(spans.map((sp) => sp.level));
      const normal = makePlan(levelFx(base, 'normal'));
      const plans = {
        normal,
        calm: used.has('calm') ? makePlan(levelFx(base, 'calm')) : normal,
        intense: used.has('intense') ? makePlan(levelFx(base, 'intense')) : normal,
      } as Record<MotionLevel, JizuraPlan & { cuts: { start: number; line?: number }[]; events: { t: number }[] }>;
      plan = mergeSectionPlans(plans, spans);
      const planFx = (plan.fx ?? {}) as Record<string, unknown>;
      fxSpans = spans.map((sp) => ({ start: sp.start, end: sp.end, fx: { ...planFx, ...levelFx(base, sp.level) } }));
    } else plan = makePlan();
    directTypeArtPlan(plan, lyrics.motion);
    if (lyrics.motion.style === subtitlePack.styleKey || (lyrics.motion.style === CUSTOM_STYLE_KEY && lyrics.motion.custom?.base === subtitlePack.styleKey)) prepareSubtitlePlan(plan);
    if (lyrics.motion.style === moonFeatherPack.styleKey || (lyrics.motion.style === CUSTOM_STYLE_KEY && lyrics.motion.custom?.base === moonFeatherPack.styleKey)) prepareGptMoonPlan(plan, sections, lyricsView.times.starts);
    if (lyrics.motion.style === MOONFEATHER_STYLE_KEY || (lyrics.motion.style === CUSTOM_STYLE_KEY && lyrics.motion.custom?.base === MOONFEATHER_STYLE_KEY)) prepareMoonPlan(plan, sections, audio?.duration ?? 0);
    // MV 用（字幕の帯）は 1 行を頭から終わりまで丸ごと見せる（かけら・まとめ直しをしない。2026-10-08 姫）
    if ([subtitlePack.styleKey, MOONFEATHER_STYLE_KEY].some((k) => lyrics.motion.style === k || (lyrics.motion.style === CUSTOM_STYLE_KEY && lyrics.motion.custom?.base === k))) oneCutPerLine(plan);
    await prepareFonts(J, plan, lyricsForEngine(lyrics.text, lyrics.source) + HUD_CHARS);
    // 本番の Renderer は書体の準備が終わってから作る (内部のキャッシュに仮の書体の文字を残さない)
    const renderer = withSeededRandom(deriveSeed(seed, 'renderer'), () => {
      const r = new J.Renderer();
      r.paper(plan.W, plan.H); // 紙の質感はここで作ってキャッシュさせる (描画中に Math.random を呼ばせない)
      return r;
    });
    resetLayerCanvas(J, opts.width, opts.height);
    const motion = new LyricMotion(plan, renderer, fxSpans);
    motion.levelSpans = spans;
    return motion;
  }

  /** 時刻 t のコマを ctx の canvas いっぱいに透過で描く。fast = プレビュー向けの軽い描画 (ぼかし等を省く) */
  render(ctx: CanvasRenderingContext2D, t: number, opts: { fast?: boolean } = {}): void {
    const scale = ctx.canvas.width / this.plan.W;
    if (this.fxSpans) {
      // 今いる区切りの強さで描く (JIZURA は描くときに plan.fx を読む)
      const sp = this.fxSpans.find((s) => t >= s.start && t < s.end) ?? this.fxSpans[this.fxSpans.length - 1];
      if (sp) this.plan.fx = sp.fx;
    }
    this.renderer.frame(ctx, this.plan, Math.max(0, t), { scale, transparent: true, fast: !!opts.fast });
  }
}
