"""Reference-free consensus proposals with explicit disagreement; no auto-apply.

Only the Apache-weight base/large/Romaji research routes are combined by default.
Agreement is not calibrated confidence and all lines still require review.
"""
import argparse
import json
import math
from pathlib import Path
import numpy as np
from engine import sha256

ALLOWED={'vs-independent-phonetic-v1','vs-independent-ctc-v1','vs-independent-singing-phoneme-v1'}


def combine(results):
    if len(results)<2:raise ValueError('at-least-two-independent-models-required')
    first=results[0]
    hashes=[r.get('modelSha256') for r in results]
    if None in hashes or len(hashes)!=len(set(hashes)):raise ValueError('duplicate-or-unknown-acoustic-model')
    for r in results:
        if r.get('engine') not in ALLOWED:raise ValueError('unapproved-consensus-engine')
        for key in ['audioSha256','lyricsSha256','duration']:
            if r[key]!=first[key]:raise ValueError('consensus-input-mismatch')
        if len(r['lines'])!=len(first['lines']):raise ValueError('consensus-line-count-mismatch')
    rows=[];previous=-1
    for i,base in enumerate(first['lines']):
        sources=[r['lines'][i] for r in results]
        if any((r['lineId'],r['text'])!=(base['lineId'],base['text']) for r in sources):raise ValueError('consensus-line-identity-mismatch')
        valid=[r for r in sources if all(isinstance(r.get(k),(int,float)) and math.isfinite(r[k]) for k in ['start','end']) and 0<=r['start']<r['end']<=first['duration']]
        if len(valid)<2:
            rows.append({'lineId':base['lineId'],'text':base['text'],'start':None,'end':None,'status':'unmatched','reasons':['insufficient-model-evidence']});continue
        start=float(np.median([r['start'] for r in valid]));end=float(np.median([r['end'] for r in valid]))
        low=min(r['start'] for r in valid);high=max(r['start'] for r in valid)
        reasons=['unvalidated-consensus','agreement-is-not-correctness']
        if len(valid)!=len(sources):reasons.append('missing-model-evidence')
        if high-low>.3:reasons.append('acoustic-model-disagreement')
        if start<previous:reasons.append('nonmonotonic-consensus')
        if any('collapsed-line' in r.get('reasons',[]) for r in valid):reasons.append('source-collapsed-line')
        rows.append({'lineId':base['lineId'],'text':base['text'],'start':start,'end':end,'status':'review','reasons':reasons,
                     'candidateRange':{'earliest':low,'latest':high},
                     'sourceTimes':[{'engine':m['engine'],'start':r.get('start'),'end':r.get('end')} for m,r in zip(results,sources)]})
        previous=start
    return {'version':1,'engine':'vs-independent-consensus-v1','status':'review','audioSha256':first['audioSha256'],
            'lyricsSha256':first['lyricsSha256'],'duration':first['duration'],'displayLeadSeconds':0,'lines':rows,
            'sourceModels':hashes}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('inputs',nargs='+',type=Path);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();result=combine([json.loads(path.read_text()) for path in a.inputs]);result['sourceResultHashes']=[sha256(path) for path in a.inputs]
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
