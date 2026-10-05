// B1の結果検査。正常な時刻でも、既知歌詞への照合が済んだことにはならない。
export function inspectSamples(samples) {
  if (!(samples instanceof Float32Array) || !samples.length) {
    return { valid: false, isSilent: false, reason: 'empty-or-invalid-audio' };
  }
  let peak = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) return { valid: false, isSilent: false, reason: 'non-finite-audio' };
    peak = Math.max(peak, Math.abs(sample));
  }
  // 小さい音を「無音」と決めない。完全なゼロだけをモデルへ渡さず棄却する。
  return { valid: true, isSilent: peak === 0, peak };
}

export function validateRecognition(output, duration, isSilent = false) {
  const issues = [];
  const validDuration = Number.isFinite(duration) && duration > 0;
  if (!validDuration) issues.push({ reason: 'invalid-audio-duration' });
  const hasText = typeof output?.text === 'string';
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  if (!hasText || !Array.isArray(output?.chunks)) issues.push({ reason: 'malformed-asr-output' });
  if (hasText && output.text.trim() && !chunks.length) issues.push({ reason: 'text-without-timestamps' });
  let previousStart = -Infinity, previousEnd = -Infinity;
  let invalidRangeCount = 0;
  chunks.forEach((chunk, index) => {
    const range = chunk?.timestamp;
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite)) {
      issues.push({ index, reason: 'missing-or-non-finite-timestamp' });
      invalidRangeCount++;
      return;
    }
    const [start, end] = range;
    if (end <= start || start < 0 || (validDuration && end > duration)) {
      issues.push({ index, reason: 'invalid-timestamp-range' });
      invalidRangeCount++;
      return;
    }
    if (start < previousStart || end < previousEnd) issues.push({ index, reason: 'non-monotonic-timestamps' });
    previousStart = start; previousEnd = end;
    if (typeof chunk.text !== 'string' || !chunk.text.trim()) issues.push({ index, reason: 'missing-chunk-text' });
  });
  const hallucination = isSilent && ((hasText && !!output.text.trim()) || chunks.length > 0);
  if (hallucination) issues.push({ reason: 'silence-hallucination' });
  return {
    invalidRangeCount,
    issues,
    status: hallucination ? 'silence-hallucination-reject'
      : isSilent ? 'silent-input-reject'
      : issues.length ? 'invalid-asr-output-review-required'
      : 'unverified-asr-not-lyric-alignment',
  };
}
