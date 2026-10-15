"""Research comparison only: TIFA v1.0.0 CC BY-NC-SA-4.0 weights.

Upstream source is loaded unchanged at a pinned revision. This is not our trained
model or a commercial-distribution approval. No human reference times are inputs.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import numpy as np
from engine import load_audio, sha256, RATE
from qwen_engine import map_units

SOURCE_REVISION = '32a0a13aebce580844ad1dc281ea11ef1be94f14'


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['audio','lyrics','model','source','coarse','output']:
        p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--research-nc-model',action='store_true',required=True,
                   help='Explicitly select restricted-license research comparison; not app default.')
    a=p.parse_args();started=time.monotonic()
    if sha256(a.model)!='8d9bf896da1827f36bf135f80c7ab1fc4f3c1d48f328818b8402c9527c0f014b':raise ValueError('tifa-model-hash-mismatch')
    revision=subprocess.check_output(['git','-C',str(a.source),'rev-parse','HEAD'],text=True).strip()
    if revision!=SOURCE_REVISION:raise ValueError('tifa-source-revision-mismatch')
    sys.path.insert(0,str(a.source.resolve()))
    import torch
    import soundfile as sf
    import unidic_lite
    from scipy.signal import resample_poly
    from inference.api import load_inference_model
    from inference.data import AudioTextDataset
    from lib.config.schema import ConfigurationScope
    from lib.path_traversal import materialize_paths
    torch.set_num_threads(2)
    samples=load_audio(a.audio)
    if not np.any(samples):raise ValueError('silent-input')
    duration=len(samples)/RATE
    lines=a.lyrics.read_text(encoding='utf-8-sig').splitlines()
    coarse=json.loads(a.coarse.read_text())
    if coarse['audioSha256']!=sha256(a.audio) or coarse['lyricsSha256']!=sha256(a.lyrics):
        raise ValueError('coarse-input-hash-mismatch')
    if len(coarse['lines'])!=len(lines) or any(x['text']!=line or x['start'] is None for x,line in zip(coarse['lines'],lines)):
        raise ValueError('coarse-lines-invalid')
    backend,vocabulary,config=load_inference_model(a.model,scope=ConfigurationScope.FA)
    for converter in config.g2p.converters:
        if converter.id=='japanese-mecab':converter.kwargs['unidic_dir']=unidic_lite.DICDIR
    groups=[];first=0
    while first<len(lines):
        last=first+1
        while last<len(lines) and coarse['lines'][last]['end']-coarse['lines'][first]['start']<=24:
            last+=1
        begin=max(0,coarse['lines'][first]['start']-3)
        finish=min(duration,coarse['lines'][last-1]['end']+3)
        if not 0<=begin<finish<=duration or finish-begin>60:raise ValueError('invalid-window')
        groups.append((first,last,begin,finish));first=last
    rows=[];windows=[]
    with tempfile.TemporaryDirectory(prefix='vs-tifa-') as folder,torch.inference_mode():
        folder=Path(folder)
        files={}
        for i,(first,last,begin,finish) in enumerate(groups):
            path=folder/f'{i:04d}.wav';lo=int(begin*RATE);hi=int(finish*RATE)
            sf.write(path,resample_poly(samples[lo:hi],3,1),48000,subtype='FLOAT')
            path.with_suffix('.txt').write_text('\n'.join(lines[first:last]),encoding='utf-8')
            files[f'{i:04d}']=path
        dataset=AudioTextDataset(files,config.g2p,a.model.parent,vocabulary,48000,language=['ja','en'],oov_handling='raise')
        for i,(first,last,begin,finish) in enumerate(groups):
            sample=dataset[i]
            if sample['skip']:raise ValueError(sample.get('warning') or sample.get('error'))
            batch=dataset.collate([sample])
            spec=backend.spectrogram(batch['waveform'],batch['duration'])
            scored=backend.score(spec,paths=batch['paths'],words=batch['words'],candidates=batch['candidates'],unit='levenshtein')
            tokens,words,pgroups=materialize_paths(batch['paths'],batch['words'],batch['groups'],scored.choices)
            aligned=backend.align(spec,tokens=tokens,groups=pgroups,unit='frame',skip_penalty=.5)
            count=int((tokens[0]!=0).sum());spans=aligned.spans[0,:count].tolist();word_ids=words[0,:count].tolist()
            local=[]
            for w,text in enumerate(batch['texts'][0],1):
                active=[span for span,ident in zip(spans,word_ids) if ident==w]
                if not active:raise ValueError('tifa-skipped-text')
                # Do not invent 1-ms durations for skipped/collapsed phones.
                local.append({'text':text,'start':active[0][0]*.01,'end':active[-1][1]*.01})
            origin=int(begin*RATE)/RATE;local_duration=float(batch['duration'][0])
            try: mapped=map_units(lines[first:last],local,local_duration)
            except ValueError as error:
                mapped=[{'lineId':j,'text':line,'start':None,'end':None,'status':'unmatched','reasons':[str(error)]} for j,line in enumerate(lines[first:last])]
            for row in mapped:
                row['lineId']+=first
                row['reasons'].append('noncommercial-research-model')
                if row['start'] is not None:
                    row['start']+=origin;row['end']+=origin
                    if abs(row['start']-coarse['lines'][row['lineId']]['start'])>.5:row['reasons'].append('acoustic-model-disagreement')
                rows.append(row)
            windows.append({'firstLine':first,'endLineExclusive':last,'start':origin,'end':finish,
                            'agreement':float(aligned.agreement[0]),'rawUnits':local})
            print(f'TIFA research window {i+1}/{len(groups)}',flush=True)
    result={'version':1,'engine':'vs-independent-tifa-research-v1','model':'TIFA-1.0-ST','sourceRevision':revision,
            'modelSha256':sha256(a.model),'modelLicense':'CC-BY-NC-SA-4.0','dictionary':'unidic-lite-1.0.8',
            'audioSha256':sha256(a.audio),'lyricsSha256':sha256(a.lyrics),'coarseSourceSha256':sha256(a.coarse),
            'duration':duration,'displayLeadSeconds':0,'status':'review','lines':rows,'windows':windows,
            'elapsedSeconds':time.monotonic()-started}
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'elapsedSeconds':result['elapsedSeconds'],'lines':len(rows)}),flush=True)


if __name__=='__main__':main()
