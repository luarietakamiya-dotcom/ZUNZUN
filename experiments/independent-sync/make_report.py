"""Recompute aggregate-only report from private predictions and references.

Never copies audio, lyrics, reference timestamps or individual-row judgments.
"""
import argparse
import json
from pathlib import Path
from engine import sha256
from evaluate import evaluate

RUNS={
 'rabt':{'base':'rabt-base-vocal.json','base_mix':'rabt-base-mix.json','base_lattice':'rabt-lattice-vocal.json',
         'large_lattice':'rabt-large-vocal.json','qwen_windowed':'rabt-qwen-windowed.json','romaji':'rabt-romaji.json',
         'tifa_research_nc':'rabt-tifa.json','refinement_rejected':'rabt-refined.json','consensus_rejected':'rabt-consensus.json'},
 'blackrose':{'base':'blackrose-base-vocal.json','large_lattice':'blackrose-large-vocal.json',
         'qwen_windowed':'blackrose-qwen-windowed.json','romaji':'blackrose-romaji.json',
         'tifa_research_nc':'blackrose-tifa.json','refinement_rejected':'blackrose-refined.json','consensus_rejected':'blackrose-consensus.json'}}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--private',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();report={'date':'2026-10-15','decision':'not-ready-for-automatic-application','newlyTrainedWeights':False,
     'scope':'Linux CPU, 2 PyTorch/ORT threads; previous subjective listening references, not expert ground truth',
     'caveats':['RABT used as development set','Black Rose uses approximate listening-point proxies',
                'Black Rose is no longer unseen after comparisons','Missing rows retained in all-reference denominators',
                'Cached runs are not full acoustic inference timings','Public PJS audio unavailable due download quota'],
     'datasets':{}}
    for song,runs in RUNS.items():
        refpath=a.private/f'{song}-reference.json';ref=json.loads(refpath.read_text())
        dataset={'referenceFileSha256':sha256(refpath),'referenceKind':ref['kind'],'runs':{}}
        for name,filename in runs.items():
            path=a.private/filename;pred=json.loads(path.read_text())
            if name=='base_mix':ref=json.loads((a.private/'rabt-reference-mix.json').read_text())
            else:ref=json.loads(refpath.read_text())
            score=evaluate(pred,ref);score.pop('rows')
            score.update(predictionSha256=sha256(path),audioSha256=pred['audioSha256'],lyricsSha256=pred['lyricsSha256'],
                         engine=pred['engine'],elapsedSeconds=pred.get('elapsedSeconds'),acousticCacheUsed=pred.get('acousticCacheUsed'))
            if name=='refinement_rejected':
                score['elapsedSeconds']=None;score['timingNote']='Inherited acoustic timing is not a measurement of refinement runtime'
            dataset['runs'][name]=score
        report['datasets'][song]=dataset
    report['consistency']=json.loads((a.private/'consistency.json').read_text())
    a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':main()
