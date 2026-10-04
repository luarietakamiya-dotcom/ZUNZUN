import { expect, test, type Page } from '@playwright/test';

/**
 * 使い続けても、PC やスマホを重くしたり壊したりしないか (2026-10-04 公開前の確認)。
 * タブ・ビジュアライザー・画面の大きさ・PC/スマホ表示・曲の読み込み・再生を、ひたすら連打して、資源が増え続けないことを測る:
 * - WebGL の描画面 (生きているもの。ブラウザの上限は約 16。超えると古い面が奪われて画面が壊れる)
 * - 動き続ける処理 (1 フレームあたりの requestAnimationFrame の呼び出し数。切り替えのたびに増えると、重く・熱くなる)
 * - イベントの受け口 (window / document)、ストアの購読の数
 * - 生きている AudioContext の数 (iOS Safari は 4 つほどが上限)
 * - JS ヒープの増え方、長く続く処理 (longtask。固まり) の最大
 * - 「Too many active WebGL contexts」の警告・エラーが出ない
 * 画面は PC (1280 幅) とスマホ (390 幅 + ?mobile) の両方。
 */

test.describe.configure({ timeout: 280_000, mode: 'serial' });
test.use({
  launchOptions: {
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  },
});

interface Snapshot {
  webglLive: number;
  webglCreated: number;
  rafPerFrame: number;
  listeners: Record<string, number>;
  storeSubs: number;
  audioLive: number;
  audioCreated: number;
  heapMB: number;
  longTaskMax: number;
}

/** ページに入れる計測の仕掛け (ページの JS より先に動かす) */
async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const res = { rafCalls: 0, webgl: [] as WeakRef<WebGLRenderingContext>[], longTaskMax: 0, audioCreated: 0 };
    w.__probe = res;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      res.rafCalls++;
      return raf(cb);
    };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const c = (getContext as (...a: unknown[]) => unknown).call(this, type, ...rest);
      if (c && /webgl/.test(type)) res.webgl.push(new WeakRef(c as WebGLRenderingContext));
      return c as never;
    } as never;
    // window / document の受け口 (同じ組は 1 つと数える。signal での取り外しも反映)
    const table = new Map<string, Set<unknown>>();
    w.__listeners = table;
    const add = EventTarget.prototype.addEventListener;
    const rem = EventTarget.prototype.removeEventListener;
    const nameOf = (t: unknown): string | null => (t === window ? 'window' : t === document ? 'document' : null);
    EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, l: unknown, o?: unknown) {
      const n = nameOf(this);
      if (n && l) {
        const key = `${n}:${type}`;
        const set = table.get(key) ?? new Set();
        const id = { l, c: typeof o === 'boolean' ? o : !!(o as { capture?: boolean } | undefined)?.capture };
        const dup = [...set].some((x) => (x as typeof id).l === l && (x as typeof id).c === id.c);
        if (!dup) {
          set.add(id);
          table.set(key, set);
          const signal = (o as { signal?: AbortSignal } | undefined)?.signal;
          signal?.addEventListener('abort', () => set.delete(id));
        }
      }
      return (add as (...a: unknown[]) => void).call(this, type, l, o);
    } as never;
    EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, l: unknown, o?: unknown) {
      const n = nameOf(this);
      if (n) {
        const set = table.get(`${n}:${type}`);
        const c = typeof o === 'boolean' ? o : !!(o as { capture?: boolean } | undefined)?.capture;
        if (set) for (const x of [...set]) if ((x as { l: unknown; c: boolean }).l === l && (x as { c: boolean }).c === c) set.delete(x);
      }
      return (rem as (...a: unknown[]) => void).call(this, type, l, o);
    } as never;
    // 生きている AudioContext
    const live = new Set<unknown>();
    w.__audioLive = live;
    const AC = window.AudioContext;
    if (AC) {
      window.AudioContext = class extends AC {
        constructor(...a: ConstructorParameters<typeof AC>) {
          super(...a);
          live.add(this);
          res.audioCreated++;
        }
        close(): Promise<void> {
          live.delete(this);
          return super.close();
        }
      } as never;
    }
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) res.longTaskMax = Math.max(res.longTaskMax, e.duration);
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      /* 非対応のブラウザでは測らない */
    }
  });
}

/** いまの資源の量 (ガーベジコレクションのあと) */
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(async () => {
    const w = window as unknown as { gc?: () => void; __probe: { rafCalls: number; webgl: WeakRef<WebGLRenderingContext>[]; longTaskMax: number; audioCreated: number }; __listeners: Map<string, Set<unknown>>; __audioLive: Set<unknown> };
    w.gc?.();
    await new Promise((r) => setTimeout(r, 200));
    w.gc?.();
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    // 1 フレームあたりの rAF の呼び出し数: 1 秒間の呼び出し数 / 描いたフレーム数 (数えるための自分の 1 回を引く)
    const before = w.__probe.rafCalls;
    let frames = 0;
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const loop = (): void => {
        frames++;
        if (performance.now() - t0 > 1500) resolve();
        else requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    const calls = w.__probe.rafCalls - before - frames;
    await sleep(0);
    const { store } = await import('/src/core/store.ts');
    const listeners: Record<string, number> = {};
    for (const [k, set] of w.__listeners) if (set.size > 0) listeners[k] = set.size;
    const live = w.__probe.webgl.map((r) => r.deref()).filter((c): c is WebGLRenderingContext => c != null && !c.isContextLost());
    return {
      webglLive: live.length,
      webglCreated: w.__probe.webgl.length,
      rafPerFrame: frames > 0 ? calls / frames : 0,
      listeners,
      storeSubs: ((store as unknown as { listeners: Set<unknown> }).listeners).size,
      audioLive: w.__audioLive.size,
      audioCreated: w.__probe.audioCreated,
      heapMB: ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576,
      longTaskMax: w.__probe.longTaskMax,
    };
  });
}

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/Too many active WebGL contexts|WebGL: CONTEXT_LOST|context lost|THREE\.WebGLRenderer: Context Lost/i.test(t)) problems.push(`WebGL: ${t.slice(0, 160)}`);
    else if (m.type() === 'error' && !/ERR_CERT|net::ERR|Failed to load resource/.test(t)) problems.push(`error: ${t.slice(0, 160)}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
  return problems;
}

const toneWav = (): Buffer => {
  const sr = 22050;
  const n = sr * 4;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round((Math.sin((i / sr) * 2 * Math.PI * 220) * 8000 * (1 + Math.sin((i / sr) * 8))) / 2), 44 + i * 2);
  return buf;
};

/** 資源が、基準から増え続けていないこと (基準 = 一巡した直後。ゆらぎのぶんだけ余裕を持たせる) */
function expectNotGrowing(base: Snapshot, now: Snapshot, label: string): void {
  expect(now.webglLive, `${label}: 生きている WebGL の描画面 (プレビューの 1 つ + 余裕)`).toBeLessThanOrEqual(3);
  expect(now.rafPerFrame, `${label}: 1 フレームあたりの rAF の呼び出し (動き続ける処理が増えていない)`).toBeLessThanOrEqual(base.rafPerFrame + 1.5);
  expect(now.storeSubs, `${label}: ストアの購読`).toBeLessThanOrEqual(base.storeSubs + 4);
  for (const [k, v] of Object.entries(now.listeners)) expect(v, `${label}: ${k} の受け口`).toBeLessThanOrEqual((base.listeners[k] ?? 0) + 2);
  expect(now.audioLive, `${label}: 生きている AudioContext`).toBeLessThanOrEqual(2);
  expect(now.heapMB - base.heapMB, `${label}: JS ヒープの増え (MB)`).toBeLessThan(150);
  expect(now.longTaskMax, `${label}: 長く続いた処理 (ms。固まり)`).toBeLessThan(12_000);
}

for (const device of [
  { name: 'PC', size: { width: 1280, height: 800 }, url: '/?pc' },
  { name: 'スマホ', size: { width: 390, height: 760 }, url: '/?mobile' },
]) {
  const isMobile = device.name === 'スマホ';
  const tab = async (page: Page, panel: 'music' | 'visualizer' | 'overlay' | 'export'): Promise<void> => {
    if (!isMobile) await page.locator(`button[data-panel="${panel}"]`).click();
    else {
      const menu = { music: 'music', visualizer: 'visual', overlay: 'visual', export: 'export' }[panel];
      await page.locator(`.m-nav-button[data-menu="${menu}"]`).click();
    }
    await page.waitForTimeout(40);
  };

  test.describe(`${device.name}: 使い続けても資源が増え続けない`, () => {
    test(`${device.name}: タブ (メニュー) を 40 回切り替えても、描画面・処理・受け口・購読が増えない`, async ({ page }) => {
      await installProbe(page);
      const problems = collectProblems(page);
      await page.setViewportSize(device.size);
      await page.goto(device.url);
      await page.waitForTimeout(800);
      // 基準: ビジュアライザーを 1 度開いたあと
      await tab(page, 'visualizer');
      await page.waitForTimeout(800);
      await tab(page, 'music');
      const base = await snapshot(page);
      for (let i = 0; i < 40; i++) await tab(page, (['visualizer', 'music', 'export', 'overlay', 'visualizer', 'music'] as const)[i % 6]!);
      await tab(page, 'visualizer');
      await page.waitForTimeout(500);
      const now = await snapshot(page);
      console.log(`[${device.name}] タブ 40 回`, JSON.stringify({ base: { raf: base.rafPerFrame, subs: base.storeSubs, heap: Math.round(base.heapMB) }, now: { webgl: now.webglLive, created: now.webglCreated, raf: now.rafPerFrame, subs: now.storeSubs, heap: Math.round(now.heapMB), longTask: Math.round(now.longTaskMax) } }));
      expectNotGrowing(base, now, 'タブ切り替え');
      expect(problems, problems.join('\n')).toEqual([]);
    });

    test(`${device.name}: 全ビジュアライザーを 2 周・おまかせを 30 回連打しても、壊れず、固まらず、増えない`, async ({ page }) => {
      await installProbe(page);
      const problems = collectProblems(page);
      await page.setViewportSize(device.size);
      await page.goto(device.url);
      await page.locator('input[type=file]').first().setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav() });
      await expect(page.locator('[data-omakase="go"]')).toBeEnabled({ timeout: 30_000 });
      await tab(page, 'visualizer');
      await page.waitForTimeout(800);
      const ids = await page.locator('.preset-select-row select option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value).filter((v) => !v.startsWith('_')));
      expect(ids.length).toBeGreaterThanOrEqual(16);
      const select = page.locator('.preset-select-row select');
      await select.selectOption(ids[1]!);
      await page.waitForTimeout(600);
      const base = await snapshot(page);
      for (let round = 0; round < 2; round++) for (const id of ids) {
        await select.selectOption(id);
        await page.waitForTimeout(150);
      }
      await tab(page, 'music');
      for (let i = 0; i < 30; i++) {
        await page.locator(i === 0 ? '[data-omakase="go"]' : '[data-omakase="next"]').click();
        await page.waitForTimeout(60);
      }
      await tab(page, 'visualizer');
      await page.waitForTimeout(800);
      const now = await snapshot(page);
      console.log(`[${device.name}] 全種類×2 + おまかせ 30`, JSON.stringify({ webgl: now.webglLive, created: now.webglCreated, raf: now.rafPerFrame, subs: now.storeSubs, heap: Math.round(now.heapMB - base.heapMB), longTask: Math.round(now.longTaskMax) }));
      expectNotGrowing(base, now, 'ビジュアライザー切り替え');
      expect(problems, problems.join('\n')).toEqual([]);
    });

    test(`${device.name}: 画面の大きさを 60 回・PC/スマホ表示を 12 往復しても、受け口と処理が増えない`, async ({ page }) => {
      await installProbe(page);
      const problems = collectProblems(page);
      await page.setViewportSize(device.size);
      await page.goto(device.url);
      await tab(page, 'visualizer');
      await page.waitForTimeout(800);
      const base = await snapshot(page);
      const ratios = ['16:9', '9:16', '1:1', '2:3', '3:2'];
      for (let i = 0; i < 60; i++) {
        await page.locator(`[data-size-ratio="${ratios[i % 5]}"]`).click();
        await page.waitForTimeout(30);
      }
      // 表示の切り替え (枠組みを作り直す。古い受け口・描画面が残らないこと)
      for (let i = 0; i < 12; i++) {
        await page.evaluate(async (to) => (await import('/src/ui/layout.ts')).setLayout(to as 'pc' | 'mobile'), i % 2 === 0 ? 'mobile' : 'pc');
        await page.waitForTimeout(250);
      }
      await page.evaluate(async (to) => (await import('/src/ui/layout.ts')).setLayout(to as 'pc' | 'mobile'), isMobile ? 'mobile' : 'pc');
      await page.waitForTimeout(800);
      const now = await snapshot(page);
      console.log(`[${device.name}] 大きさ 60 + 表示 12 往復`, JSON.stringify({ webgl: now.webglLive, created: now.webglCreated, raf: now.rafPerFrame, subs: now.storeSubs, listeners: now.listeners, heap: Math.round(now.heapMB - base.heapMB) }));
      expectNotGrowing(base, now, '大きさ・表示の切り替え');
      expect(problems, problems.join('\n')).toEqual([]);
    });

    test(`${device.name}: 曲の読み込み 6 回・再生/一時停止 80 回でも、AudioContext が増えず、エラーが出ない`, async ({ page }) => {
      await installProbe(page);
      const problems = collectProblems(page);
      await page.setViewportSize(device.size);
      await page.goto(device.url);
      const base = await snapshot(page);
      for (let i = 0; i < 6; i++) {
        await page.locator('input[type=file]').first().setInputFiles({ name: `tone${i}.wav`, mimeType: 'audio/wav', buffer: toneWav() });
        await expect(page.locator('[data-omakase="go"]')).toBeEnabled({ timeout: 30_000 });
        await expect(page.locator('.placeholder-card')).toContainText(`tone${i}.wav`);
      }
      for (let i = 0; i < 80; i++) {
        await page.locator('[data-music="play"]').click();
        if (i % 10 === 0) await page.waitForTimeout(80);
      }
      await page.locator('[data-music="play"]').evaluate((b) => (b as HTMLButtonElement).textContent); // 画面が応答する
      const now = await snapshot(page);
      console.log(`[${device.name}] 曲 6 回 + 再生 80 回`, JSON.stringify({ audioLive: now.audioLive, audioCreated: now.audioCreated, raf: now.rafPerFrame, subs: now.storeSubs, heap: Math.round(now.heapMB - base.heapMB) }));
      expect(now.audioLive, '生きている AudioContext (iOS Safari は 4 つほどが上限)').toBeLessThanOrEqual(2);
      expectNotGrowing(base, now, '曲の読み込み・再生');
      expect(problems, problems.join('\n')).toEqual([]);
    });
  });
}
