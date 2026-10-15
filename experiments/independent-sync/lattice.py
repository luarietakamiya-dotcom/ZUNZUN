"""Exact CTC over a pronunciation DAG, instead of one pre-chosen spelling.

Homophonous acoustic wordpieces compete without rewriting the user's lyrics.
Edges may not cross line boundaries. No reference timestamps are inputs.
"""
import numpy as np
from engine import normalized, STRIDE, RECEPTIVE, RATE


def pronunciation_graph(lines, tokenizer):
    lexicon={}
    for piece, token in tokenizer.vocab.items():
        if token==0 or not normalized(piece) or piece.startswith('<'): continue
        try: reading=tokenizer.reading(piece.replace('▁',''))
        except ValueError: continue
        if reading:lexicon.setdefault(reading,[]).append((token,piece))
    by_first={}
    for reading,items in lexicon.items():by_first.setdefault(reading[0],[]).append((reading,items))
    edges=[];offset=0;bounds=[]
    for index,text in enumerate(lines):
        reading=tokenizer.reading(text)
        if not reading:raise ValueError('empty-reading')
        bounds.append((offset,offset+len(reading),index))
        for position in range(len(reading)):
            matches=[(key,items) for key,items in by_first.get(reading[position],[]) if reading.startswith(key,position)]
            for key,items in matches:
                for token,piece in items:edges.append((offset+position,offset+position+len(key),token,piece))
        offset+=len(reading)
    reachable={0}
    for start,end,_,_ in sorted(edges):
        if start in reachable:reachable.add(end)
    if offset not in reachable:raise ValueError('unsupported-pronunciation-path')
    return edges,bounds,offset+1


def lattice_viterbi(logp,edges,node_count,max_cells=100_000_000):
    frames,vocab=logp.shape
    if not len(edges) or not np.isfinite(logp).all():raise ValueError('invalid-lattice-emissions')
    start=np.array([x[0] for x in edges],dtype=np.int32)
    end=np.array([x[1] for x in edges],dtype=np.int32)
    token=np.array([x[2] for x in edges],dtype=np.int32)
    if np.any(token<=0) or np.any(token>=vocab) or np.any(start<0) or np.any(end>=node_count) or np.any(start>=end):
        raise ValueError('invalid-lattice-edges')
    n=len(edges);states=node_count+n
    if frames*states>max_cells:raise ValueError('lattice-memory-budget-exceeded')
    previous=np.full(states,-np.inf,dtype=np.float32);previous[0]=0
    back=np.full((frames,states),-1,dtype=np.int32)
    eid=np.arange(n,dtype=np.int32);nodes=np.arange(node_count,dtype=np.int32)
    for f in range(frames):
        values=previous[node_count:]
        best=np.full(node_count,-np.inf,dtype=np.float32);np.maximum.at(best,end,values)
        arg=np.full(node_count,n,dtype=np.int32)
        np.minimum.at(arg,end,np.where(values==best[end],eid,n))
        top_token=np.full(node_count,-1,dtype=np.int32)
        live=arg<n;top_token[live]=token[arg[live]]
        alternate=np.where(token==top_token[end],-np.inf,values)
        second=np.full(node_count,-np.inf,dtype=np.float32);np.maximum.at(second,end,alternate)
        arg2=np.full(node_count,n,dtype=np.int32)
        np.minimum.at(arg2,end,np.where(alternate==second[end],eid,n))
        # Blank nodes consume blank. Token states consume their acoustic label.
        bpred=np.where(best>previous[:node_count],node_count+arg,nodes)
        bscore=np.maximum(best,previous[:node_count])+logp[f,0]
        repeated=top_token[start]==token
        inbound=np.where(repeated,second[start],best[start])
        inbound_arg=node_count+np.where(repeated,arg2[start],arg[start])
        tpred=np.where(previous[start]>values,start,node_count+eid)
        tscore=np.maximum(previous[start],values)
        take=inbound>tscore;tpred[take]=inbound_arg[take]
        tscore=np.maximum(tscore,inbound)+logp[f,token]
        previous=np.concatenate([bscore,tscore]);back[f]=np.concatenate([bpred,tpred])
    ending=np.flatnonzero(end==node_count-1)+node_count
    candidates=np.r_[node_count-1,ending];state=int(candidates[np.argmax(previous[candidates])])
    score=float(previous[state])
    if not np.isfinite(score):raise ValueError('impossible-pronunciation-path')
    path=[]
    for f in range(frames-1,-1,-1):
        path.append(state);state=int(back[f,state])
    path=np.array(path[::-1]);spans=[]
    for state in np.unique(path):
        if state<node_count:continue
        e=int(state-node_count);hit=np.flatnonzero(path==state)
        spans.append({'edge':e,'from':int(start[e]),'to':int(end[e]),'token':int(token[e]),
                      'piece':edges[e][3],'startFrame':int(hit[0]),'endFrame':int(hit[-1])+1,
                      'logProbability':float(logp[hit,token[e]].mean()),
                      'greedySupport':float((logp[hit].argmax(1)==token[e]).mean())})
    spans.sort(key=lambda x:x['from'])
    return spans,score


def align_pronunciations(logp,lines,tokenizer,duration):
    edges,bounds,nodes=pronunciation_graph(lines,tokenizer)
    spans,score=lattice_viterbi(logp,edges,nodes)
    rows=[]
    for start,end,line_id in bounds:
        units=[s for s in spans if start<=s['from']<end]
        if not units:raise ValueError('unvisited-line')
        onset=(units[0]['startFrame']*STRIDE+(RECEPTIVE-1)/2)/RATE
        offset=min(duration,(units[-1]['endFrame']*STRIDE+(RECEPTIVE-1)/2)/RATE)
        support=float(np.mean([s['greedySupport'] for s in units]))
        probability=float(np.exp(np.mean([s['logProbability'] for s in units])))
        reasons=['unvalidated-singing-model','automatic-pronunciation-lattice']
        if support<.5:reasons.append('weak-acoustic-support')
        if probability<.05:reasons.append('low-path-probability')
        if offset-onset<.12:reasons.append('collapsed-line')
        if offset-onset>20:reasons.append('overlong-line')
        rows.append({'lineId':line_id,'text':lines[line_id],'start':onset,'end':offset,'status':'review',
                     'reasons':reasons,'evidence':{'greedySupport':support,'geometricTokenProbability':probability},
                     'tokens':units})
    return {'status':'review','pathLogProbability':score,'lines':rows,'latticeEdges':len(edges)}
