import copy
from pathlib import Path
import tempfile
import unittest
import zipfile
from combine import combine
from evaluate import evaluate
from prepare_assets import safe_extract


class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.a={'engine':'vs-independent-ctc-v1','modelSha256':'base','audioSha256':'a','lyricsSha256':'l','duration':10,
                'lines':[{'lineId':0,'text':'光','start':1,'end':2}]}
        self.b=copy.deepcopy(self.a);self.b['modelSha256']='large';self.b['lines'][0].update(start=2,end=3)

    def test_consensus_retains_disagreement_and_never_auto_accepts(self):
        r=combine([self.a,self.b]);self.assertEqual(r['lines'][0]['start'],1.5)
        self.assertEqual(r['status'],'review');self.assertIn('acoustic-model-disagreement',r['lines'][0]['reasons'])

    def test_consensus_rejects_same_model_wrong_input_and_restricted_route(self):
        for mutate in [lambda x:x.update(modelSha256='base'),lambda x:x.update(audioSha256='wrong'),
                       lambda x:x.update(engine='vs-independent-tifa-research-v1'),
                       lambda x:x['lines'][0].update(text='闇')]:
            b=copy.deepcopy(self.b);mutate(b)
            with self.assertRaises(ValueError):combine([self.a,b])

    def test_consensus_abstains_when_model_missing_or_nan(self):
        for value in [None,float('nan')]:
            b=copy.deepcopy(self.b);b['lines'][0]['start']=value
            self.assertIsNone(combine([self.a,b])['lines'][0]['start'])

    def test_duplicate_prediction_ids_do_not_overwrite(self):
        a=copy.deepcopy(self.a);a['lines']*=2
        reference={'audioSha256':'a','lyricsSha256':'l','kind':'test','lines':[{'lineId':0,'start':1}]}
        with self.assertRaisesRegex(ValueError,'duplicate-predicted'):evaluate(a,reference)

    def test_zip_traversal_rejected_before_extracting_any_member(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);archive=root/'test.zip'
            with zipfile.ZipFile(archive,'w') as z:
                z.writestr('valid.txt','a');z.writestr('../escape.txt','b')
            with self.assertRaisesRegex(ValueError,'unsafe'):safe_extract(archive,root/'extract')
            self.assertFalse((root/'extract/valid.txt').exists())


if __name__=='__main__':unittest.main()
