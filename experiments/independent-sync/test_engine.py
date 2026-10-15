import itertools
import math
import unittest
import numpy as np
from engine import ctc_viterbi, Tokenizer, normalized


def collapse(path):
    return [x for i, x in enumerate(path) if x and (i == 0 or x != path[i-1])]


class AlignmentTests(unittest.TestCase):
    def test_exact_against_exhaustive_small_paths(self):
        rng = np.random.default_rng(20261015)
        for frames in [3, 4, 5]:
            for target in [[1], [1, 2], [1, 1], [2, 1, 2]]:
                logits = rng.normal(size=(frames, 3)).astype(np.float32)
                logp = logits - np.log(np.exp(logits).sum(1, keepdims=True))
                legal = [sum(logp[t, token] for t, token in enumerate(path))
                         for path in itertools.product(range(3), repeat=frames)
                         if collapse(path) == target]
                spans, score = ctc_viterbi(logp, target)
                self.assertAlmostEqual(score, max(legal), places=5)
                self.assertEqual(len(spans), len(target))

    def test_repeated_tokens_need_blank(self):
        with self.assertRaisesRegex(ValueError, 'impossible'):
            ctc_viterbi(np.zeros((2, 3)), [1, 1])
        spans, _ = ctc_viterbi(np.log(np.array([[.01,.98,.01],[.98,.01,.01],[.01,.98,.01]])), [1,1])
        self.assertEqual([x['startFrame'] for x in spans], [0,2])

    def test_nonfinite_blank_and_memory_budget_rejected(self):
        for data, tokens in [(np.array([[np.nan, 1]]), [1]), (np.zeros((3,2)), [0]),
                             (np.zeros((3,2)), [2]), (np.zeros((3,2)), [])]:
            with self.assertRaises(ValueError): ctc_viterbi(data, tokens)
        with self.assertRaisesRegex(ValueError, 'memory-budget'):
            ctc_viterbi(np.zeros((10,2)), [1], max_cells=2)

    def test_padding_and_token_order(self):
        p = np.full((20,3), .01); p[:,0]=.98
        p[6:9]=[.01,.98,.01]; p[13:16]=[.01,.01,.98]
        spans,_=ctc_viterbi(np.log(p),[1,2])
        self.assertEqual([(s['startFrame'],s['endFrame']) for s in spans],[(6,9),(13,16)])

    def test_unicode_and_unknown_not_silently_removed(self):
        tok=Tokenizer({'<unk>':0,'あ':1,'い':2,'あい':3})
        self.assertEqual(tok.encode('あい！')[0],[3])
        self.assertEqual(normalized('ＡＢＣ　１２３!'),'abc123')
        with self.assertRaisesRegex(ValueError,'unsupported'):
            tok.encode('𠮷')


if __name__ == '__main__': unittest.main()
