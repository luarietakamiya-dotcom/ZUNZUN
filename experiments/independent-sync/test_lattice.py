import itertools
import unittest
import numpy as np
from lattice import lattice_viterbi, pronunciation_graph
from test_engine import collapse
from engine import Tokenizer


class LatticeTests(unittest.TestCase):
    def test_alternative_spelling_exact_against_exhaustive_paths(self):
        rng=np.random.default_rng(42)
        # Two homophones for first position; either two small tokens or one long piece.
        edges=[(0,1,1,'a'),(0,1,2,'A'),(1,2,2,'b'),(0,2,3,'ab')]
        targets=[[1,2],[2,2],[3]]
        for frames in [3,4,5]:
            logits=rng.normal(size=(frames,4)).astype(np.float32)
            lp=logits-np.log(np.exp(logits).sum(1,keepdims=True))
            valid=[sum(lp[t,x] for t,x in enumerate(path))
                   for path in itertools.product(range(4),repeat=frames) if collapse(path) in targets]
            spans,score=lattice_viterbi(lp,edges,3)
            self.assertAlmostEqual(score,max(valid),places=5)
            self.assertEqual(spans[0]['from'],0);self.assertEqual(spans[-1]['to'],2)

    def test_phonetic_graph_never_crosses_line_boundary(self):
        t=Tokenizer({'<unk>':0,'あ':1,'い':2,'あい':3})
        e,_,_=pronunciation_graph(['あ','い'],t)
        self.assertNotIn((0,2,3,'あい'),e)
        e,_,_=pronunciation_graph(['あい'],t)
        self.assertIn((0,2,3,'あい'),e)

    def test_impossible_path_and_budget(self):
        with self.assertRaises(ValueError):lattice_viterbi(np.zeros((1,3)),[(0,1,1,'a'),(1,2,1,'a')],3)
        with self.assertRaisesRegex(ValueError,'memory-budget'):
            lattice_viterbi(np.zeros((10,3)),[(0,1,1,'a')],2,max_cells=1)


if __name__=='__main__':unittest.main()
