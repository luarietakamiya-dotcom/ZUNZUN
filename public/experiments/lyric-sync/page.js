/* global document, Worker, performance, navigator, URL, Blob, AudioContext, OfflineAudioContext */
const $ = id => document.getElementById(id);
let worker, report = { runs: [] }, generation = 0, prepared = false;
const memory = () => performance.memory ? { heapUsed: performance.memory.usedJSHeapSize, heapLimit: performance.memory.jsHeapSizeLimit, scope: 'main-thread-only-not-total-memory' } : null;
const show = value => { $('status').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
function stop() {
  generation++; worker?.terminate(); worker = null; prepared = false;
  $('prepare').disabled = false; $('silence').disabled = true; $('audio').disabled = true; $('cancel').disabled = true;
}
$('cancel').onclick = () => { stop(); show('中止しました。Workerを終了し、モデルと計算の状態を解放しました。'); };
$('prepare').onclick = async () => {
  stop(); const current = generation, device = $('device').value;
  $('prepare').disabled = true; $('cancel').disabled = false; show('環境確認・モデル準備中…');
  try {
    const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
    if (current !== generation) return;
    if (device === 'webgpu' && !adapter) throw new Error('この環境ではWebGPU adapterを利用できません。WASMは別に測定してください。');
    report = { version: 1, library: '@huggingface/transformers@4.3.0', model: 'onnx-community/whisper-tiny', device, dtype: 'q8', webgpuAdapter: !!adapter, userAgent: navigator.userAgent, runs: [], mainMemoryBefore: memory() };
    worker = new Worker('./worker.js', { type: 'module' });
    worker.onerror = event => { if (current !== generation) return; const message = event.message || 'Workerの読み込みに失敗'; stop(); show(message); };
    worker.onmessage = ({ data }) => {
      if (current !== generation) return;
      if (data.type === 'progress') show(`準備中: ${data.file || ''} ${data.progress == null ? '' : Number(data.progress).toFixed(1) + '%'}`);
      if (data.type === 'ready') {
        prepared = true; Object.assign(report, data, { mainMemoryAfter: memory() });
        $('silence').disabled = false; $('audio').disabled = false; $('export').disabled = false; show(report);
      }
      if (data.type === 'result') {
        report.runs.push(data); $('silence').disabled = !prepared; $('audio').disabled = !prepared; show(report);
      }
      if (data.type === 'error') { report.error = data.error; stop(); show(report); $('export').disabled = false; }
    };
    worker.postMessage({ type: 'prepare', device });
  } catch (error) { report.error = String(error); stop(); show(report); }
};
function run(samples, label) {
  $('silence').disabled = true; $('audio').disabled = true; show('認識中… 中止ボタンで終了できます。');
  worker.postMessage({ type: 'run', samples, label }, [samples.buffer]);
}
$('silence').onclick = () => run(new Float32Array(48_000), 'synthetic-silence-3s');
$('audio').onchange = async event => {
  const file = event.target.files[0]; if (!file || !prepared) return;
  const current = generation, context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16_000), 16_000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const audio = await offline.startRendering(); if (current !== generation) return;
    run(audio.getChannelData(0).slice(), 'user-audio-local');
  } catch (error) { show(String(error)); } finally { await context.close(); }
};
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'vs-sync-benchmark.json'; link.click(); URL.revokeObjectURL(url);
};
