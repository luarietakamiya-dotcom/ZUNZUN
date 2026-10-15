"""Optional acoustic boundary refinement, not beat snapping or text rewriting.

This is experimental signal processing on the local vocal track. Parameters
must be frozen on development data before evaluating a second song.
"""
import copy
import numpy as np
from scipy.signal import stft, find_peaks
from engine import RATE


def onset_candidates(samples):
    frequencies,times,spectrum=stft(samples,fs=RATE,nperseg=512,noverlap=352,boundary='zeros')
    band=np.abs(spectrum[(frequencies>=150)&(frequencies<=4500)])
    compressed=np.log1p(band*1000)
    novelty=np.maximum(0,np.diff(compressed,axis=1,prepend=compressed[:,:1])).mean(axis=0)
    scale=max(float(np.quantile(novelty,.95)),1e-9)
    peaks,_=find_peaks(novelty,distance=4,prominence=scale*.1)
    return times[peaks],novelty[peaks]/scale


def refine(prediction,samples,reachback=.3,preferred_lead=.08):
    times,strength=onset_candidates(samples)
    out=copy.deepcopy(prediction);previous=-1
    for row in out['lines']:
        start=row.get('start');end=row.get('end')
        if start is None:continue
        lo=np.searchsorted(times,start-reachback);hi=np.searchsorted(times,start+.05,side='right')
        original=start
        if hi>lo:
            local=times[lo:hi];weight=np.exp(-.5*((local-(start-preferred_lead))/max(reachback/2,.04))**2)
            choice=int(np.argmax(strength[lo:hi]*weight));candidate=float(local[choice])
            if candidate>previous and candidate<end:
                row['start']=candidate
            else:row['reasons'].append('onset-refinement-order-conflict')
        else:row['reasons'].append('no-local-onset-evidence')
        row['acousticStartBeforeRefinement']=original
        row['reasons'].append('experimental-vocal-onset-refinement')
        previous=row['start']
    out['boundaryRefinement']={'reachbackSeconds':reachback,'preferredLeadSeconds':preferred_lead,
                               'kind':'spectral-flux-10ms-not-beat-snap'}
    return out
