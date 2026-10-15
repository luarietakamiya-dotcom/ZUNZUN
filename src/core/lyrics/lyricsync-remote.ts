/**
 * 同じ PC で動く LyricSync（http://127.0.0.1:8765）に、曲と歌詞を送って時刻を合わせてもらう（段階 2）。
 * 計画: docs/LYRICSYNC_INTEGRATION_PLAN.md。音源も歌詞も PC の外には出ない（127.0.0.1 だけに送る）。
 *
 * 窓口（LyricSync 1.1.0 の /openapi.json。2026-10-15 この PC で動いている本物で確かめた）:
 *  - GET    /health       起動しているか（{ok, version, device, gpu, model, model_loaded, queued, running}）
 *  - POST   /jobs         multipart: audio / vocals（ファイル）、lyrics（必須）、language、separate、formats → Job
 *  - GET    /jobs/{jid}   Job = {id, status: queued|running|done|error|cancelled, progress 0..1, message, result: {data, files}, error}
 *  - DELETE /jobs/{jid}   取り消す（1.1.0 から）。計算中なら次の区切りで止まって cancelled になる
 * 1.0.0 では応答の形が openapi に無かったので、仕事の番号・状態・結果の名前はよくある名前を幅広く受け付け、
 * 分からない形なら「想定外の応答」として止める（画面から応答を保存して送ってもらえるようにする）。
 * 「中止」は待つのをやめて、LyricSync にも取り消しを送る（取り消せない版なら、LyricSync は裏で最後まで計算する）。
 */

export const LYRICSYNC_URL = 'http://127.0.0.1:8765';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined);

export interface LyricSyncHealth {
  gpu?: string;
  device?: string;
  /** AI のモデルを読み込み済みか（false なら 1 曲目はモデルの読み込みのぶん長くかかる） */
  modelLoaded?: boolean;
}

/** POST /jobs の応答から仕事の番号を取り出す（無ければ null） */
export function readJobId(raw: unknown): string | null {
  if (!isObj(raw)) return str(raw) ?? null;
  const job = isObj(raw.job) ? raw.job : null;
  return str(raw.id) ?? str(raw.jid) ?? str(raw.job_id) ?? str(raw.jobId) ?? (job ? (str(job.id) ?? str(job.jid)) : undefined) ?? null;
}

export type JobState =
  | { kind: 'running'; status: string; progress: number | null; message: string }
  | { kind: 'done'; result: unknown }
  | { kind: 'failed'; error: string }
  | { kind: 'unknown' };

const DONE = new Set(['done', 'finished', 'complete', 'completed', 'success', 'succeeded', 'ok']);
const FAILED = new Set(['error', 'failed', 'failure', 'cancelled', 'canceled', 'aborted']);
/** 結果らしい中身があるか（readLyricSyncResult が読める形） */
const hasResult = (o: Obj): boolean => isObj(o.files) || isObj(o.lineTimes) || isObj(o.zunzun);

/** GET /jobs/{jid}（または POST /jobs）の応答を、計算中・終わった・失敗した・分からない、に分ける */
export function readJobState(raw: unknown): JobState {
  if (!isObj(raw)) return { kind: 'unknown' };
  const status = (str(raw.status) ?? str(raw.state) ?? '').toLowerCase();
  const errText = str(raw.error) ?? (isObj(raw.error) ? str(raw.error.message) : undefined) ?? str(raw.detail) ?? str(raw.message);
  if (status === 'cancelled' || status === 'canceled') return { kind: 'failed', error: 'LyricSync の側で取り消されました' };
  if (FAILED.has(status)) {
    // 1.1.0 は error に例外の文字、message に止まった段階が入る（例: 「合わなかった行を…合わせ直しています」で ValueError）
    const stage = str(raw.error) && str(raw.message) ? str(raw.message) : undefined;
    return { kind: 'failed', error: `${errText ?? status}${stage ? `（「${stage}」の段階で止まりました）` : ''}` };
  }
  const inner = [raw.result, raw.response, raw.output].find(isObj);
  if (DONE.has(status)) return inner || hasResult(raw) ? { kind: 'done', result: inner ?? raw } : { kind: 'unknown' };
  if (!status) {
    if (inner && hasResult(inner)) return { kind: 'done', result: inner };
    if (hasResult(raw)) return { kind: 'done', result: raw };
    if (raw.error != null) return { kind: 'failed', error: errText ?? 'error' };
    return { kind: 'unknown' };
  }
  const p = typeof raw.progress === 'number' && Number.isFinite(raw.progress) ? raw.progress : null;
  const progress = p == null ? null : Math.max(0, Math.min(1, p > 1 ? p / 100 : p));
  return { kind: 'running', status, progress, message: str(raw.message) ?? str(raw.stage) ?? str(raw.step) ?? '' };
}

export type RunResult =
  | { ok: true; result: unknown }
  /**
   * reason: offline = つながらない（起動していない・ブラウザが許可していない）、http = エラーの応答、
   * failed = LyricSync が失敗を返した、format = 想定外の応答、timeout = 待ちすぎ、aborted = 中止
   */
  | { ok: false; reason: 'offline' | 'http' | 'failed' | 'format' | 'timeout' | 'aborted'; error: string; raw?: unknown };

export interface RunOptions {
  audio: Blob;
  audioName?: string;
  vocals?: Blob | null;
  vocalsName?: string;
  lyrics: string;
  language?: string;
  signal?: AbortSignal;
  /** 計算中の様子（経過秒・状態・進み具合 0..1） */
  onProgress?: (p: { elapsed: number; status: string; progress: number | null; message: string }) => void;
  fetchFn?: typeof fetch;
  baseUrl?: string;
  pollMs?: number;
  /** これ以上待たない（秒）。1 曲目はモデルの読み込みがあるので長めにする */
  timeoutSec?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });


async function getJson(fetchFn: typeof fetch, url: string, init?: RequestInit): Promise<{ ok: true; status: number; body: unknown } | { ok: false; offline: true }> {
  let res: Response;
  try { res = await fetchFn(url, init); } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    return { ok: false, offline: true };
  }
  let body: unknown = null;
  const text = await res.text().catch(() => '');
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: true, status: res.status, body };
}

const aborted = (cancelled: boolean): RunResult => ({
  ok: false,
  reason: 'aborted',
  error: cancelled ? '中止しました（LyricSync の計算も止めました）' : '中止しました（LyricSync は裏で計算を続けますが、結果は取り込みません）',
});

/** LyricSync に仕事の取り消しを頼む（1.1.0 から）。受け付けられたら true。待ちすぎないように 3 秒で諦める */
export async function cancelLyricSyncJob(id: string, opts: { fetchFn?: typeof fetch; baseUrl?: string } = {}): Promise<boolean> {
  const fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await getJson(fetchFn, `${opts.baseUrl ?? LYRICSYNC_URL}/jobs/${encodeURIComponent(id)}`, { method: 'DELETE', signal: ctrl.signal });
    if (!r.ok || r.status !== 200 || !isObj(r.body)) return false;
    // 取り消し済み・取り消し待ちなら受け付けられた。終わっていた仕事（done / error）はそのまま返ってくる
    return r.body.status === 'cancelled' || r.body.cancel_requested === true;
  } catch { return false; } finally { clearTimeout(timer); }
}

/** 起動しているかを確かめる。つながらなければ null */
export async function lyricSyncHealth(opts: { fetchFn?: typeof fetch; baseUrl?: string; signal?: AbortSignal } = {}): Promise<LyricSyncHealth | null> {
  const fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  try {
    const r = await getJson(fetchFn, `${opts.baseUrl ?? LYRICSYNC_URL}/health`, { signal: opts.signal });
    if (!r.ok || r.status !== 200 || !isObj(r.body)) return null;
    const b = r.body;
    return { gpu: str(b.gpu), device: str(b.device), modelLoaded: typeof b.model_loaded === 'boolean' ? b.model_loaded : undefined };
  } catch { return null; }
}

const httpError = (status: number, body: unknown): string => {
  const d = isObj(body) ? body.detail : undefined;
  const detail = str(d) ?? (Array.isArray(d) ? d.map((x) => (isObj(x) ? str(x.msg) : '')).filter(Boolean).join(' / ') : '') ?? '';
  return status === 403
    ? 'LyricSync がこのページからの接続を断りました（403）。LyricSync が新しい版か確かめてください'
    : `LyricSync がエラーを返しました（${status}${detail ? `: ${detail}` : ''}）`;
};

/** 曲と歌詞を送り、終わるまで待って結果（応答の JSON）を返す */
export async function runLyricSyncJob(o: RunOptions): Promise<RunResult> {
  const fetchFn = o.fetchFn ?? fetch.bind(globalThis);
  const base = o.baseUrl ?? LYRICSYNC_URL, pollMs = o.pollMs ?? 2000, timeout = (o.timeoutSec ?? 1200) * 1000;
  const now = o.now ?? (() => Date.now()), sleep = o.sleep ?? defaultSleep;
  const t0 = now();
  let id: string | null = null;
  const stop = async (): Promise<RunResult> => aborted(id != null && (await cancelLyricSyncJob(id, { fetchFn, baseUrl: base })));
  const form = new FormData();
  form.append('audio', o.audio, o.audioName ?? 'audio');
  if (o.vocals) form.append('vocals', o.vocals, o.vocalsName ?? 'vocals');
  form.append('lyrics', o.lyrics);
  form.append('language', o.language ?? 'ja');
  // ボーカルのステムを渡すときは、LyricSync 側の分離を飛ばす（速く、精度も上がる。LyricSync の資料より）
  form.append('separate', o.vocals ? 'false' : 'true');
  form.append('formats', 'zunzun');
  try {
    if (o.signal?.aborted) return aborted(false);
    const sub = await getJson(fetchFn, `${base}/jobs`, { method: 'POST', body: form, signal: o.signal });
    if (!sub.ok) return { ok: false, reason: 'offline', error: 'LyricSync につながりませんでした' };
    if (sub.status !== 200) return { ok: false, reason: 'http', error: httpError(sub.status, sub.body), raw: sub.body };
    const first = readJobState(sub.body);
    if (first.kind === 'done') return { ok: true, result: first.result };
    if (first.kind === 'failed') return { ok: false, reason: 'failed', error: first.error, raw: sub.body };
    id = readJobId(sub.body);
    if (!id) return { ok: false, reason: 'format', error: '仕事の番号が応答に見つかりません（想定外の応答）', raw: sub.body };
    for (;;) {
      await sleep(pollMs, o.signal);
      if (o.signal?.aborted) return await stop();
      if (now() - t0 > timeout) {
        const cancelled = await cancelLyricSyncJob(id, { fetchFn, baseUrl: base });
        return { ok: false, reason: 'timeout', error: `${Math.round(timeout / 60000)} 分待っても終わりませんでした${cancelled ? '（LyricSync の計算も止めました）' : ''}` };
      }
      const r = await getJson(fetchFn, `${base}/jobs/${encodeURIComponent(id)}`, { signal: o.signal });
      if (!r.ok) return { ok: false, reason: 'offline', error: '計算の途中で LyricSync につながらなくなりました（LyricSync の窓を閉じた？）' };
      if (r.status === 404) return { ok: false, reason: 'http', error: 'LyricSync が仕事を見失いました（途中で LyricSync を再起動した？）', raw: r.body };
      if (r.status !== 200) return { ok: false, reason: 'http', error: httpError(r.status, r.body), raw: r.body };
      const st = readJobState(r.body);
      if (st.kind === 'done') return { ok: true, result: st.result };
      if (st.kind === 'failed') return { ok: false, reason: 'failed', error: st.error, raw: r.body };
      if (st.kind === 'unknown') return { ok: false, reason: 'format', error: '仕事の様子が読み取れません（想定外の応答）', raw: r.body };
      o.onProgress?.({ elapsed: (now() - t0) / 1000, status: st.status, progress: st.progress, message: st.message });
    }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return await stop();
    throw e;
  }
}
