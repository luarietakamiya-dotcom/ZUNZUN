import { defaultSubtitle, type LyricsSettings, type SubtitleSettings } from '../types';
import { wrapLyric } from './split-lines';
import { ensureSubtitleFont, subtitleFontFamily, subtitleWeight } from './subtitle-fonts';
import { lineAt } from './timing';
import { buildLyricsView } from './view';

/**
 * シンプル字幕: JIZURA を使わず、今の行をそのまま描く (2026-11-25 姫「JIZURA 不使用の字幕もできるようにする」)。
 * - 動きは無い。位置・大きさ・色は固定で、出入りだけフェード (設定で 0 秒にもできる)
 * - 行の時刻は歌詞タブの時刻 (buildLyricsView) をそのまま使う。間奏の行・空の行は何も出さない
 * - 乱数を使わないので、同じ設定・同じ時刻なら同じ絵 (プレビューと書き出しで同じ)
 * - LyricLayer と書き出しからは LyricMotion (JIZURA) と同じ形で使う: plan.W / plan.H (描く板の大きさ) と render(ctx, t)
 */
export class SimpleSubtitle {
  readonly kind = 'subtitle' as const;
  readonly plan: { W: number; H: number };
  private readonly s: SubtitleSettings;
  private readonly texts: string[];
  private readonly times: { starts: number[]; ends: number[] };
  /** 行ごとの、折り返した行と文字の大きさ (書体を読み込んだあとに測るので、最初に描くときに決めて覚える) */
  private readonly layouts = new Map<number, { rows: string[]; size: number }>();

  private constructor(lyrics: LyricsSettings, width: number, height: number, audioDuration?: number) {
    this.plan = { W: Math.max(2, Math.round(width)), H: Math.max(2, Math.round(height)) };
    this.s = { ...defaultSubtitle(), ...(lyrics.subtitle ?? {}) };
    const view = buildLyricsView(lyrics, audioDuration);
    this.texts = view.parsed.lines.map((l) => (l.interlude ? '' : l.text));
    this.times = view.times;
  }

  /** 書体を読み込んでから作る (最初のコマから正しい書体で描くため) */
  static async create(lyrics: LyricsSettings, opts: { width: number; height: number; audioDuration?: number }): Promise<SimpleSubtitle> {
    const sub = new SimpleSubtitle(lyrics, opts.width, opts.height, opts.audioDuration);
    await ensureSubtitleFont(sub.s.font, sub.s.bold, sub.texts.join(''));
    return sub;
  }

  /** 時刻 t の行と濃さ (0..1)。何も出さないときは null */
  frameAt(t: number): { line: number; alpha: number } | null {
    const i = lineAt(this.times, t);
    if (i < 0 || !this.texts[i]) return null;
    const s = this.times.starts[i]!, e = this.times.ends[i]!, f = this.s.fade;
    const p = f > 0 ? Math.min(1, (t - s) / f, (e - t) / f) : 1;
    if (p <= 0) return null;
    return { line: i, alpha: p >= 1 ? 1 : p * p * (3 - 2 * p) };
  }

  /** 時刻 t のコマを描く (canvas は毎回透明にしてから描く。canvas の大きさが plan と違えば合わせて縮める) */
  render(ctx: CanvasRenderingContext2D, t: number): void {
    const { W, H } = this.plan;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const fr = Number.isFinite(t) ? this.frameAt(t) : null;
    if (fr) {
      const k = ctx.canvas.width / W;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      this.drawLine(ctx, fr.line, fr.alpha, W, H);
    }
    ctx.restore();
  }

  private fontSpec(size: number): string {
    return `${subtitleWeight(this.s.font, this.s.bold)} ${size}px ${subtitleFontFamily(this.s.font)}`;
  }

  /** 行を折り返して、画面の幅の 9 割に収まる大きさを決める */
  private layoutOf(ctx: CanvasRenderingContext2D, i: number, W: number, H: number): { rows: string[]; size: number } {
    const hit = this.layouts.get(i);
    if (hit) return hit;
    const portrait = W < H, text = this.texts[i]!;
    const base = Math.min(W, H) * (portrait ? 0.07 : 0.058) * this.s.size;
    const maxW = W * 0.9;
    ctx.font = this.fontSpec(base);
    const full = ctx.measureText(text).width;
    // 1 行に収まらなければ、必要な行数ぶんに分ける (縦長は最大 3 行、横長は 2 行。それ以上は文字を小さくする)
    const rowsWanted = Math.min(portrait ? 3 : 2, Math.max(1, Math.ceil(full / maxW)));
    const rows = rowsWanted > 1 ? wrapLyric(text, Math.ceil([...text].length / rowsWanted)) : [text];
    const widest = Math.max(1, ...rows.map((r) => ctx.measureText(r).width));
    const size = base * Math.min(1, maxW / widest);
    const out = { rows: rows.length ? rows : [text], size };
    this.layouts.set(i, out);
    return out;
  }

  private drawLine(ctx: CanvasRenderingContext2D, i: number, alpha: number, W: number, H: number): void {
    const { rows, size } = this.layoutOf(ctx, i, W, H);
    const lh = size * 1.3, n = rows.length;
    const firstY = this.s.position === 'top' ? H * 0.12 : this.s.position === 'middle' ? H / 2 - ((n - 1) * lh) / 2 : H * 0.88 - (n - 1) * lh;
    ctx.font = this.fontSpec(size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = alpha;
    const sh = this.s.shadow, ow = this.s.outline * size * 0.16;
    rows.forEach((row, r) => {
      const y = firstY + r * lh;
      ctx.shadowColor = sh > 0 ? `rgba(0,0,0,${(0.85 * sh).toFixed(3)})` : 'transparent';
      ctx.shadowBlur = size * 0.22 * sh;
      ctx.shadowOffsetY = size * 0.05 * sh;
      // ふちどりは文字の下に描く (上に描くと文字がやせる)。影はふちどり (無ければ文字) にだけ付ける
      if (ow > 0) {
        ctx.lineWidth = ow * 2;
        ctx.strokeStyle = this.s.outlineColor;
        ctx.strokeText(row, W / 2, y);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = this.s.color;
      ctx.fillText(row, W / 2, y);
    });
  }
}
