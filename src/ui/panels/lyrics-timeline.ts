import { peakBetween, type Peaks } from '../../core/audio/peaks';
import { Viewport, type LineTimeSource, type OnsetCandidate } from '../../core/lyrics';
import type { RhythmGrid } from '../../core/rhythm';
import { tr } from '../../core/i18n';

/**
 * Lyrics タブのタイムライン (L4)。canvas 1 枚に、時刻の目盛り・波形・歌声らしさと歌い出し候補・ビート線・
 * 行のブロック・再生位置を描く。docs/ARCHITECTURE.md「タイムラインで後調整」に対応する。
 * 小節の頭を決めてあれば (R2)、小節線 (太線・小節の番号) と拍のまとまりの頭 (細線) も描く。
 * 小節線は、波形の段でつかんで左右にドラッグすると動かせる (離した位置は音の立ち上がり → ビートへ吸着、Shift で吸着なし)。
 *
 * 操作:
 * - 行のブロック: 左端をドラッグで開始、右端で終了、真ん中で行ごと動かす。吸着するかは Lyrics パネルのチェックで決め
 *   (最初は切ってある。2026-10-01)、Shift を押している間は逆にする (cb.snap の 2 つ目の引数 = Shift。
 *   設計では Alt/Option だったが、Windows では Alt+Space でウィンドウのメニューが開く件があったので、タップと同じ Shift にそろえた)
 * - ブロックをクリック = その行を選ぶ。何も無いところをクリック = その位置へ移動。何も無いところをドラッグ = 左右に移動
 * - ホイール = 左右に移動、Ctrl+ホイール = 拡大・縮小 (ポインタの位置が中心)
 *
 * 時刻の書き換えそのものはしない: ドラッグ中は見た目だけ動かし、離したときに onDragCommit で Lyrics パネルへ渡す
 * (パネルが core/lyrics/edit.ts の規則で書き換え、取り消しの履歴に積む)。
 */

export interface TimelineData {
  duration: number;
  lines: { text: string; interlude: boolean }[];
  starts: readonly number[];
  ends: readonly number[];
  source: readonly LineTimeSource[];
  peaks: Peaks | null;
  vocal: Float32Array | null;
  vocalRate: number;
  onsets: readonly OnsetCandidate[];
  beats: readonly number[];
  selected: number;
  /** ループ試聴の区間 (無ければ null) */
  loop: { start: number; end: number } | null;
  /** 小節と拍のまとまり (小節の頭が無ければ null) */
  rhythm: RhythmGrid | null;
  /** 小節の頭 (昇順、normalizeBars 済み)。小節線のドラッグの番号はこの並びの番号 */
  barHeads: readonly number[];
}

export type DragKind = 'start' | 'end' | 'move';

export interface TimelineCallbacks {
  onSelect(line: number): void;
  onSeek(t: number): void;
  /** kind が 'move' のとき value は動かした量 (秒)、それ以外は時刻 (秒)。どちらも吸着済み */
  onDragCommit(kind: DragKind, line: number, value: number): void;
  /** 吸着。shift = Shift を押しているか (吸着のオン・オフを一時的に逆にする。決めるのは呼び出し側) */
  snap(t: number, shift: boolean): number;
  /** 小節線をドラッグして離したとき (index = barHeads の番号、t = 吸着済みの時刻)。無ければ小節線は動かせない */
  onBarDragCommit?(index: number, t: number): void;
  /** 小節の頭の吸着 (noSnap のときはそのまま返す) */
  snapBar?(t: number, noSnap: boolean): number;
  /** 今、小節線を動かしてよいか (小節のタップ中などは false) */
  canDragBars?(): boolean;
}

const HEIGHT = 196;
const RULER_H = 18;
const WAVE_TOP = RULER_H + 4;
const WAVE_H = 84;
const BLOCK_TOP = WAVE_TOP + WAVE_H + 8;
const BLOCK_H = 62;
const EDGE_PX = 6;
const DRAG_THRESHOLD = 3;

const COLORS = {
  bg: '#0b0c0f',
  grid: 'rgba(255,255,255,0.06)',
  rulerText: '#9aa1ad',
  wave: '#394152',
  vocal: 'rgba(124,155,255,0.75)',
  onset: 'rgba(127,224,160,0.85)',
  playhead: '#ff5a6e',
  loop: 'rgba(124,155,255,0.10)',
  text: '#e7e9ee',
  textDim: '#9aa1ad',
  bar: 'rgba(240,179,90,0.9)',
  group: 'rgba(240,179,90,0.35)',
  barText: 'rgba(240,179,90,0.95)',
};

const BLOCK_STYLE: Record<LineTimeSource, { fill: string; stroke: string; dash: number[] }> = {
  manual: { fill: 'rgba(124,155,255,0.30)', stroke: 'rgba(124,155,255,0.9)', dash: [] },
  lrc: { fill: 'rgba(90,200,200,0.25)', stroke: 'rgba(90,200,200,0.85)', dash: [] },
  estimate: { fill: 'rgba(154,161,173,0.08)', stroke: 'rgba(154,161,173,0.45)', dash: [4, 3] },
};

type Hit = { kind: DragKind; line: number } | { kind: 'bar'; bar: number };

interface DragState {
  pointerId: number;
  downX: number;
  downStart: number; // ドラッグ開始時の viewport.start (空の場所をドラッグして左右に動かすとき)
  hit: Hit | null;
  dragging: boolean;
  /** プレビュー中の値 (kind が 'move' のときは動かした量、'bar' のときは小節の頭の時刻) */
  value: number;
}

/** 目盛りの間隔 (秒): 70px 以上あく最小のもの */
function rulerStep(pxPerSec: number): number {
  for (const s of [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120]) if (s * pxPerSec >= 70) return s;
  return 300;
}

function rulerLabel(t: number, step: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return step < 1 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.round(s)).padStart(2, '0')}`;
}

export class LyricsTimeline {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly vp = new Viewport();
  private data: TimelineData | null = null;
  private drag: DragState | null = null;
  private lastUserScroll = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly cb: TimelineCallbacks) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'lyrics-timeline-canvas';
    this.canvas.style.height = `${HEIGHT}px`;
    this.ctx = this.canvas.getContext('2d');
    const zoomOut = this.toolButton('−', tr('縮小 (Ctrl + ホイールでも)', 'Zoom out (or Ctrl + wheel)'), () => this.zoomCenter(1 / 1.5));
    const zoomIn = this.toolButton('+', tr('拡大 (Ctrl + ホイールでも)', 'Zoom in (or Ctrl + wheel)'), () => this.zoomCenter(1.5));
    const fit = this.toolButton(tr('全体', 'All'), tr('曲全体を表示', 'Show the whole song'), () => {
      this.vp.pxPerSec = 0;
      this.vp.clamp();
      this.lastUserScroll = performance.now();
    });
    const legend = document.createElement('span');
    legend.className = 'param-label';
    legend.textContent =
      tr('青い線 = 歌声らしさ / 緑の目盛り = 歌い出しの候補 / 縦の薄い線 = 拍 / 橙の線 = 小節 (波形の段でつかんで動かせます)。ブロックの端をドラッグで始まり・終わり、真ん中で行ごと移動', 'Blue line = voice likelihood / green ticks = possible vocal entries / thin vertical lines = beats / orange lines = bars (drag them in the waveform row). Drag a block edge to set start/end, its middle to move the line');
    const toolbar = document.createElement('div');
    toolbar.className = 'row-gap lyrics-row-wrap';
    toolbar.append(zoomOut, zoomIn, fit, legend);
    const wrap = document.createElement('div');
    wrap.className = 'lyrics-timeline';
    wrap.append(this.canvas);
    this.element = document.createElement('div');
    this.element.className = 'lyrics-timeline-box';
    this.element.append(toolbar, wrap);

    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', () => (this.drag = null));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(wrap);
    this.vp.pxPerSec = 80;
  }

  setData(data: TimelineData): void {
    const first = this.data == null || this.data.duration !== data.duration;
    this.data = data;
    this.vp.duration = data.duration;
    if (first) this.vp.start = 0;
    this.vp.clamp();
  }

  /** 選んだ行とループ区間だけを更新する (毎フレーム呼ばれる) */
  setSelection(selected: number, loop: TimelineData['loop']): void {
    if (this.data) {
      this.data.selected = selected;
      this.data.loop = loop;
    }
  }

  /** 選んだ行が画面に入るようにする */
  reveal(t: number): void {
    this.vp.reveal(t, 0.2);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
  }

  /** 毎フレーム呼ぶ。t = 聞こえている再生位置 */
  draw(t: number, playing: boolean): void {
    const g = this.ctx;
    const d = this.data;
    if (!g) return;
    const w = this.vp.width;
    // 再生中は再生位置を追いかける (手でスクロールした直後の 1.5 秒は追いかけない)
    if (playing && !this.drag?.dragging && performance.now() - this.lastUserScroll > 1500) this.vp.reveal(t, 0.1);

    g.fillStyle = COLORS.bg;
    g.fillRect(0, 0, w, HEIGHT);
    if (!d || d.duration <= 0) {
      g.fillStyle = COLORS.textDim;
      g.font = '12px system-ui, sans-serif';
      g.fillText(tr('曲を読み込むと、波形とタイムラインが表示されます', 'Load a song to see the waveform and timeline'), 12, HEIGHT / 2);
      return;
    }
    const t0 = this.vp.start;
    const t1 = this.vp.end;
    const X = (tt: number): number => this.vp.timeToX(tt);

    // ループ区間
    if (d.loop) {
      g.fillStyle = COLORS.loop;
      g.fillRect(X(d.loop.start), 0, X(d.loop.end) - X(d.loop.start), HEIGHT);
    }

    // ビート線 (詰まりすぎるときは描かない)
    const beatGap = d.beats.length > 1 ? (d.beats[d.beats.length - 1]! - d.beats[0]!) / (d.beats.length - 1) : 0;
    if (beatGap * this.vp.pxPerSec >= 5) {
      g.fillStyle = COLORS.grid;
      for (const b of d.beats) if (b >= t0 && b <= t1) g.fillRect(Math.round(X(b)), RULER_H, 1, HEIGHT - RULER_H);
    }

    // 小節線 (太線) と拍のまとまりの頭 (細線)。まとまりの線は詰まりすぎるときは描かない
    if (d.rhythm) {
      const pps = this.vp.pxPerSec;
      g.font = '10px system-ui, sans-serif';
      const pulses = d.rhythm.pulses;
      for (let k = 0; k < pulses.length; k++) {
        const p = pulses[k]!;
        if (p.t < t0 - 1 || p.t > t1) continue;
        const x = Math.round(X(p.t));
        if (p.barHead) {
          g.fillStyle = COLORS.bar;
          g.fillRect(x - 1, RULER_H, 2, HEIGHT - RULER_H);
          const bar = d.rhythm.bars[p.bar]!;
          if ((bar.end - bar.start) * pps >= 28) {
            g.fillStyle = COLORS.barText;
            g.fillText(String(p.bar + 1), x + 3, WAVE_TOP + 10);
          }
        } else if (p.length * pps >= 4 && k > 0 && (p.t - pulses[k - 1]!.t) * pps >= 4) {
          g.fillStyle = COLORS.group;
          g.fillRect(x, RULER_H, 1, HEIGHT - RULER_H);
        }
      }
    }

    // ドラッグ中の小節線 (離すとこの位置になる)
    if (this.drag?.dragging && this.drag.hit?.kind === 'bar') {
      const x = Math.round(X(this.drag.value));
      g.fillStyle = '#ffffff';
      g.fillRect(x - 1, RULER_H, 3, HEIGHT - RULER_H);
      g.font = '10px system-ui, sans-serif';
      g.fillText(`${this.drag.hit.bar + 1}`, x + 4, WAVE_TOP + 22);
    }

    // 目盛り
    const step = rulerStep(this.vp.pxPerSec);
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = COLORS.rulerText;
    for (let tt = Math.ceil(t0 / step) * step; tt <= t1; tt += step) {
      const x = Math.round(X(tt));
      g.fillRect(x, RULER_H - 5, 1, 5);
      g.fillText(rulerLabel(tt, step), x + 3, 11);
    }

    // 波形
    if (d.peaks) {
      g.fillStyle = COLORS.wave;
      const mid = WAVE_TOP + WAVE_H / 2;
      for (let x = 0; x < w; x++) {
        const m = peakBetween(d.peaks, this.vp.xToTime(x), this.vp.xToTime(x + 1));
        const h = Math.max(1, m * WAVE_H * 0.95);
        g.fillRect(x, mid - h / 2, 1, h);
      }
    }
    // 歌声らしさ
    if (d.vocal && d.vocalRate > 0) {
      g.strokeStyle = COLORS.vocal;
      g.lineWidth = 1.2;
      g.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const i = Math.round(this.vp.xToTime(x) * d.vocalRate);
        const v = i >= 0 && i < d.vocal.length ? d.vocal[i]! : 0;
        const y = WAVE_TOP + WAVE_H - v * WAVE_H;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // 歌い出し候補
    g.fillStyle = COLORS.onset;
    for (const o of d.onsets) {
      if (o.t < t0 || o.t > t1) continue;
      const h = 4 + Math.min(1, o.strength) * 14;
      g.fillRect(Math.round(X(o.t)) - 1, WAVE_TOP + WAVE_H - h, 2, h);
    }

    // 行のブロック
    const { starts, ends } = this.previewTimes(d);
    g.font = '12px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif';
    g.textBaseline = 'middle';
    for (let i = 0; i < d.lines.length; i++) {
      const s = starts[i]!;
      const e = ends[i]!;
      if (e < t0 || s > t1) continue;
      const x0 = X(s);
      const x1 = X(e);
      const style = BLOCK_STYLE[d.source[i]!];
      const selected = i === d.selected;
      const active = t >= s && t < e && d.source[i] !== 'estimate';
      g.fillStyle = style.fill;
      g.fillRect(x0, BLOCK_TOP, Math.max(1, x1 - x0), BLOCK_H);
      if (active) {
        g.fillStyle = 'rgba(255,255,255,0.10)';
        g.fillRect(x0, BLOCK_TOP, Math.max(1, x1 - x0), BLOCK_H);
      }
      g.setLineDash(style.dash);
      g.strokeStyle = selected ? '#ffffff' : style.stroke;
      g.lineWidth = selected ? 2 : 1;
      g.strokeRect(x0 + 0.5, BLOCK_TOP + 0.5, Math.max(1, x1 - x0) - 1, BLOCK_H - 1);
      g.setLineDash([]);
      // 開始の縦線 (つかむ場所)
      g.fillStyle = selected ? '#ffffff' : style.stroke;
      g.fillRect(x0, BLOCK_TOP, 2, BLOCK_H);
      // 文字
      g.save();
      g.beginPath();
      g.rect(x0 + 4, BLOCK_TOP, Math.max(0, x1 - x0 - 8), BLOCK_H);
      g.clip();
      g.fillStyle = d.source[i] === 'estimate' ? COLORS.textDim : COLORS.text;
      const label = `${i + 1}. ${d.lines[i]!.interlude ? tr('〔間奏〕', '[interlude]') : d.lines[i]!.text}`;
      g.fillText(label, x0 + 6, BLOCK_TOP + BLOCK_H / 2);
      g.restore();
    }

    // 再生位置
    const px = X(t);
    if (px >= 0 && px <= w) {
      g.fillStyle = COLORS.playhead;
      g.fillRect(Math.round(px) - 1, 0, 2, HEIGHT);
    }
  }

  // ---------------------------------------------------------------- 内部

  private toolButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab-button lyrics-tool-button';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  private zoomCenter(factor: number): void {
    this.vp.zoomAt(this.vp.width / 2, factor);
    this.lastUserScroll = performance.now();
  }

  private resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    const w = Math.max(100, Math.floor(rect?.width ?? 800));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(HEIGHT * dpr);
    this.canvas.style.width = `${w}px`;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.vp.width = w;
    this.vp.clamp();
  }

  /** ドラッグ中の行の見た目の時刻 */
  private previewTimes(d: TimelineData): { starts: readonly number[]; ends: readonly number[] } {
    const dr = this.drag;
    if (!dr?.dragging || !dr.hit || dr.hit.kind === 'bar') return { starts: d.starts, ends: d.ends };
    const i = dr.hit.line;
    const starts = d.starts.slice();
    const ends = d.ends.slice();
    if (dr.hit.kind === 'start') starts[i] = Math.min(dr.value, ends[i]! - 0.05);
    else if (dr.hit.kind === 'end') ends[i] = Math.max(dr.value, starts[i]! + 0.05);
    else {
      starts[i] = starts[i]! + dr.value;
      ends[i] = ends[i]! + dr.value;
    }
    return { starts, ends };
  }

  private localX(e: PointerEvent | WheelEvent): number {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  }

  private hitTest(x: number, y: number): Hit | null {
    const d = this.data;
    if (!d) return null;
    // 波形の段では小節線をつかむ (いちばん近いもの)
    if (y >= RULER_H && y < BLOCK_TOP) {
      if (!this.cb.onBarDragCommit || (this.cb.canDragBars && !this.cb.canDragBars())) return null;
      let best = -1;
      let bestDx = EDGE_PX + 1;
      d.barHeads.forEach((t, k) => {
        const dx = Math.abs(this.vp.timeToX(t) - x);
        if (dx < bestDx) {
          bestDx = dx;
          best = k;
        }
      });
      return best >= 0 && bestDx <= EDGE_PX ? { kind: 'bar', bar: best } : null;
    }
    if (y < BLOCK_TOP || y > BLOCK_TOP + BLOCK_H) return null;
    // 後ろの行ほど上に描かれているので、後ろから調べる
    for (let i = d.lines.length - 1; i >= 0; i--) {
      const x0 = this.vp.timeToX(d.starts[i]!);
      const x1 = this.vp.timeToX(d.ends[i]!);
      if (x < x0 - EDGE_PX / 2 || x > x1 + EDGE_PX / 2) continue;
      const edge = Math.min(EDGE_PX, (x1 - x0) / 3);
      if (Math.abs(x - x0) <= edge) return { line: i, kind: 'start' };
      if (Math.abs(x - x1) <= edge) return { line: i, kind: 'end' };
      if (x > x0 && x < x1) return { line: i, kind: 'move' };
    }
    return null;
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const x = this.localX(e);
    const y = e.clientY - this.canvas.getBoundingClientRect().top;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // キャプチャできない (合成イベントなど) ときも、ドラッグ自体は続けられるようにする
    }
    this.drag = { pointerId: e.pointerId, downX: x, downStart: this.vp.start, hit: this.hitTest(x, y), dragging: false, value: 0 };
  }

  private onPointerMove(e: PointerEvent): void {
    const x = this.localX(e);
    const dr = this.drag;
    if (!dr || dr.pointerId !== e.pointerId) {
      const y = e.clientY - this.canvas.getBoundingClientRect().top;
      const hit = this.hitTest(x, y);
      this.canvas.style.cursor = !hit ? 'default' : hit.kind === 'move' ? 'grab' : 'ew-resize';
      return;
    }
    if (!dr.dragging && Math.abs(x - dr.downX) < DRAG_THRESHOLD) return;
    dr.dragging = true;
    const d = this.data;
    if (!dr.hit || !d) {
      // 何も無いところのドラッグ = 左右に移動
      this.vp.start = dr.downStart - (x - dr.downX) / this.vp.pxPerSec;
      this.vp.clamp();
      this.lastUserScroll = performance.now();
      return;
    }
    const noSnap = e.shiftKey;
    if (dr.hit.kind === 'bar') {
      const raw = this.vp.xToTime(x);
      dr.value = this.cb.snapBar ? this.cb.snapBar(raw, noSnap) : raw;
      return;
    }
    const i = dr.hit.line;
    if (dr.hit.kind === 'move') {
      const raw = d.starts[i]! + (x - dr.downX) / this.vp.pxPerSec;
      dr.value = this.cb.snap(raw, noSnap) - d.starts[i]!;
      this.canvas.style.cursor = 'grabbing';
    } else {
      dr.value = this.cb.snap(this.vp.xToTime(x), noSnap);
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const dr = this.drag;
    this.drag = null;
    if (!dr || dr.pointerId !== e.pointerId) return;
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // 上と同じ
    }
    if (!dr.dragging) {
      if (dr.hit && dr.hit.kind !== 'bar') this.cb.onSelect(dr.hit.line);
      else this.cb.onSeek(Math.max(0, this.vp.xToTime(dr.downX)));
      return;
    }
    if (dr.hit?.kind === 'bar') {
      this.cb.onBarDragCommit?.(dr.hit.bar, dr.value);
      return;
    }
    if (dr.hit) {
      this.cb.onSelect(dr.hit.line);
      this.cb.onDragCommit(dr.hit.kind, dr.hit.line, dr.value);
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.lastUserScroll = performance.now();
    if (e.ctrlKey || e.metaKey) this.vp.zoomAt(this.localX(e), Math.exp(-e.deltaY * 0.0015));
    else this.vp.scrollBy(Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY);
  }
}
