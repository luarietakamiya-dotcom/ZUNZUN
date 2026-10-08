import type { PackJ } from '../../types';
import { grain, rng, type G } from '../rich/kit';
import { layerOf } from '../rich/layer';

/**
 * MV 用の共通の部品（docs/REFERENCE_MV_ANALYSIS.md「作り直しの方針」）。
 *  - 入りは速く（0.1〜0.2 秒）、少し行き過ぎて止まる。動いている間は「ぶれの残像」で速さを見せる。
 *  - 質感は紙（粒・染み・折り目）。つるつるのグラデーション・ぼかした影・光る文字は使わない。
 *  - 切り替えは帯のワイプ（ブラインド）。
 * 決定論: 乱数は seed から（rng）。描画面が無い環境（ユニットテスト）でも落ちない。
 */
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 速い入り: 0..1 → 0..1。終わり際に小さく行き過ぎて戻る（行き過ぎは最大 4 %） */
export function snapIn(q: number): number {
  if (q <= 0) return 0;
  if (q >= 1) return 1;
  const e = 1 - Math.pow(1 - q, 4);
  return e + Math.sin(q * Math.PI) * 0.04 * q;
}

/** 書体の CSS（エンジンの書体表から） */
export const fontOf = (J: PackJ, key: string, px: number): string => (J as unknown as { fontCSS(k: string, s: number): string }).fontCSS(key, Math.max(1, px));

/**
 * 動いている物を、ぶれの残像つきで描く。at(p) は進み具合 p（0..1）での位置、draw は 1 回描く関数。
 * 残像は p から少し前（lag）までの位置に、薄く重ねる。止まったら（p >= 1）1 回だけ描く。
 */
export function withTrail(g: G, p: number, at: (p: number) => [number, number], draw: (x: number, y: number) => void, lag = 0.22, n = 5): void {
  if (p < 1 && p > 0) {
    const a0 = g.globalAlpha;
    for (let k = n; k >= 1; k--) {
      const [x, y] = at(Math.max(0, p - (lag * k) / n));
      g.globalAlpha = a0 * 0.28 * (1 - k / (n + 1));
      draw(x, y);
    }
    g.globalAlpha = a0;
  }
  const [x, y] = at(clamp01(p));
  draw(x, y);
}

export type Tone = 'paper' | 'ink' | 'shu';
export const TONES: Record<Tone, { bg: string; fg: string; accent: string; speck: string }> = {
  paper: { bg: '#EEE8DC', fg: '#161412', accent: '#B0221B', speck: '#2a2420' },
  ink: { bg: '#141210', fg: '#EEE8DC', accent: '#C2281F', speck: '#d8cfc0' },
  shu: { bg: '#A81F19', fg: '#F3ECE0', accent: '#141210', speck: '#3a0c09' },
};

/** 紙の地（粒・小さな染み・薄い縦の折り目）。カットごとに 1 枚描いて使い回す */
export function paperLayer(W: number, H: number, tone: Tone, seed: number): HTMLCanvasElement | null {
  return layerOf(`mv:paper:${tone}:${W}x${H}:${seed}`, W, H, (g) => {
    const t = TONES[tone], u = Math.min(W, H), R = rng(seed);
    g.fillStyle = t.bg; g.fillRect(0, 0, W, H);
    grain(g, W, H, tone === 'paper' ? 0.22 : 0.16, tone === 'paper' ? 'multiply' : 'overlay');
    // 小さな染み・ほこり（不規則な小さな塊）
    g.save(); g.fillStyle = t.speck;
    for (let i = 0; i < 140; i++) {
      const x = R() * W, y = R() * H, r = u * (0.0008 + Math.pow(R(), 3) * 0.006);
      g.globalAlpha = 0.12 + R() * 0.3;
      g.beginPath();
      for (let k = 0; k <= 7; k++) { const a = (k / 7) * Math.PI * 2, rr = r * (0.6 + R() * 0.8); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.fill();
    }
    g.restore();
    // 薄い縦の折り目（1〜2 本）
    g.save(); g.strokeStyle = t.speck; g.lineWidth = Math.max(1, u * 0.0012);
    for (let i = 0; i < 1 + (seed & 1); i++) { const x = W * (0.12 + R() * 0.76); g.globalAlpha = 0.08; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (R() - 0.5) * W * 0.01, H); g.stroke(); }
    g.restore();
  });
}

/**
 * 帯のワイプ（ブラインド）で隠す: q = 0 で全部見える、q = 1 で全部消える。n 本の横帯がそれぞれの中心へ細る。
 * clip を設定するだけ（呼び出し側で save / restore する）
 */
export function blindsClip(g: G, W: number, H: number, q: number, n = 9): void {
  g.beginPath();
  const bh = H / n, keep = 1 - clamp01(q);
  for (let i = 0; i < n; i++) { const h = bh * keep; g.rect(0, i * bh + (bh - h) / 2, W, h); }
  g.clip();
}

/** 文字ごとの送り幅（描画面で測る。測れない環境では大きさの 1 倍） */
export function advances(g: G, J: PackJ, font: string, size: number, chars: string[], track = 0): number[] {
  g.save();
  g.font = fontOf(J, font, size);
  const out = chars.map((c) => {
    const m = typeof g.measureText === 'function' ? g.measureText(c) : null;
    const w = m && Number.isFinite(m.width) && m.width > 0 ? m.width : size;
    return w + size * track;
  });
  g.restore();
  return out;
}
