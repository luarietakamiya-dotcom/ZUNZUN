import type { AudioAnalysis } from '../audio/analyze';
import type { LyricsSettings, RhythmSettings } from '../types';
import { buildJizuraAudio, LyricMotion, motionRhythmGrid, nearestAspect } from './jizura-adapter';
import { motionUsesPalette } from './packs';
import type { PackPalette } from './packs/types';

/**
 * プレビュー用に、今の設定に合う LyricMotion を用意しておく係 (タブをまたいで 1 つだけ持つ)。
 *
 * LyricMotion は作るのに時間がかかる (JIZURA の読み込み、書体の準備で全カットの下描き) ので、
 * - 設定 (歌詞・時刻・モーションの設定・seed・比率・fps・音源) が同じ間は作り直さない
 * - 変わったら、DEBOUNCE_MS のあいだ変わらなくなってから作り直す (タイムラインのドラッグ中に何度も作らない)。
 *   作り直しの間は画面が少し止まるので、**時刻だけの変更 (タイムラインで合わせているとき) は自動では作り直さず、
 *   apply() (画面の「反映」ボタン) を待つ** (2026-10-01 「少し動かしただけで反映されて固まる」「反映ボタンを押したら反映がいい」)。
 *   待っている間に文字やスタイルを変えたら、そのときに時刻もまとめて反映する
 * - 作っている間は、ひとつ前の LyricMotion を返し続ける (歌詞が一瞬消えないように)
 * 書き出しはこれを使わず、書き出し開始時の設定で LyricMotion.create を直接呼ぶ。
 */

export interface MotionRequest {
  lyrics: LyricsSettings | null;
  analysis: AudioAnalysis | null;
  projectSeed: number;
  /** 書き出しサイズ (JIZURA の画面比率を決める) */
  width: number;
  height: number;
  fps: number;
  /** 小節と拍子 (store.rhythm)。変拍子モードがオンのときだけ歌詞モーションに使う */
  rhythm?: RhythmSettings | null;
  /** 背景から読み取った色 (背景の色を使うスタイル「余白」のときだけ使う) */
  palette?: PackPalette | null;
}

const DEBOUNCE_MS = 350;

const analysisIds = new WeakMap<AudioAnalysis, number>();
let nextAnalysisId = 1;
function analysisId(a: AudioAnalysis | null): number {
  if (!a) return 0;
  let id = analysisIds.get(a);
  if (!id) {
    id = nextAnalysisId++;
    analysisIds.set(a, id);
  }
  return id;
}

/** 歌詞モーションを出すかどうか (出さないときは null を返す) */
export function wantsMotion(req: MotionRequest): req is MotionRequest & { lyrics: LyricsSettings } {
  return !!req.lyrics && req.lyrics.motion.enabled && req.lyrics.text.trim().length > 0;
}

/** 作り直しが要るかを判定するためのキー */
export function motionKey(req: MotionRequest & { lyrics: LyricsSettings }, base = motionKeyWithoutTiming(req)): string {
  return JSON.stringify([req.lyrics.timing.lineTimes, req.lyrics.timing.lineEnds, base]);
}

/** キーのうち、行の時刻を除いた所 (時刻だけが変わったかを見分ける) */
function motionKeyWithoutTiming(req: MotionRequest & { lyrics: LyricsSettings }): string {
  const { lyrics } = req;
  return JSON.stringify([
    lyrics.source,
    lyrics.text,
    lyrics.motion,
    req.projectSeed >>> 0,
    nearestAspect(req.width, req.height),
    req.fps,
    analysisId(req.analysis),
    // 変拍子モードがオフの間は、小節を叩き直しても作り直さない
    req.rhythm?.enabled ? [req.rhythm.bars, req.rhythm.meters] : null,
    // 背景の色を使うスタイルのときだけ、背景の色が変わったら作り直す
    motionUsesPalette(lyrics.motion) ? (req.palette ?? null) : null,
  ]);
}

export class LyricMotionProvider {
  private currentKey = '';
  private current: LyricMotion | null = null;
  private requestedKey = '';
  private requestedAt = 0;
  /** 今の LyricMotion の、時刻を除いたキー */
  private currentBase = '';
  /** 今待っている変更が時刻だけか (時刻だけなら apply() まで作り直さない) */
  private timingOnly = false;
  /** apply() が呼ばれた (次の get() ですぐ作る) */
  private applyRequested = false;
  private building = false;
  /** 直近の作成の失敗 (UI に出す用)。成功したら null に戻す */
  lastError: string | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** 今の設定に合う (または作り直している間はひとつ前の) LyricMotion。出さない設定なら null */
  get(req: MotionRequest): LyricMotion | null {
    if (!wantsMotion(req)) {
      this.requestedKey = '';
      return null;
    }
    const base = motionKeyWithoutTiming(req);
    const key = motionKey(req, base);
    // 毎回確かめる (作っている途中に時刻を変えたときも、できあがったあとは「時刻だけの変更」として待つ)
    this.timingOnly = this.current != null && base === this.currentBase;
    if (key === this.currentKey) {
      this.requestedKey = key;
      this.applyRequested = false;
      return this.current;
    }
    if (key !== this.requestedKey) {
      this.requestedKey = key;
      this.requestedAt = this.now();
    }
    if (this.building) return this.current;
    if (this.applyRequested || (!this.timingOnly && this.now() - this.requestedAt >= DEBOUNCE_MS)) {
      this.applyRequested = false;
      this.build(key, req);
    }
    return this.current;
  }

  /** 時刻の変更を、次の get() ですぐ反映する (画面の「反映」ボタン) */
  apply(): void {
    if (this.hasPendingTiming) this.applyRequested = true;
  }

  /** 時刻だけを変えて、まだ反映していないか (「反映」ボタンを出す用) */
  get hasPendingTiming(): boolean {
    return !this.building && this.timingOnly && this.requestedKey !== '' && this.requestedKey !== this.currentKey;
  }

  /** 準備中か (UI に「準備中…」を出す用。反映を待っている間は準備中ではない) */
  get isBuilding(): boolean {
    return this.building || (this.requestedKey !== '' && this.requestedKey !== this.currentKey && (!this.timingOnly || this.applyRequested));
  }

  private build(key: string, req: MotionRequest & { lyrics: LyricsSettings }): void {
    this.building = true;
    const base = motionKeyWithoutTiming(req);
    const rhythm = motionRhythmGrid(req.rhythm);
    const audio = req.analysis ? buildJizuraAudio(req.analysis, rhythm) : null;
    LyricMotion.create(req.lyrics, audio, { projectSeed: req.projectSeed, width: req.width, height: req.height, fps: req.fps, rhythm, palette: req.palette ?? null })
      .then((motion) => {
        this.current = motion;
        this.currentKey = key;
        this.currentBase = base;
        this.lastError = null;
      })
      .catch((err: unknown) => {
        // 失敗した設定では作り直さない (同じキーのまま次の変更を待つ)
        this.currentKey = key;
        this.currentBase = base;
        this.current = null;
        this.lastError = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        this.building = false;
      });
  }
}

/** プレビュー (Visualizer タブと Lyrics タブ) で共有する */
export const previewMotionProvider = new LyricMotionProvider();
