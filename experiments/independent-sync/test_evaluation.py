import copy
import unittest
from evaluate import evaluate
from qwen_engine import map_units


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.p={'audioSha256':'a','lyricsSha256':'l','duration':10,'lines':[
            {'lineId':0,'text':'光','start':1.1}, {'lineId':1,'text':'光','start':None}]}
        self.r={'audioSha256':'a','lyricsSha256':'l','kind':'test-only','lines':[
            {'lineId':0,'text':'光','start':1}, {'lineId':1,'text':'光','start':4}]}

    def test_unmatched_kept_in_denominator(self):
        r=evaluate(self.p,self.r)
        self.assertEqual(r['referenceCount'],2);self.assertEqual(r['missingCount'],1)
        self.assertEqual(r['within100msFractionOfAll'],.5)

    def test_wrong_audio_lyrics_text_and_duplicate_refs_rejected(self):
        for key in ['audioSha256','lyricsSha256']:
            r=copy.deepcopy(self.r);r[key]='wrong'
            with self.assertRaises(ValueError):evaluate(self.p,r)
        r=copy.deepcopy(self.r);r['lines'][0]['text']='違う'
        with self.assertRaises(ValueError):evaluate(self.p,r)
        r=copy.deepcopy(self.r);r['lines'][1]['lineId']=0
        with self.assertRaises(ValueError):evaluate(self.p,r)

    def test_repeated_text_uses_occurrence_order(self):
        rows=map_units(['光','光'],[{'text':'光','start':1,'end':2},
                                  {'text':'光','start':4,'end':5}],10)
        self.assertEqual([x['start'] for x in rows],[1,4])

    def test_bad_unit_only_abstains_affected_line(self):
        rows=map_units(['光','光'],[{'text':'光','start':0,'end':0},
                                  {'text':'光','start':4,'end':5}],10)
        self.assertIsNone(rows[0]['start']);self.assertEqual(rows[1]['start'],4)
        rows=map_units(['光'],[{'text':'光','start':float('nan'),'end':5}],10)
        self.assertIsNone(rows[0]['start'])

    def test_word_crossing_line_and_mismatch(self):
        rows=map_units(['光','る'],[{'text':'光る','start':1,'end':2}],10)
        self.assertIn('model-unit-crosses-line-boundary',rows[0]['reasons'])
        with self.assertRaises(ValueError):map_units(['光'],[{'text':'闇','start':1,'end':2}],10)


if __name__=='__main__':unittest.main()
