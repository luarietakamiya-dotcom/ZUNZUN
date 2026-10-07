/**
 * 質感の道具（飛沫・かすれた筆跡・粒子・ハーフトーン・光線・ボケ・星雲…）。
 * すべて「引数から決まる」描き方（乱数は seed 由来）。docs/art-studies/rich-compositions.html の試作を移植したもの。
 * 描画面 g は設計サイズ（W×H）の座標。重いので、呼び出し側は layer.ts でカットごとに 1 枚へ描いて使い回す。
 */
export type G = CanvasRenderingContext2D;
export type Pt = [number, number];
const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));

/** 決まった乱数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

let noise: HTMLCanvasElement | null = null;
function noiseTile(): HTMLCanvasElement | null {
  if (noise) return noise;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  if (!g || typeof g.createImageData !== 'function') return null;
  const d = g.createImageData(256, 256), r = rng(7);
  for (let i = 0; i < d.data.length; i += 4) { const v = 90 + r() * 165; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0); noise = c; return c;
}

/** 粒子（フィルムの粒・紙の質感）。mode は overlay か multiply */
export function grain(g: G, W: number, H: number, a: number, mode: GlobalCompositeOperation = 'overlay'): void {
  const t = noiseTile(); if (!t) return;
  const pat = g.createPattern(t, 'repeat'); if (!pat) return;
  g.save(); g.globalCompositeOperation = mode; g.globalAlpha = a; g.fillStyle = pat; g.fillRect(0, 0, W, H); g.restore();
}

/** インクの飛沫: 中心の塊 + 向きに沿って飛ぶ粒と細い筋。r は塊の半径（設計サイズ） */
export function splatter(g: G, x: number, y: number, r: number, color: string, seed: number, ang = 0, spread = 0.9, n = 90, a = 1): void {
  const R = rng(seed); g.save(); g.fillStyle = color; g.strokeStyle = color; g.globalAlpha = a;
  g.beginPath(); for (let i = 0; i <= 28; i++) { const t = (i / 28) * Math.PI * 2, rr = r * (0.7 + R() * 0.55); g.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr * 0.7); } g.fill();
  for (let i = 0; i < n; i++) {
    const t = ang + (R() - 0.5) * spread * 2, d = r * (0.8 + Math.pow(R(), 1.6) * 7), s = r * (0.03 + R() * 0.16) * (1 - d / (r * 9));
    const px = x + Math.cos(t) * d, py = y + Math.sin(t) * d * 0.8;
    if (R() < 0.35) { g.lineWidth = Math.max(0.6, s * 0.7); g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(t) * s * 7, py + Math.sin(t) * s * 7 * 0.8); g.stroke(); }
    else { g.beginPath(); g.arc(px, py, Math.max(0.6, s), 0, 7); g.fill(); }
  }
  g.restore();
}

/** かすれた筆跡（太い帯 + 乾いた線の欠け） */
export function brush(g: G, x0: number, y0: number, x1: number, y1: number, w: number, color: string, seed: number, a = 1): void {
  const R = rng(seed), L = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / L, uy = (y1 - y0) / L, nx = -uy, ny = ux;
  g.save(); g.fillStyle = color; g.globalAlpha = a;
  const N = 60; g.beginPath();
  for (let i = 0; i <= N; i++) { const t = i / N, j = (R() - 0.5) * w * 0.14; g.lineTo(x0 + ux * L * t + nx * (w / 2 + j), y0 + uy * L * t + ny * (w / 2 + j)); }
  for (let i = N; i >= 0; i--) { const t = i / N, j = (R() - 0.5) * w * 0.14; g.lineTo(x0 + ux * L * t - nx * (w / 2 + j), y0 + uy * L * t - ny * (w / 2 + j)); }
  g.fill();
  g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.5;
  for (let k = 0; k < 26; k++) { const o = (R() - 0.5) * w, s = R() * 0.6, e = s + R() * 0.4; g.lineWidth = Math.max(0.8, w * 0.03) * (0.5 + R()); g.beginPath(); g.moveTo(x0 + ux * L * s + nx * o, y0 + uy * L * s + ny * o); g.lineTo(x0 + ux * L * e + nx * o, y0 + uy * L * e + ny * o); g.stroke(); }
  g.restore();
}

/** 放射状の速度線（集中線） */
export function focus(g: G, cx: number, cy: number, color: string, n: number, inner: number, outer: number, a: number, seed: number): void {
  const R = rng(seed); g.save(); g.fillStyle = color; g.globalAlpha = a;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.05, w = 0.012 + R() * 0.03, r0 = inner * (0.9 + R() * 0.3), r1 = outer * (0.7 + R() * 0.5);
    g.beginPath(); g.moveTo(cx + Math.cos(t - w) * r1, cy + Math.sin(t - w) * r1); g.lineTo(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0); g.lineTo(cx + Math.cos(t + w) * r1, cy + Math.sin(t + w) * r1); g.fill();
  }
  g.restore();
}

/** ハーフトーンの点。fn(x, y) は 0..1 の大きさ（x, y は領域の中の 0..1） */
export function halftone(g: G, x: number, y: number, w: number, h: number, sp: number, color: string, a: number, fn: (x: number, y: number) => number, ang = 0.5): void {
  g.save(); g.fillStyle = color; g.globalAlpha = a; g.beginPath(); g.rect(x, y, w, h); g.clip();
  const c = Math.cos(ang), s = Math.sin(ang), span = Math.ceil(Math.hypot(w, h) / sp) + 4;
  for (let i = -span; i < span; i++) for (let j = -span; j < span; j++) {
    const px = x + w / 2 + i * sp * c - j * sp * s, py = y + h / 2 + i * sp * s + j * sp * c;
    if (px < x - sp || px > x + w + sp || py < y - sp || py > y + h + sp) continue;
    const k = fn(clamp((px - x) / w), clamp((py - y) / h));
    if (k > 0.05) { g.beginPath(); g.arc(px, py, sp * 0.5 * k, 0, 7); g.fill(); }
  }
  g.restore();
}

/** 縁をがたがたにした多角形（破れ・かすれ） */
export function rough(g: G, pts: Pt[], color: string, amp: number, seed: number, a = 1): void {
  const R = rng(seed); g.save(); g.fillStyle = color; g.globalAlpha = a; g.beginPath();
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]!, n = Math.max(3, Math.floor(Math.hypot(q[0] - p[0], q[1] - p[1]) / 8)); for (let k = 0; k < n; k++) { const t = k / n; g.lineTo(p[0] + (q[0] - p[0]) * t + (R() - 0.5) * amp, p[1] + (q[1] - p[1]) * t + (R() - 0.5) * amp); } });
  g.closePath(); g.fill(); g.restore();
}

/** やわらかい光の玉（ボケ・光の粒）。足し合わせる */
export function bokeh(g: G, n: number, seed: number, colors: string[], rmin: number, rmax: number, a: number, area: [number, number, number, number]): void {
  const R = rng(seed); g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const x = area[0] + R() * area[2], y = area[1] + R() * area[3], r = rmin + R() * (rmax - rmin), c = colors[Math.floor(R() * colors.length)]!, gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = a * (0.3 + R() * 0.7); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.restore();
}

export function glow(g: G, x: number, y: number, r: number, color: string, a: number): void {
  g.save(); g.globalCompositeOperation = 'lighter'; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = a; g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
}

/** 天からの光の筋 */
export function rays(g: G, x: number, y: number, color: string, n: number, len: number, a: number, seed: number, spread = 0.9, base = Math.PI / 2): void {
  const R = rng(seed); g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const t = base + (R() - 0.5) * spread, w = 0.01 + R() * 0.035, gr = g.createLinearGradient(x, y, x + Math.cos(t) * len, y + Math.sin(t) * len);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = a * (0.4 + R() * 0.6); g.fillStyle = gr;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(t - w) * len, y + Math.sin(t - w) * len); g.lineTo(x + Math.cos(t + w) * len, y + Math.sin(t + w) * len); g.fill();
  }
  g.restore();
}

export function line(g: G, x0: number, y0: number, x1: number, y1: number, color: string, w: number, a = 1): void {
  g.save(); g.strokeStyle = color; g.lineWidth = w; g.globalAlpha = a; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.restore();
}

export function vignette(g: G, W: number, H: number, a: number): void {
  const gr = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.65); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
  g.save(); g.globalAlpha = a; g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();
}

export function starburst(g: G, cx: number, cy: number, r1: number, r2: number, n: number, color: string, a = 1, rot = 0): void {
  g.save(); g.fillStyle = color; g.globalAlpha = a; g.beginPath();
  for (let i = 0; i < n * 2; i++) { const t = rot + (i / (n * 2)) * Math.PI * 2, r = i % 2 ? r1 : r2; g.lineTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r); }
  g.closePath(); g.fill(); g.restore();
}

/** 山の稜線（遠近の層に使う） */
export function mountains(g: G, W: number, H: number, baseY: number, amp: number, color: string, seed: number, a = 1, step = 14): void {
  const R = rng(seed); g.save(); g.fillStyle = color; g.globalAlpha = a; g.beginPath(); g.moveTo(0, H); let y = baseY;
  for (let x = 0; x <= W + step; x += step) { y += (R() - 0.5) * amp * 0.9; y = baseY + (y - baseY) * 0.86 + Math.sin(x / (W * 0.12) + seed) * amp * 0.3; g.lineTo(x, y); }
  g.lineTo(W, H); g.fill(); g.restore();
}

/** オーロラ（縦に伸びる光のカーテン） */
export function aurora(g: G, W: number, H: number, seed: number, cols: string[]): void {
  const R = rng(seed); g.save(); g.globalCompositeOperation = 'lighter';
  cols.forEach((c, k) => { for (let i = 0; i < 26; i++) { const x = (i / 25) * W * 1.1 - W * 0.03, base = H * (0.1 + k * 0.08) + Math.sin(i * 0.5 + seed + k) * H * 0.1, len = H * (0.28 + R() * 0.3), gr = g.createLinearGradient(0, base, 0, base + len); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.3, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = 0.16; g.fillStyle = gr; g.fillRect(x, base, W / 22, len); } });
  g.restore();
}

/** クレーターのある月 */
export function moon(g: G, x: number, y: number, r: number, seed: number): void {
  const R = rng(seed); g.save(); g.beginPath(); g.arc(x, y, r, 0, 7); g.clip(); g.fillStyle = '#cfd6e2'; g.fillRect(x - r, y - r, r * 2, r * 2);
  for (let i = 0; i < 40; i++) { const cr = r * (0.04 + R() * 0.16), cx = x + (R() - 0.5) * r * 1.8, cy = y + (R() - 0.5) * r * 1.8; g.fillStyle = 'rgba(80,92,112,0.35)'; g.beginPath(); g.arc(cx, cy, cr, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = Math.max(1, r * 0.008); g.beginPath(); g.arc(cx - cr * 0.1, cy - cr * 0.1, cr, 0.3, 3.4); g.stroke(); }
  const sh = g.createRadialGradient(x - r * 0.35, y - r * 0.3, r * 0.1, x, y, r * 1.1); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.75)'); g.fillStyle = sh; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
}

export function radar(g: G, x: number, y: number, r: number, color: string): void {
  for (let k = 1; k <= 3; k++) { g.save(); g.strokeStyle = color; g.globalAlpha = 0.5 / k + 0.15; g.lineWidth = Math.max(1, r * 0.02); g.beginPath(); g.arc(x, y, (r * k) / 3, 0, 7); g.stroke(); g.restore(); }
  line(g, x - r, y, x + r, y, color, Math.max(1, r * 0.012), 0.5); line(g, x, y - r, x, y + r, color, Math.max(1, r * 0.012), 0.5);
}

export function scan(g: G, W: number, H: number, a = 0.25, step = 4): void {
  g.save(); g.fillStyle = '#000'; g.globalAlpha = a; for (let y = 0; y < H; y += step) g.fillRect(0, y, W, Math.max(1, step * 0.3)); g.restore();
}

export function bars(g: G, x: number, y: number, n: number, w: number, h: number, color: string, seed: number, a = 0.9): void {
  const R = rng(seed); g.save(); g.fillStyle = color; g.globalAlpha = a; for (let i = 0; i < n; i++) g.fillRect(x + i * (w * 1.4), y + h * (1 - R()), w, h); g.restore();
}

export function fillAll(g: G, W: number, H: number, color: string): void { g.fillStyle = color; g.fillRect(0, 0, W, H); }
