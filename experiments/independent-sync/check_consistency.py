"""Metamorphic acoustic checks; consistency is not timestamp ground truth."""
import argparse
import json
from pathlib import Path
import numpy as np
from engine import AcousticModel, Tokenizer, align_lines, load_audio, sha256, RATE, VOCAB_SHA256


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['audio','lyrics','coarse','assets','output']:p.add_argument('--'+key,type=Path,required=True)
    a=p.parse_args();samples=load_audio(a.audio);lines=a.lyrics.read_text(encoding='utf-8-sig').splitlines()
    coarse=json.loads(a.coarse.read_text())
    if coarse['audioSha256']!=sha256(a.audio) or coarse['lyricsSha256']!=sha256(a.lyrics):raise ValueError('coarse-input-hash-mismatch')
    first=0;last=1
    while last<len(lines) and coarse['lines'][last]['end']-coarse['lines'][first]['start']<14:last+=1
    lo=max(0,int((coarse['lines'][first]['start']-2)*RATE)//320*320)
    hi=min(len(samples),int((coarse['lines'][last-1]['end']+2)*RATE))
    wave=samples[lo:hi];text=lines[first:last]
    if sha256(a.assets/'vocab.json')!=VOCAB_SHA256:raise ValueError('vocabulary-hash-mismatch')
    model=AcousticModel(a.assets/'base.onnx');tok=Tokenizer(json.loads((a.assets/'vocab.json').read_text()))
    try:model.emissions(np.zeros(RATE,np.float32))
    except ValueError as error:silence=str(error)=='silent-input-reject'
    else:silence=False
    def run(w):return align_lines(model.emissions(w),text,tok,len(w)/RATE)
    original=run(wave);gain=run(wave*.1);pad=1.28
    shifted=run(np.pad(wave,(int(pad*RATE),0)))
    def compare(result,offset):
        errors=[(r['start']-b['start']-offset)*1000 for r,b in zip(result['lines'],original['lines']) if r.get('start') is not None and b.get('start') is not None]
        return {'matched':len(errors),'medianAbsoluteMs':float(np.median(np.abs(errors))),
                'maxAbsoluteMs':float(np.max(np.abs(errors))),'signedErrorsMs':errors}
    result={'kind':'metamorphic-consistency-not-absolute-accuracy','audioSha256':sha256(a.audio),
            'lyricsSha256':sha256(a.lyrics),'firstLine':first,'endLineExclusive':last,
            'cropStart':lo/RATE,'cropEnd':hi/RATE,'silenceRejected':silence,
            'gain0.1':compare(gain,0),'leadingSilence1.28s':compare(shifted,pad)}
    a.output.write_text(json.dumps(result,indent=2));print(json.dumps(result))


if __name__=='__main__':main()
