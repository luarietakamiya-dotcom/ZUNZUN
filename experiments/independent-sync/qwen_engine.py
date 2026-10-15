"""Independent second acoustic route: official Qwen forced aligner, local CPU.

No human reference timestamps are accepted as inputs. Optional independent CTC
coarse predictions define windows. Original lyrics are mapped in occurrence order.
"""
import argparse
import json
import math
from pathlib import Path
import resource
import time

import numpy as np

from engine import load_audio, normalized, sha256, RATE

QWEN_REVISION = 'c7cbfc2048c462b0d63a45797104fc9db3ad62b7'
QWEN_SHA256 = '47831d0e82f96b20e9034dba01a075ee06436654719f6a68289e49f1b65ce0e7'


def map_units(lines, units, duration):
    """Preserve ordered occurrences; never search each repeated line independently."""
    desired = ''.join(normalized(line) for line in lines)
    actual = ''.join(normalized(unit['text']) for unit in units)
    if not desired or desired != actual:
        raise ValueError('alignment-text-span-mismatch')
    offsets, cursor = [], 0
    for unit in units:
        text = normalized(unit['text'])
        if not text: continue
        start, end = unit['start'], unit['end']
        valid = all(isinstance(t,(int,float)) and math.isfinite(t) for t in (start,end)) and 0 <= start <= end <= duration
        unit = {**unit, '_valid': valid}
        offsets.append((cursor,cursor+len(text),unit));cursor+=len(text)
    result, cursor, previous_start = [], 0, -1
    for i,line in enumerate(lines):
        length = len(normalized(line))
        active = [(a,b,u) for a,b,u in offsets if a < cursor+length and b > cursor]
        if not length or not active:
            result.append({'lineId':i,'text':line,'status':'unmatched','start':None,'end':None,
                           'reasons':['empty-or-unmatched-line']});continue
        start, end = active[0][2]['start'],active[-1][2]['end']
        reasons=['unvalidated-singing-model']
        if not all(u['_valid'] for _,_,u in active) or not 0 <= start < end <= duration:
            result.append({'lineId':i,'text':line,'start':None,'end':None,'status':'unmatched',
                           'reasons':['invalid-or-collapsed-model-timestamp']})
            cursor+=length;continue
        if any(u['start']==u['end'] for _,_,u in active): reasons.append('zero-duration-model-unit')
        if start < previous_start: reasons.append('nonmonotonic-line')
        if active[0][0] < cursor or active[-1][1] > cursor+length:
            reasons.append('model-unit-crosses-line-boundary')
        if end-start < .12: reasons.append('collapsed-line')
        if end-start > 20: reasons.append('overlong-line')
        if any(active[j][2]['start'] < active[j-1][2]['start'] for j in range(1,len(active))):
            reasons.append('nonmonotonic-unit')
        result.append({'lineId':i,'text':line,'start':start,'end':end,'status':'review',
                       'reasons':reasons,'units':[x[2] for x in active]})
        previous_start=start;cursor+=length
    return result


def main():
    p=argparse.ArgumentParser(description='Offline Qwen known-lyric alignment. Review required.')
    p.add_argument('--audio',type=Path,required=True);p.add_argument('--lyrics',type=Path,required=True)
    p.add_argument('--model',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--threads',type=int,default=2)
    p.add_argument('--coarse',type=Path,help='Optional independent CTC result; never pass reference times.')
    p.add_argument('--window-seconds',type=float,default=18)
    a=p.parse_args();start=time.monotonic()
    samples=load_audio(a.audio);duration=len(samples)/RATE
    if not np.any(samples):raise ValueError('silent-input-reject')
    if duration>300 and not a.coarse:raise ValueError('requires-hierarchical-long-audio-alignment')
    if sha256(a.model/'model.safetensors')!=QWEN_SHA256:raise ValueError('model-hash-mismatch')
    import torch
    from qwen_asr import Qwen3ForcedAligner
    torch.set_num_threads(a.threads)
    model=Qwen3ForcedAligner.from_pretrained(str(a.model),dtype=torch.bfloat16,
         device_map='cpu',attn_implementation='sdpa',local_files_only=True)
    lines=a.lyrics.read_text(encoding='utf-8-sig').splitlines()
    transcript='\n'.join(lines)
    loaded=time.monotonic();print('local model ready',flush=True)
    if a.coarse:
        coarse=json.loads(a.coarse.read_text())
        if coarse['audioSha256']!=sha256(a.audio) or coarse['lyricsSha256']!=sha256(a.lyrics):
            raise ValueError('coarse-input-hash-mismatch')
        if len(coarse['lines'])!=len(lines) or any(x['text']!=line for x,line in zip(coarse['lines'],lines)):
            raise ValueError('coarse-text-mismatch')
        groups=[];first=0
        while first<len(lines):
            last=first+1
            while last<len(lines) and coarse['lines'][last]['end']-coarse['lines'][first]['start']<=a.window_seconds:
                last+=1
            begin=max(0,coarse['lines'][first]['start']-3)
            finish=min(duration,coarse['lines'][last-1]['end']+3)
            groups.append((first,last,begin,finish));first=last
    else:groups=[(0,len(lines),0,duration)]
    units=[];mapped=[];windows=[]
    for number,(first,last,begin,finish) in enumerate(groups):
        lo=int(begin*RATE);hi=int(finish*RATE);origin=lo/RATE
        wave=samples[lo:hi];local_duration=len(wave)/RATE
        out=model.align(audio=(wave,RATE),text='\n'.join(lines[first:last]),language='Japanese')[0]
        local=[{'text':x.text,'start':x.start_time,'end':x.end_time} for x in out]
        try:
            local_lines=map_units(lines[first:last],local,local_duration)
        except ValueError as error:
            local_lines=[{'lineId':i,'text':line,'start':None,'end':None,'status':'unmatched','reasons':[str(error)]}
                         for i,line in enumerate(lines[first:last])]
        for row in local_lines:
            row['lineId']+=first
            if row.get('start') is not None:
                if row['start']<.16 or local_duration-row['end']<.16:row['reasons'].append('window-edge')
                row['start']+=origin;row['end']+=origin
                if a.coarse and abs(row['start']-coarse['lines'][row['lineId']]['start'])>.5:
                    row['reasons'].append('acoustic-model-disagreement')
            mapped.append(row)
        units.extend([{**u,'start':u['start']+origin,'end':u['end']+origin} for u in local])
        windows.append({'firstLine':first,'endLineExclusive':last,'start':origin,'end':hi/RATE})
        print(f'aligned window {number+1}/{len(groups)}',flush=True)
    inferred=time.monotonic()
    result={'version':1,'engine':'vs-independent-qwen-v1','model':'Qwen/Qwen3-ForcedAligner-0.6B',
        'modelRevision':QWEN_REVISION,'modelSha256':QWEN_SHA256,'duration':duration,
        'audioSha256':sha256(a.audio),'lyricsSha256':sha256(a.lyrics),'displayLeadSeconds':0,
        'loadSeconds':loaded-start,'inferenceSeconds':inferred-loaded,
        'processPeakRssBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024,
        'scope':'Linux CPU bfloat16; not browser or smartphone performance',
        'rawUnits':units,'status':'review','lines':mapped,'windows':windows,
        'coarseSourceSha256':sha256(a.coarse) if a.coarse else None}
    previous=-1
    for row in mapped:
        if row.get('start') is not None:
            if row['start']<previous:row['reasons'].append('nonmonotonic-window-boundary')
            previous=row['start']
    result['elapsedSeconds']=time.monotonic()-start
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:result[k] for k in ['status','inferenceSeconds','elapsedSeconds','processPeakRssBytes']}),flush=True)


if __name__=='__main__':main()
