"""Score a generated result only AFTER inference; references never enter engine.py.

Reference schema: {audioSha256, lyricsSha256, kind, lines:[{lineId,start,text?}]}.
All referenced rows remain in the denominator, including unmatched predictions.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from engine import normalized


def evaluate(predicted, reference):
    if predicted['audioSha256'] != reference['audioSha256']:
        raise ValueError('reference-audio-mismatch')
    if predicted['lyricsSha256'] != reference['lyricsSha256']:
        raise ValueError('reference-lyrics-mismatch')
    ids = [x['lineId'] for x in reference['lines']]
    if len(ids) != len(set(ids)): raise ValueError('duplicate-reference-lines')
    prediction_ids=[r['lineId'] for r in predicted['lines']]
    if len(prediction_ids)!=len(set(prediction_ids)):raise ValueError('duplicate-predicted-lines')
    predictions = {r['lineId']: r for r in predicted['lines']}
    errors, rows = [], []
    for ref in reference['lines']:
        start = ref['start']
        if not isinstance(start, (int,float)) or not np.isfinite(start) or not 0 <= start <= predicted['duration']:
            raise ValueError('invalid-reference-time')
        item = predictions.get(ref['lineId'])
        error = None
        if item and item.get('start') is not None:
            if 'text' in ref and normalized(ref['text']) != normalized(item['text']):
                raise ValueError('reference-text-mismatch')
            if np.isfinite(item['start']) and 0 <= item['start'] <= predicted['duration']:
                error = item['start'] - start; errors.append(error)
        rows.append({'lineId':ref['lineId'],'errorMs':error*1000 if error is not None else None})
    absolute=np.abs(errors)
    total=len(ids)
    return {'referenceKind':reference['kind'],'referenceCount':total,'matchedCount':len(errors),
            'missingCount':total-len(errors),
            'within100ms':sum(abs(x)<=.100000001 for x in errors),
            'within300ms':sum(abs(x)<=.300000001 for x in errors),
            'within500ms':sum(abs(x)<=.500000001 for x in errors),
            'within100msFractionOfAll':sum(abs(x)<=.100000001 for x in errors)/total if total else None,
            'medianAbsoluteMs':float(np.median(absolute)*1000) if errors else None,
            'p95AbsoluteMs':float(np.quantile(absolute,.95)*1000) if errors else None,
            'signedMedianMs':float(np.median(errors)*1000) if errors else None,
            'rows':rows}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('prediction',type=Path);p.add_argument('reference',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();r=evaluate(json.loads(a.prediction.read_text()),json.loads(a.reference.read_text()))
    a.output.write_text(json.dumps(r,indent=2));print(json.dumps({k:v for k,v in r.items() if k!='rows'}))
