"""Fetch pinned public assets with SHA-256 verification. No audio is uploaded."""
import argparse
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import urllib.request
import zipfile
from engine import sha256


def download(url,path,digest,verify_only=False):
    if path.is_file() and sha256(path)==digest:return
    if verify_only:raise ValueError(f'missing-or-corrupt-asset:{path.name}')
    path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as temp:
        temporary=Path(temp.name)
        try:
            with urllib.request.urlopen(url,timeout=60) as response:shutil.copyfileobj(response,temp)
            temp.flush()
            if sha256(temporary)!=digest:raise ValueError(f'download-hash-mismatch:{path.name}')
            os.replace(temporary,path)
        finally:temporary.unlink(missing_ok=True)


def safe_extract(archive,destination):
    destination=destination.resolve()
    with zipfile.ZipFile(archive) as z:
        if sum(x.file_size for x in z.infolist())>2_000_000_000:raise ValueError('archive-size-budget-exceeded')
        for member in z.infolist():
            target=(destination/member.filename).resolve()
            if not target.is_relative_to(destination) or stat.S_ISLNK(member.external_attr>>16):raise ValueError('unsafe-archive-member')
        z.extractall(destination)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--assets',type=Path,required=True)
    p.add_argument('--group',choices=['base','large','romaji','qwen','tifa-research'],default='base')
    p.add_argument('--verify-only',action='store_true');p.add_argument('--research-nc-model',action='store_true')
    a=p.parse_args()
    if a.group=='tifa-research' and not a.research_nc_model:raise ValueError('explicit-research-nc-model-selection-required')
    manifest=json.loads(Path(__file__).with_name('assets.json').read_text())
    for f in manifest['files']:
        if f['group']==a.group:download(f['url'],a.assets/f['path'],f['sha256'],a.verify_only);print('verified',f['path'],flush=True)
    for f in manifest['archives']:
        if f['group']!=a.group:continue
        folder=a.assets/f['extractTo'];archive=folder/'release.zip'
        download(f['url'],archive,f['sha256'],a.verify_only)
        if not a.verify_only:safe_extract(archive,folder)
        print('verified archive',f['group'],flush=True)


if __name__=='__main__':main()
