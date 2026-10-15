import { describe, expect, it } from 'vitest';
import { lyricSyncHealth, readJobId, readJobState, runLyricSyncJob } from './lyricsync-remote';

const RESULT = { files: { zunzun: { lineTimes: { '0': 1 }, lineEnds: {} } }, data: { review: [], lines: ['a'] } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 呼ばれた URL を覚え、順に応答を返すまねの fetch */
function fakeFetch(responses: (Response | Error)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error('応答が足りない');
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const base = { audio: new Blob(['x']), lyrics: 'a', pollMs: 1, sleep: async () => {} };

describe('readJobId / readJobState', () => {
  it('よくある名前の仕事の番号を受け付ける', () => {
    expect(readJobId({ id: 'a1' })).toBe('a1');
    expect(readJobId({ jid: 'b2' })).toBe('b2');
    expect(readJobId({ job_id: 3 })).toBe('3');
    expect(readJobId({ job: { id: 'c' } })).toBe('c');
    expect(readJobId({ ok: true })).toBeNull();
  });
  it('計算中・終わった・失敗・分からない を分ける', () => {
    expect(readJobState({ status: 'running', progress: 40 })).toEqual({ kind: 'running', status: 'running', progress: 0.4, message: '' });
    expect(readJobState({ status: 'queued' }).kind).toBe('running');
    expect(readJobState({ status: 'done', result: RESULT })).toEqual({ kind: 'done', result: RESULT });
    expect(readJobState({ status: 'done', ...RESULT })).toMatchObject({ kind: 'done' });
    expect(readJobState(RESULT)).toEqual({ kind: 'done', result: RESULT });
    expect(readJobState({ status: 'error', error: '歌詞が空' })).toEqual({ kind: 'failed', error: '歌詞が空' });
    expect(readJobState({ status: 'done' })).toEqual({ kind: 'unknown' });
    expect(readJobState({ hello: 1 })).toEqual({ kind: 'unknown' });
    expect(readJobState('x')).toEqual({ kind: 'unknown' });
  });
});

describe('lyricSyncHealth', () => {
  it('起動していれば GPU とモデルの状態を返し、つながらなければ null', async () => {
    const ok = fakeFetch([json({ ok: true, gpu: 'RTX', device: 'cuda', model_loaded: false })]);
    expect(await lyricSyncHealth({ fetchFn: ok.fn })).toEqual({ gpu: 'RTX', device: 'cuda', modelLoaded: false });
    expect(ok.calls[0]!.url).toBe('http://127.0.0.1:8765/health');
    expect(await lyricSyncHealth({ fetchFn: fakeFetch([new TypeError('Failed to fetch')]).fn })).toBeNull();
    expect(await lyricSyncHealth({ fetchFn: fakeFetch([json({}, 403)]).fn })).toBeNull();
  });
});

describe('runLyricSyncJob', () => {
  it('送る → 計算中 → 終わった、で結果を返す。送る中身は曲・歌詞・言語・分離・zunzun 形式', async () => {
    const f = fakeFetch([json({ id: 'j1', status: 'queued' }), json({ status: 'running', progress: 0.5 }), json({ status: 'done', result: RESULT })]);
    const seen: number[] = [];
    const res = await runLyricSyncJob({ ...base, lyrics: '一行目\n二行目', fetchFn: f.fn, onProgress: (p) => seen.push(p.progress ?? -1) });
    expect(res).toEqual({ ok: true, result: RESULT });
    expect(f.calls.map((c) => c.url)).toEqual(['http://127.0.0.1:8765/jobs', 'http://127.0.0.1:8765/jobs/j1', 'http://127.0.0.1:8765/jobs/j1']);
    const form = f.calls[0]!.init!.body as FormData;
    expect(form.get('lyrics')).toBe('一行目\n二行目'); // 改行を残す（/docs の画面では消えてしまった）
    expect(form.get('language')).toBe('ja');
    expect(form.get('separate')).toBe('true');
    expect(form.get('formats')).toBe('zunzun');
    expect(form.get('audio')).toBeInstanceOf(Blob);
    expect(form.get('vocals')).toBeNull();
    expect(seen).toEqual([0.5]);
  });
  it('ボーカルのステムを渡すと分離を飛ばす', async () => {
    const f = fakeFetch([json(RESULT)]);
    await runLyricSyncJob({ ...base, vocals: new Blob(['v']), fetchFn: f.fn });
    const form = f.calls[0]!.init!.body as FormData;
    expect(form.get('separate')).toBe('false');
    expect(form.get('vocals')).toBeInstanceOf(Blob);
  });
  it('つながらない・403・失敗・想定外・仕事が消えた、を理由つきで返す', async () => {
    expect(await runLyricSyncJob({ ...base, fetchFn: fakeFetch([new TypeError('x')]).fn })).toMatchObject({ ok: false, reason: 'offline' });
    expect(await runLyricSyncJob({ ...base, fetchFn: fakeFetch([json({ detail: 'Forbidden' }, 403)]).fn })).toMatchObject({ ok: false, reason: 'http', error: expect.stringContaining('403') });
    expect(await runLyricSyncJob({ ...base, fetchFn: fakeFetch([json({ id: 'j' }), json({ status: 'failed', error: 'GPU のメモリ不足' })]).fn })).toMatchObject({ ok: false, reason: 'failed', error: 'GPU のメモリ不足' });
    const odd = await runLyricSyncJob({ ...base, fetchFn: fakeFetch([json({ hello: 1 })]).fn });
    expect(odd).toMatchObject({ ok: false, reason: 'format', raw: { hello: 1 } });
    expect(await runLyricSyncJob({ ...base, fetchFn: fakeFetch([json({ id: 'j' }), json({ detail: 'Not Found' }, 404)]).fn })).toMatchObject({ ok: false, reason: 'http', error: expect.stringContaining('見失い') });
    expect(await runLyricSyncJob({ ...base, fetchFn: fakeFetch([json({ id: 'j' }), new TypeError('x')]).fn })).toMatchObject({ ok: false, reason: 'offline' });
  });
  it('中止すると待つのをやめ、LyricSync にも取り消し（DELETE /jobs/{id}）を送る', async () => {
    const ctrl = new AbortController();
    const f = fakeFetch([json({ id: 'j', status: 'queued' }), json({ id: 'j', status: 'running' }), json({ id: 'j', status: 'running', cancel_requested: true })]);
    const res = await runLyricSyncJob({ ...base, fetchFn: f.fn, signal: ctrl.signal, onProgress: () => ctrl.abort() });
    expect(res).toMatchObject({ ok: false, reason: 'aborted', error: expect.stringContaining('計算も止めました') });
    expect(f.calls.length).toBe(3);
    expect(f.calls[2]).toMatchObject({ url: 'http://127.0.0.1:8765/jobs/j', init: { method: 'DELETE' } });
    // 取り消しの窓口が無い版（1.0.0 は 405）なら、裏で計算が続くと伝える
    const ctrl2 = new AbortController();
    const old = fakeFetch([json({ id: 'j' }), json({ status: 'running' }), json({ detail: 'Method Not Allowed' }, 405)]);
    const res2 = await runLyricSyncJob({ ...base, fetchFn: old.fn, signal: ctrl2.signal, onProgress: () => ctrl2.abort() });
    expect(res2).toMatchObject({ ok: false, reason: 'aborted', error: expect.stringContaining('裏で計算を続けます') });
    // 送る前に中止していたら、何も送らない
    const ctrl3 = new AbortController();
    ctrl3.abort();
    const none = fakeFetch([]);
    expect(await runLyricSyncJob({ ...base, fetchFn: none.fn, signal: ctrl3.signal })).toMatchObject({ ok: false, reason: 'aborted' });
    expect(none.calls).toEqual([]);
  });
  it('時間切れでも止まり、LyricSync に取り消しを送る', async () => {
    let t = 0;
    const f = fakeFetch([json({ id: 'j' }), json({ status: 'running' }), json({ id: 'j', status: 'cancelled' })]);
    const slow = await runLyricSyncJob({ ...base, timeoutSec: 10, now: () => (t += 6000), fetchFn: f.fn });
    expect(slow).toMatchObject({ ok: false, reason: 'timeout', error: expect.stringContaining('計算も止めました') });
    expect(f.calls[2]!.init?.method).toBe('DELETE');
  });
  it('LyricSync 1.1.0 の本物の失敗の応答（2026-10-15 に THREE COUNT で出たもの）を、止まった段階つきで伝える', async () => {
    const real = { id: '2e7a318db986', status: 'error', progress: 0.9, message: '合わなかった行をその周りだけで合わせ直しています', created: 1792072063.39, cancel_requested: false, result: null, error: 'ValueError: max() arg is an empty sequence' };
    expect(readJobState(real)).toEqual({ kind: 'failed', error: 'ValueError: max() arg is an empty sequence（「合わなかった行をその周りだけで合わせ直しています」の段階で止まりました）' });
    expect(readJobState({ ...real, status: 'cancelled', error: null })).toEqual({ kind: 'failed', error: 'LyricSync の側で取り消されました' });
  });
});
