import type { AudioAnalysis } from '../audio/analyze';
import { deriveSeed, makeRng } from '../random';
import type { LyricsSettings } from '../types';
import { lyricsForEngine } from './parse';
import { applyManualEnds } from './timing';

/**
 * ZUNZUN と、同梱した JIZURA の歌詞モーションエンジン (vendor/jizura/jizura-engine.js、window.J) をつなぐ。
 * 同梱ファイルは改変せず、ZUNZUN に合わせる必要があるところはここで対応する (vendor/jizura/README.md):
 *
 * - 読み込み: 歌詞モーションを使うときだけ動的 import する (約 2MB。最初の画面の読み込みを重くしない)
 * - 決定論: J.Renderer は紙の質感・フィルムの粒を Math.random で作るので、Renderer を作るときと紙の質感の下準備の
 *   ときだけ Math.random を seed 付きの乱数に差し替える。カット割り (J.plan) は project.seed から J.rng で決まる
 * - 行の終了 (ZUNZUN の lineEnds): J.computeTiming を包み、core/lyrics/timing.ts と同じ applyManualEnds を当てる
 * - 音: ZUNZUN の解析結果 (ビート・音量) を、J.plan が読む形 ({ duration, beats, energy, energyRate }) にする
 * - フォント: J.ensureFonts で Google Fonts から読み込む (ユーザーの決定で、外部通信はフォントの取得だけ許している)
 */

// ------------------------------------------------------------------ JIZURA の型 (使う分だけ)

export interface JizuraPlan {
  W: number;
  H: number;
  duration: number;
  lines: { text: string; start: number; end: number }[];
  cuts: unknown[];
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
  defaultProject(): Record<string, unknown> & { timing: Record<string, unknown> };
  plan(project: Record<string, unknown>, audio: JizuraAudio | null): JizuraPlan;
  Renderer: new () => JizuraRenderer;
  computeTiming(project: Record<string, unknown>, parsed: unknown, audio: JizuraAudio | null): JizuraTiming;
  parseLyrics(raw: string): { lines: unknown[]; meta: Record<string, string> };
  fontsOfPlan(plan: JizuraPlan): string[];
  ensureFonts(text: string, keys: string[] | null): Promise<void>;
  glyphs: { clear(): void };
  metrics: { clear(): void };
  __zunzunTimingPatched?: boolean;
}

// ------------------------------------------------------------------ 読み込み

let loading: Promise<JizuraApi> | null = null;

/** JIZURA を読み込む (2 回目以降は同じものを返す)。 */
export function loadJizura(): Promise<JizuraApi> {
  loading ??= import('../../../vendor/jizura/jizura-engine.js').then(() => {
    const J = (globalThis as unknown as { J?: JizuraApi }).J;
    if (!J || typeof J.plan !== 'function') throw new Error('JIZURA のエンジンを読み込めませんでした');
    installTimingPatch(J);
    return J;
  });
  return loading;
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

// ------------------------------------------------------------------ 入力の変換 (純粋関数)

/** JIZURA が持っている画面の比率 (J.designSize) */
export const JIZURA_ASPECTS: readonly (readonly [string, number])[] = [
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['21:9', 21 / 9],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
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

/** ZUNZUN の解析結果を、J.plan が読む音の情報にする */
export function buildJizuraAudio(analysis: Pick<AudioAnalysis, 'duration' | 'beats' | 'rms' | 'frameRate'>): JizuraAudio {
  return {
    duration: analysis.duration,
    beats: analysis.beats.slice().sort((a, b) => a - b),
    energy: normalizeEnergy(analysis.rms),
    energyRate: analysis.frameRate,
  };
}

export interface JizuraProjectOptions {
  /** project.seed。Host と同じく project.seed から派生させた値を渡す (lyricMotionSeed) */
  seed: number;
  aspect: string;
  fps: number;
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
  return {
    ...defaults,
    lyrics: lyricsForEngine(lyrics.text, lyrics.source),
    title: '',
    artist: '',
    seed: opts.seed >>> 0,
    aspect: opts.aspect,
    fps: opts.fps,
    timing: {
      ...defaults.timing,
      lineTimes: { ...lyrics.timing.lineTimes },
      lineEnds: { ...lyrics.timing.lineEnds },
    },
  };
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
  ) {}

  static async create(lyrics: LyricsSettings, audio: JizuraAudio | null, opts: LyricMotionOptions): Promise<LyricMotion> {
    const J = await loadJizura();
    const seed = lyricMotionSeed(opts.projectSeed);
    const project = buildJizuraProject(lyrics, J.defaultProject(), { seed, aspect: nearestAspect(opts.width, opts.height), fps: opts.fps });
    const plan = J.plan(project, audio);
    await prepareFonts(J, plan, lyricsForEngine(lyrics.text, lyrics.source) + HUD_CHARS);
    // 本番の Renderer は書体の準備が終わってから作る (内部のキャッシュに仮の書体の文字を残さない)
    const renderer = withSeededRandom(deriveSeed(seed, 'renderer'), () => {
      const r = new J.Renderer();
      r.paper(plan.W, plan.H); // 紙の質感はここで作ってキャッシュさせる (描画中に Math.random を呼ばせない)
      return r;
    });
    return new LyricMotion(plan, renderer);
  }

  /** 時刻 t のコマを ctx の canvas いっぱいに透過で描く。fast = プレビュー向けの軽い描画 (ぼかし等を省く) */
  render(ctx: CanvasRenderingContext2D, t: number, opts: { fast?: boolean } = {}): void {
    const scale = ctx.canvas.width / this.plan.W;
    this.renderer.frame(ctx, this.plan, Math.max(0, t), { scale, transparent: true, fast: !!opts.fast });
  }
}
