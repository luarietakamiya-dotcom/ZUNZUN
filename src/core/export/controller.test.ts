import { describe, expect, it } from 'vitest';
import { ExportController, type ExportResult, type ExportRunContext } from './controller';

function fakeResult(): ExportResult {
  return { blob: new Blob(['x']), fileName: 'out.mp4', videoCodec: 'H.264', audioCodec: 'AAC', frames: 3 };
}

/** 外から resolve/reject できる runner。途中の状態を観察するために使う。 */
function controllableRunner() {
  let ctx: ExportRunContext | null = null;
  let resolve!: (r: ExportResult) => void;
  let reject!: (e: unknown) => void;
  const runner = (c: ExportRunContext): Promise<ExportResult> => {
    ctx = c;
    return new Promise<ExportResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  };
  return {
    runner,
    get ctx(): ExportRunContext {
      if (!ctx) throw new Error('runner not started');
      return ctx;
    },
    resolve: (r: ExportResult) => resolve(r),
    reject: (e: unknown) => reject(e),
  };
}

describe('ExportController', () => {
  it('idle → running → done と遷移し、進捗を反映する', async () => {
    let clock = 1000;
    const c = new ExportController(() => clock);
    expect(c.status.kind).toBe('idle');

    const r = controllableRunner();
    const p = c.start(r.runner);
    expect(c.status.kind).toBe('running');

    r.ctx.onProgress(2, 10);
    expect(c.status).toEqual({ kind: 'running', done: 2, total: 10, startedAt: 1000 });

    clock = 4000;
    r.resolve(fakeResult());
    await p;
    expect(c.status.kind).toBe('done');
    if (c.status.kind === 'done') {
      expect(c.status.elapsedMs).toBe(3000);
      expect(c.status.result.fileName).toBe('out.mp4');
    }
  });

  it('runner が失敗したら error になる', async () => {
    const c = new ExportController();
    const r = controllableRunner();
    const p = c.start(r.runner);
    r.reject(new Error('encoder died'));
    await p;
    expect(c.status).toEqual({ kind: 'error', message: 'encoder died' });
  });

  it('cancel() すると signal が abort され、cancelled になる', async () => {
    const c = new ExportController();
    const r = controllableRunner();
    const p = c.start(r.runner);
    c.cancel();
    expect(r.ctx.signal.aborted).toBe(true);
    r.reject(new DOMException('cancelled', 'AbortError'));
    await p;
    expect(c.status.kind).toBe('cancelled');
  });

  it('キャンセル後に届いた進捗は無視する', async () => {
    const c = new ExportController();
    const r = controllableRunner();
    const p = c.start(r.runner);
    c.cancel();
    r.ctx.onProgress(5, 10);
    r.reject(new Error('stopped'));
    await p;
    expect(c.status.kind).toBe('cancelled');
  });

  it('実行中にもう一度 start() すると拒否する (二重書き出し防止)', async () => {
    const c = new ExportController();
    const r = controllableRunner();
    const p = c.start(r.runner);
    await expect(c.start(controllableRunner().runner)).rejects.toThrow();
    r.resolve(fakeResult());
    await p;
    expect(c.status.kind).toBe('done');
  });

  it('終わったあとは reset() で idle に戻り、再度 start() できる', async () => {
    const c = new ExportController();
    const r1 = controllableRunner();
    const p1 = c.start(r1.runner);
    r1.resolve(fakeResult());
    await p1;
    c.reset();
    expect(c.status.kind).toBe('idle');

    const r2 = controllableRunner();
    const p2 = c.start(r2.runner);
    expect(c.status.kind).toBe('running');
    r2.resolve(fakeResult());
    await p2;
    expect(c.status.kind).toBe('done');
  });

  it('subscribe したリスナーに状態変化を通知し、解除後は呼ばない', async () => {
    const c = new ExportController();
    const seen: string[] = [];
    const unsubscribe = c.subscribe(() => seen.push(c.status.kind));
    const r = controllableRunner();
    const p = c.start(r.runner);
    r.ctx.onProgress(1, 2);
    unsubscribe();
    r.resolve(fakeResult());
    await p;
    expect(seen).toEqual(['running', 'running']);
  });
});
