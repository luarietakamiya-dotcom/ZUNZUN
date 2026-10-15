"""Independent known-lyric CTC aligner. No VS/LyricSync imports or audio upload.

Uses pretrained acoustic emissions; this is not a newly trained foundation model.
All returned times are singing times. No display lead or beat snapping is applied.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import time
import unicodedata

import numpy as np

MODEL_SHA256 = '5c6b2b5f14445e1dd12cfc055e96bbc47dd87d4e874e43636d212bc201280d48'
MODEL_REVISION = '65708394988700bb979592c5e476009c97cb4c17'
UPSTREAM_REVISION = '46afc596052b612293c8db256b3a69447a2f57dc'
LARGE_SHA256 = '90b0e01385f90809f7818ffcc14d7ba18070b63e58af0aa64cc86cb3e703a24c'
VOCAB_SHA256 = '223300c979885b08b6a44f18b6b76cae49099c6de1a0bc2d5694a32827b3a7ab'
RATE = 16000
STRIDE = 320
RECEPTIVE = 400


def sha256(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def normalized(text: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFKC', text).lower()
                   if unicodedata.category(c)[0] in 'LN' or c in 'ーっゃゅょぁぃぅぇぉ')


class Tokenizer:
    def __init__(self, vocab: dict[str, int]):
        self.vocab = vocab
        self.inverse = {v: k for k, v in vocab.items()}
        self.pieces = sorted((p for p, i in vocab.items()
                              if i != 0 and normalized(p) == p and p), key=lambda p: (-len(p), p))
        from pykakasi import kakasi
        self.reader = kakasi()

    def reading(self, text: str) -> str:
        parts = self.reader.convert(text)
        if any(normalized(p['orig']) and not normalized(p['hira']) for p in parts):
            raise ValueError('unsupported-lyric-characters')
        return normalized(''.join(p['hira'] for p in parts))

    def encode(self, text: str) -> tuple[list[int], list[str], bool]:
        """Longest vocabulary pieces; explicitly mark a kana-reading fallback.

        Unknown characters are rejected, never silently removed/replaced by blank.
        Original lyric text is retained separately from this acoustic representation.
        """
        source = normalized(text)
        if not source:
            raise ValueError('empty-normalized-line')
        for fallback, value in [(False, source), (True, self.reading(source))]:
            if not value: continue
            ids, pieces, position = [], [], 0
            while position < len(value):
                piece = next((p for p in self.pieces if value.startswith(p, position)), None)
                if piece is None:
                    break
                ids.append(self.vocab[piece]); pieces.append(piece); position += len(piece)
            if position == len(value):
                return ids, pieces, fallback
        raise ValueError('unsupported-lyric-characters')


def ctc_viterbi(logp: np.ndarray, tokens: list[int], blank: int = 0,
                max_cells: int = 100_000_000) -> tuple[list[dict], float]:
    """Exact blank-expanded CTC Viterbi. Consecutive equal tokens require a blank.

    Scores are acoustic path log probabilities, not calibrated confidence values.
    O(frames * tokens) backtracking memory, bounded before allocation.
    """
    logp = np.asarray(logp, dtype=np.float32)
    if logp.ndim != 2 or not np.isfinite(logp).all():
        raise ValueError('invalid-emissions')
    frames, vocabulary = logp.shape
    if not tokens or any(not isinstance(t, (int, np.integer)) or t == blank or t < 0 or t >= vocabulary for t in tokens):
        raise ValueError('invalid-target-tokens')
    minimum = len(tokens) + sum(a == b for a, b in zip(tokens, tokens[1:]))
    if frames < minimum:
        raise ValueError('impossible-ctc-path')
    labels = np.full(len(tokens) * 2 + 1, blank, dtype=np.int32)
    labels[1::2] = tokens
    states = len(labels)
    if frames * states > max_cells:
        raise ValueError('alignment-memory-budget-exceeded')
    skip = np.zeros(states, bool)
    skip[2:] = (labels[2:] != blank) & (labels[2:] != labels[:-2])
    previous = np.full(states, -np.inf, dtype=np.float32); previous[0] = 0
    back = np.zeros((frames, states), dtype=np.uint8)
    for frame in range(frames):
        advance = np.full(states, -np.inf, dtype=np.float32); advance[1:] = previous[:-1]
        jump = np.full(states, -np.inf, dtype=np.float32); jump[2:] = previous[:-2]
        jump[~skip] = -np.inf
        choice = np.where(advance > previous, 1, 0).astype(np.uint8)
        best = np.maximum(previous, advance)
        choice[jump > best] = 2
        previous = np.maximum(best, jump) + logp[frame, labels]
        back[frame] = choice
    state = states - 1 if previous[-1] >= previous[-2] else states - 2
    score = float(previous[state])
    if not math.isfinite(score):
        raise ValueError('impossible-ctc-path')
    path = np.empty(frames, dtype=np.int32)
    for frame in range(frames - 1, -1, -1):
        path[frame] = state
        state -= int(back[frame, state])
    spans = []
    for index, token in enumerate(tokens):
        hit = np.flatnonzero(path == index * 2 + 1)
        if not len(hit):
            raise ValueError('unvisited-target-token')
        start, end = int(hit[0]), int(hit[-1]) + 1
        spans.append({'token': int(token), 'startFrame': start, 'endFrame': end,
                      'logProbability': float(logp[hit, token].mean()),
                      'greedySupport': float((logp[hit].argmax(axis=1) == token).mean())})
    return spans, score


def load_audio(path: Path) -> np.ndarray:
    import soundfile as sf
    from scipy.signal import resample_poly
    audio, rate = sf.read(path, dtype='float32', always_2d=True)
    if not len(audio) or not np.isfinite(audio).all():
        raise ValueError('empty-or-nonfinite-audio')
    audio = audio.mean(axis=1)
    if rate != RATE:
        divisor = math.gcd(rate, RATE)
        audio = resample_poly(audio, RATE // divisor, rate // divisor).astype(np.float32)
    return audio


class AcousticModel:
    def __init__(self, path: Path, threads: int = 2, expected_hash: str = MODEL_SHA256):
        import onnxruntime as ort
        if sha256(path) != expected_hash:
            raise ValueError('model-hash-mismatch')
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads; options.inter_op_num_threads = 1
        options.log_severity_level = 3
        self.session = ort.InferenceSession(str(path), sess_options=options,
                                           providers=['CPUExecutionProvider'])

    def emissions(self, samples: np.ndarray, chunk_frames: int = 800,
                  progress=None) -> np.ndarray:
        if samples.ndim != 1 or len(samples) < RECEPTIVE or not np.isfinite(samples).all():
            raise ValueError('invalid-audio-samples')
        if not np.any(samples):
            raise ValueError('silent-input-reject')
        total = (len(samples) - RECEPTIVE) // STRIDE + 1
        blocks = []
        for first in range(0, total, chunk_frames):
            last = min(total, first + chunk_frames)
            # Two seconds of context, with all crop starts on the same frame grid.
            begin = max(0, first * STRIDE - RATE * 2)
            finish = min(len(samples), last * STRIDE + RATE * 2 + RECEPTIVE)
            block = samples[begin:finish].astype(np.float32).copy()
            block = (block - block.mean()) / np.sqrt(block.var() + 1e-7)
            output = self.session.run(None, {'input_values': block[None]})[0][0]
            offset = first - begin // STRIDE
            logits = output[offset:offset + last - first].astype(np.float32)
            if len(logits) != last - first or logits.shape[1] != 3003 or not np.isfinite(logits).all():
                raise ValueError('invalid-model-output')
            logits -= logits.max(axis=1, keepdims=True)
            blocks.append(logits - np.log(np.exp(logits).sum(axis=1, keepdims=True)))
            if progress:
                progress(last / total)
        return np.concatenate(blocks)


def align_lines(logp: np.ndarray, lines: list[str], tokenizer: Tokenizer,
                duration: float) -> dict:
    ids, metadata = [], []
    for index, text in enumerate(lines):
        if not text.strip():
            metadata.append({'lineId': index, 'text': text, 'status': 'unmatched', 'reasons': ['empty-line']})
            continue
        try:
            encoded, pieces, fallback = tokenizer.encode(text)
            metadata.append({'lineId': index, 'text': text, 'firstToken': len(ids),
                             'tokenCount': len(encoded), 'pieces': pieces, 'readingFallback': fallback})
            ids.extend(encoded)
        except ValueError as error:
            # A missing line must not silently shift the timing of every later line.
            return {'status': 'unmatched', 'reasons': [str(error)], 'lines': [
                {'lineId': i, 'text': t, 'start': None, 'end': None, 'status': 'unmatched'}
                for i, t in enumerate(lines)]}
    if not ids:
        return {'status': 'unmatched', 'reasons': ['no-supported-lyrics'], 'lines': metadata}
    spans, path_score = ctc_viterbi(logp, ids)
    result = []
    for item in metadata:
        if 'firstToken' not in item:
            result.append(item); continue
        active = spans[item['firstToken']:item['firstToken'] + item['tokenCount']]
        start = (active[0]['startFrame'] * STRIDE + (RECEPTIVE - 1) / 2) / RATE
        end = min(duration, (active[-1]['endFrame'] * STRIDE + (RECEPTIVE - 1) / 2) / RATE)
        support = float(np.mean([s['greedySupport'] for s in active]))
        geometric = float(np.exp(np.mean([s['logProbability'] for s in active])))
        reasons = ['unvalidated-singing-model']
        if item['readingFallback']: reasons.append('automatic-reading-fallback')
        if support < 0.5: reasons.append('weak-acoustic-support')
        if geometric < 0.05: reasons.append('low-path-probability')
        if end - start < 0.12: reasons.append('collapsed-line')
        if end - start > 20: reasons.append('overlong-line')
        result.append({'lineId': item['lineId'], 'text': item['text'], 'start': start, 'end': end,
                       'status': 'review', 'reasons': reasons,
                       'evidence': {'greedySupport': support, 'geometricTokenProbability': geometric},
                       'tokens': [{**s, 'piece': p} for s, p in zip(active, item['pieces'])]})
    return {'status': 'review', 'pathLogProbability': path_score, 'lines': result}


def main():
    parser = argparse.ArgumentParser(description='Local independent lyric aligner; review output before applying.')
    parser.add_argument('--audio', type=Path, required=True)
    parser.add_argument('--lyrics', type=Path, required=True)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache', type=Path)
    parser.add_argument('--pronunciation-lattice', action='store_true')
    parser.add_argument('--acoustic-model',choices=['base','large'],default='base')
    parser.add_argument('--blank-penalty',type=float,default=0,
                        help='Experimental timing calibration, [-3,0]. Never a confidence probability.')
    args = parser.parse_args()
    if not -3<=args.blank_penalty<=0:raise ValueError('invalid-blank-penalty')
    started = time.monotonic()
    samples = load_audio(args.audio)
    if len(samples)<RECEPTIVE or not np.any(samples):raise ValueError('silent-or-too-short-input-reject')
    text = args.lyrics.read_text(encoding='utf-8-sig')
    model_hash=MODEL_SHA256 if args.acoustic_model=='base' else LARGE_SHA256
    model_path=args.assets/'base.onnx' if args.acoustic_model=='base' else args.assets/'large/model.int8.onnx'
    vocab_path=args.assets/'vocab.json' if args.acoustic_model=='base' else args.assets/'large/vocab.json'
    if sha256(vocab_path)!=VOCAB_SHA256:raise ValueError('vocabulary-hash-mismatch')
    pcm_hash=hashlib.sha256(samples.astype('<f4').tobytes()).hexdigest()
    cache_id = hashlib.sha256((sha256(args.audio) + model_hash + pcm_hash + 'chunks800-context2s-v1').encode()).hexdigest()
    cache_path = args.cache / (cache_id + '.npy') if args.cache else None
    cached = cache_path is not None and cache_path.exists()
    if cached:
        logp = np.load(cache_path, allow_pickle=False)
    else:
        model = AcousticModel(model_path,expected_hash=model_hash)
        logp = model.emissions(samples, progress=lambda p: print(f'acoustic {p:.0%}', flush=True))
        if cache_path:
            cache_path.parent.mkdir(parents=True, exist_ok=True); np.save(cache_path, logp)
    if logp.shape!=((len(samples)-RECEPTIVE)//STRIDE+1,3003):raise ValueError('cached-emission-length-mismatch')
    if args.blank_penalty:
        logp=logp.copy();logp[:,0]+=args.blank_penalty
    tokenizer = Tokenizer(json.loads(vocab_path.read_text()))
    if args.pronunciation_lattice:
        from lattice import align_pronunciations
        result = align_pronunciations(logp, text.splitlines(), tokenizer, len(samples) / RATE)
    else:
        result = align_lines(logp, text.splitlines(), tokenizer, len(samples) / RATE)
    result.update({'version': 1, 'engine': 'vs-independent-phonetic-v1' if args.pronunciation_lattice else 'vs-independent-ctc-v1', 'modelSha256': model_hash,
                   'acousticModel':args.acoustic_model,'pcmSha256':pcm_hash,
                   'blankPenalty':args.blank_penalty,
                   'audioSha256': sha256(args.audio), 'lyricsSha256': sha256(args.lyrics),
                   'duration': len(samples) / RATE, 'elapsedSeconds': time.monotonic() - started,
                   'acousticCacheUsed': cached, 'displayLeadSeconds': 0,
                   'frameStrideSeconds': STRIDE / RATE, 'frameOriginSeconds': (RECEPTIVE - 1) / 2 / RATE})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'status': result['status'], 'lines': len(result['lines']),
                      'seconds': result['elapsedSeconds']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
