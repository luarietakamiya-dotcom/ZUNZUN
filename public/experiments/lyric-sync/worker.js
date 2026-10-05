/* global self, performance */
let transcriber;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'prepare') {
      const start = performance.now();
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.js');
      env.backends.onnx.wasm.numThreads = 1;
      const files = new Map();
      transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
        device: data.device, dtype: 'q8',
        progress_callback: p => {
          if (p.file && p.total) files.set(p.file, p.total);
          self.postMessage({ type: 'progress', file: p.file, progress: p.progress });
        },
      });
      self.postMessage({ type: 'ready', loadMs: performance.now() - start, reportedModelBytes: [...files.values()].reduce((a, b) => a + b, 0), workerHeapUsed: performance.memory?.usedJSHeapSize ?? null, note: 'heap excludes GPU/WASM memory; load may include browser cache' });
    }
    if (data.type === 'run') {
      const start = performance.now(), duration = data.samples.length / 16_000;
      const output = await transcriber(data.samples, { language: 'japanese', task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, max_new_tokens: 128 });
      const invalidRanges = (output.chunks ?? []).filter(c => c.timestamp[0] < 0 || c.timestamp[0] > duration || c.timestamp[1] == null || c.timestamp[1] > duration);
      self.postMessage({ type: 'result', label: data.label, duration, inferenceMs: performance.now() - start, output, invalidRangeCount: invalidRanges.length, status: data.label === 'synthetic-silence-3s' && output.text.trim() ? 'silence-hallucination-reject' : invalidRanges.length ? 'invalid-timestamps-review-required' : 'unverified-asr-not-lyric-alignment', workerHeapUsed: performance.memory?.usedJSHeapSize ?? null });
    }
  } catch (error) { self.postMessage({ type: 'error', error: String(error) }); }
};
