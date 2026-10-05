import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectSamples, validateRecognition } from '../public/experiments/lyric-sync/validation.js';

const output = timestamp => ({ text: '君がいた', chunks: [{ text: '君がいた', timestamp }] });

test('unknown real-song audio remains unverified even with valid timestamps', () => {
  const result = validateRecognition(output([0, 3]), 3);
  assert.equal(result.status, 'unverified-asr-not-lyric-alignment');
  assert.deepEqual(result.issues, []);
});

test('malformed, missing, reversed, zero-length and out-of-range timestamps cannot pass', () => {
  for (const range of [null, [], [null, 1], [0, null], [NaN, 1], [0, Infinity], ['0', 1], [2, 1], [1, 1], [-1, 1], [0, 4], [4, 5]]) {
    const result = validateRecognition(output(range), 3);
    assert.equal(result.invalidRangeCount, 1, JSON.stringify(range));
    assert.equal(result.status, 'invalid-asr-output-review-required');
  }
});

test('backwards segments and untimed text are flagged separately', () => {
  const result = validateRecognition({ text: '君がいた光を', chunks: [
    { text: '君がいた', timestamp: [1, 2] }, { text: '光を', timestamp: [0, 1] },
  ] }, 3);
  assert.equal(result.invalidRangeCount, 0);
  assert.ok(result.issues.some(issue => issue.reason === 'non-monotonic-timestamps'));
  assert.ok(validateRecognition({ text: '君がいた', chunks: [] }, 3).issues.some(issue => issue.reason === 'text-without-timestamps'));
  for (const malformed of [null, {}, { text: 5, chunks: [] }, { text: '', chunks: {} }]) {
    assert.equal(validateRecognition(malformed, 3).status, 'invalid-asr-output-review-required');
  }
  assert.equal(validateRecognition(output([0, 1]), NaN).status, 'invalid-asr-output-review-required');
});

test('only exact silence skips recognition; quiet vocals do not', () => {
  assert.equal(inspectSamples(new Float32Array(48_000)).isSilent, true);
  assert.equal(inspectSamples(new Float32Array([0, 1e-10])).isSilent, false);
  for (const samples of [null, [], new Float32Array(), new Float32Array([NaN]), new Float32Array([Infinity])]) {
    assert.equal(inspectSamples(samples).valid, false);
  }
  assert.equal(validateRecognition(output([0, 1]), 3, true).status, 'silence-hallucination-reject');
  assert.equal(validateRecognition({ text: '', chunks: [] }, 3, true).status, 'silent-input-reject');
});

test('recorded browser silence hallucination still rejects its nine invalid segments', async () => {
  const report = JSON.parse(await readFile(new URL('../docs/experiments/whisper-tiny-silence-browser.json', import.meta.url), 'utf8'));
  const run = report.runs[0];
  const result = validateRecognition(run.output, run.duration, true);
  assert.equal(result.status, 'silence-hallucination-reject');
  assert.equal(result.invalidRangeCount, 9);
});

test('worker rejects silent and invalid input before needing a loaded model', async () => {
  const messages = [];
  const savedSelf = globalThis.self;
  globalThis.self = { postMessage: message => messages.push(message) };
  try {
    await import('../public/experiments/lyric-sync/worker.js');
    for (const samples of [new Float32Array(48_000), new Float32Array([NaN]), null]) {
      await globalThis.self.onmessage({ data: { type: 'run', samples, label: 'user-audio-local' } });
    }
    assert.equal(messages.length, 3);
    assert.equal(messages[0].status, 'silent-input-reject');
    assert.equal(messages[1].status, 'invalid-audio-reject');
    assert.equal(messages[2].status, 'invalid-audio-reject');
    for (const message of messages) {
      assert.equal(message.type, 'result');
      assert.equal(message.modelInvoked, false);
      assert.equal(message.inferenceMs, null);
    }
  } finally {
    if (savedSelf === undefined) delete globalThis.self;
    else globalThis.self = savedSelf;
  }
});
