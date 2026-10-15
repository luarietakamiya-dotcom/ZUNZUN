"""Singing-trained phoneme acoustic model + our known-lyric pronunciation DAG.

Upstream releases greedy-ASR IDs, not an aligner. We expose its unchanged
pre-ArgMax logits in a local derivative and verify the original argmax result.
"""
import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path
import time

import numpy as np

from engine import load_audio, sha256, RATE, STRIDE, RECEPTIVE
from lattice import lattice_viterbi

VOCAB_SHA='4e96b35f058685aa1ac63b1c9e1cc386fa75d85ede5d55997fbbac6e7ec932bb'
SOURCE_SHA='7006ab5216c7ac0c68446c0c062e7e21358f942d7e6acb67ddaef132ef1d9d7f'


def expose_logits(source,destination):
    import onnx
    if sha256(source)!=SOURCE_SHA:raise ValueError('romaji-source-hash-mismatch')
    model=onnx.load(str(source))
    if model.graph.node[-1].op_type!='ArgMax':raise ValueError('unexpected-romaji-export')
    name=model.graph.node[-1].input[0]
    del model.graph.output[:]
    model.graph.output.append(onnx.helper.make_tensor_value_info(name,onnx.TensorProto.FLOAT16,['batch','frames',161]))
    onnx.checker.check_model(model)
    # Atomic replacement: concurrent runs never observe a partially written graph.
    with tempfile.NamedTemporaryFile(dir=destination.parent,suffix='.onnx',delete=False) as f:
        temporary=Path(f.name)
    try:
        onnx.save(model,str(temporary))
        os.replace(temporary,destination)
    finally:
        temporary.unlink(missing_ok=True)
    return sha256(destination)


def phone_graph(lines,vocab):
    import pyopenjtalk
    expansions=[]
    vowels=set('aiueo')
    for piece,ident in vocab.items():
        if ident<4:continue
        phones=[piece[:-1],piece[-1]] if len(piece)>1 and piece[-1] in vowels and piece!='cl' else [piece]
        expansions.append((phones,ident,piece))
    edges=[];bounds=[];offset=0
    for i,line in enumerate(lines):
        phones=pyopenjtalk.g2p(line).split()
        phones=[p.lower() if p in ['I','U'] else p for p in phones if p not in ['pau','sil']]
        if not phones:raise ValueError('empty-g2p-line')
        bounds.append((offset,offset+len(phones),i))
        for position in range(len(phones)):
            for expansion,ident,piece in expansions:
                if phones[position:position+len(expansion)]==expansion:
                    edges.append((offset+position,offset+position+len(expansion),ident,piece))
                    # Long vowels can be sustained rather than re-articulated.
                    length=len(expansion)
                    while expansion[-1] in vowels and position+length<len(phones) and phones[position+length]==expansion[-1]:
                        length+=1;edges.append((offset+position,offset+position+length,ident,piece))
        offset+=len(phones)
    reachable={0}
    for s,e,_,_ in sorted(edges):
        if s in reachable:reachable.add(e)
    if offset not in reachable:raise ValueError('unsupported-phoneme-path')
    return edges,bounds,offset+1


def infer(samples,source,derived):
    import onnxruntime as ort
    expose_logits(source,derived)
    options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1;options.log_severity_level=3
    original=ort.InferenceSession(str(source),sess_options=options,providers=['CPUExecutionProvider'])
    model=ort.InferenceSession(str(derived),sess_options=options,providers=['CPUExecutionProvider'])
    test=samples[:min(len(samples),RATE*2)][None].astype(np.float32)
    old=original.run(None,{'input_values':test})[0]
    new=model.run(None,{'input_values':test})[0]
    if not np.array_equal(old,np.argmax(new,axis=-1)):raise ValueError('romaji-logit-export-verification-failed')
    del original
    total=(len(samples)-RECEPTIVE)//STRIDE+1;blocks=[]
    for first in range(0,total,800):
        last=min(total,first+800)
        begin=max(0,first*STRIDE-RATE*2);finish=min(len(samples),last*STRIDE+RATE*2+RECEPTIVE)
        # Upstream release inference uses raw Float32 audio, without per-chunk normalization.
        out=model.run(None,{'input_values':samples[None,begin:finish].astype(np.float32)})[0][0]
        at=first-begin//STRIDE;logits=out[at:at+last-first].astype(np.float32)
        if logits.shape!=(last-first,161) or not np.isfinite(logits).all():raise ValueError('invalid-romaji-emissions')
        logits-=logits.max(1,keepdims=True);blocks.append(logits-np.log(np.exp(logits).sum(1,keepdims=True)))
        print(f'singing acoustic {last/total:.0%}',flush=True)
    return np.concatenate(blocks)


def main():
    p=argparse.ArgumentParser();p.add_argument('--audio',type=Path,required=True);p.add_argument('--lyrics',type=Path,required=True)
    p.add_argument('--assets',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--cache',type=Path,required=True)
    a=p.parse_args();started=time.monotonic();samples=load_audio(a.audio)
    if len(samples)<RECEPTIVE or not np.any(samples):raise ValueError('silent-or-short-input')
    lines=a.lyrics.read_text(encoding='utf-8-sig').splitlines()
    if sha256(a.assets/'phoneme_vocab.json')!=VOCAB_SHA:raise ValueError('romaji-vocabulary-hash-mismatch')
    pcm_hash=hashlib.sha256(samples.astype('<f4').tobytes()).hexdigest()
    key=hashlib.sha256((sha256(a.audio)+SOURCE_SHA+pcm_hash+'raw-chunks800-context2-v1').encode()).hexdigest()
    a.cache.mkdir(parents=True,exist_ok=True);cache=a.cache/(key+'.npy');cached=cache.exists()
    logp=np.load(cache,allow_pickle=False) if cached else infer(samples,a.assets/'model.onnx',a.assets/'logits.onnx')
    if logp.shape!=((len(samples)-RECEPTIVE)//STRIDE+1,161):raise ValueError('cached-romaji-length-mismatch')
    if not cached:np.save(cache,logp)
    vocabulary=json.loads((a.assets/'phoneme_vocab.json').read_text())
    edges,bounds,nodes=phone_graph(lines,vocabulary);tokens,score=lattice_viterbi(logp,edges,nodes)
    rows=[];duration=len(samples)/RATE
    for s,e,ident in bounds:
        active=[t for t in tokens if s<=t['from']<e]
        if not active:raise ValueError('unvisited-phoneme-line')
        onset=(active[0]['startFrame']*STRIDE+(RECEPTIVE-1)/2)/RATE
        end=min(duration,(active[-1]['endFrame']*STRIDE+(RECEPTIVE-1)/2)/RATE)
        support=float(np.mean([t['greedySupport'] for t in active]));probability=float(np.exp(np.mean([t['logProbability'] for t in active])))
        reasons=['unvalidated-independent-singing-aligner','automatic-g2p']
        if support<.5:reasons.append('weak-acoustic-support')
        if probability<.05:reasons.append('low-path-probability')
        if end-onset<.12:reasons.append('collapsed-line')
        if end-onset>20:reasons.append('overlong-line')
        rows.append({'lineId':ident,'text':lines[ident],'start':onset,'end':end,'status':'review','reasons':reasons,
                     'evidence':{'greedySupport':support,'geometricTokenProbability':probability},'tokens':active})
    result={'version':1,'engine':'vs-independent-singing-phoneme-v1','model':'Xiantaidu/RomajiASR v1.0.0',
            'modelSha256':SOURCE_SHA,'derivedModelSha256':sha256(a.assets/'logits.onnx'),
            'audioSha256':sha256(a.audio),'lyricsSha256':sha256(a.lyrics),'duration':duration,'status':'review',
            'displayLeadSeconds':0,'acousticCacheUsed':cached,'elapsedSeconds':time.monotonic()-started,
            'pathLogProbability':score,'lines':rows}
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps({'status':result['status'],'seconds':result['elapsedSeconds'],'lines':len(rows)}),flush=True)


if __name__=='__main__':main()
