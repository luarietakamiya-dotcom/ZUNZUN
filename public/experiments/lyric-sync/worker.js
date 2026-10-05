/* global self, performance */
import { inspectSamples, validateRecognition } from './validation.js?v=1';
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
      const input = inspectSamples(data.samples);
      const start = performance.now(), duration = input.valid ? data.samples.length / 16_000 : null;
      if (!input.valid || input.isSilent) {
        self.postMessage({ type: 'result', label: data.label, duration, inferenceMs: null, modelInvoked: false, input, status: input.valid ? 'silent-input-reject' : 'invalid-audio-reject', output: null, invalidRangeCount: 0 });
        return;
      }
      const output = await transcriber(data.samples, { language: 'japanese', task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, max_new_tokens: 128 });
      self.postMessage({ type: 'result', label: data.label, duration, inferenceMs: performance.now() - start, modelInvoked: true, input, output, ...validateRecognition(output, duration), workerHeapUsed: performance.memory?.usedJSHeapSize ?? null });
    }
  } catch (error) { self.postMessage({ type: 'error', error: String(error) }); }
};
