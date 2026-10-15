# VS 独立歌詞同期研究ルート

2026-10-15 時点では **自動適用には未達**。既知の歌詞を音に照合する Python CLI と、再現用の評価一式。独自実装は照合経路・発音候補探索・行への対応・異常検査であり、基盤モデルを新規学習したものではない。本体や LyricSync の依存は変更しない。

詳細と実測は `../../docs/INDEPENDENT_SYNC_20261015.md`、集計は `results-20261015.json`。モデルの名前で優劣を決めず、改善しなかった比較も保存した。

## 最小ルート

Python 3.12 / Linux CPU で検証。プロジェクトのルートで実行する。音声の外部送信は行わず、最初だけモデルを配布元からダウンロードする。

```bash
python3.12 -m venv /tmp/vs-sync-env
/tmp/vs-sync-env/bin/pip install -r experiments/independent-sync/requirements.txt
/tmp/vs-sync-env/bin/python experiments/independent-sync/prepare_assets.py --assets /tmp/vs-sync-assets --group base
/tmp/vs-sync-env/bin/python experiments/independent-sync/engine.py \
  --audio /absolute/path/vocals.wav --lyrics /absolute/path/lyrics.txt \
  --assets /tmp/vs-sync-assets --cache /tmp/vs-sync-cache --output /tmp/vs-sync-result.json
/tmp/vs-sync-env/bin/python -m unittest discover -s experiments/independent-sync -p 'test_*.py'
```

`lyrics.txt` は UTF-8、歌唱順に1行ずつ。タイトル、`[Verse]` 等の見出し、時刻タグ、歌わない注釈は含めない。Project JSON や LRC を読む実装ではない。歌唱される繰り返しは毎回記載する。出力の時刻は歌唱時刻で、表示を400ms早める補正やビートへの吸着は入れない。

全候補は `review`、不成立は `unmatched`。確率の値は校正済みの正解率ではない。無音、NaN、不可能な経路、辞書外文字、メモリ上限超過はエラー/保留にする。読みの取り違え、歌詞と違う発音、演奏にない歌詞を完全に識別できる保証はない。VS の Project JSON へ自動適用する機能はない。

## 比較ルート

- 大型日本語 CTC: `prepare_assets.py --group large` 後、`engine.py` に `--acoustic-model large --pronunciation-lattice` を指定。ベースの発音候補版は `--pronunciation-lattice` のみ。
- 歌声音素: `pip install onnx==1.19.1 pyopenjtalk-plus==0.4.1.post7`、`prepare_assets.py --group romaji`。`romaji_engine.py --audio ... --lyrics ... --assets /tmp/vs-sync-assets/romaji --cache ... --output ...`。公開グラフの重みを変更せず ArgMax 前の logits を取り出し、元の結果との一致を確認する。
- Qwen: 別環境で公式 `qwen-asr==0.0.6` の依存を導入し、`prepare_assets.py --group qwen`。`qwen_engine.py --audio ... --lyrics ... --model /tmp/vs-sync-assets/qwen --coarse /tmp/vs-sync-result.json --output ...`。18秒程度の歌詞群と前後3秒で比較。全文を一度に入れる比較は `--coarse` を省略。今回の歌唱では時刻の潰れ/不一致が多く、採用しない。
- TIFA: **CC BY-NC-SA 4.0 モデルを使う研究比較のみ**。`prepare_assets.py --group tifa-research --research-nc-model`。上流 `https://github.com/openvpi/TIFA` の v1.0.0（`32a0a13aebce580844ad1dc281ea11ef1be94f14`）を別ディレクトリに取得し、その推論用依存を別環境へ導入する。追加で `unidic-lite==1.0.8` を使う（完全版 UniDic と同一ではない）。`tifa_engine.py --research-nc-model --audio ... --lyrics ... --source /path/to/TIFA --model /tmp/vs-sync-assets/tifa/TIFA-1.0-ST/model.pt --coarse /tmp/vs-sync-result.json --output ...`。設定は `ConfigurationScope.FA` で読み込む。上流ソースは変更しない。辞書や依存の供給は `environment-tested-linux-py312.txt` を参照。これは実験環境の記録で、全 optional 依存を含めたクリーンインストールの保証ではない。

`assets.json` に URL・revision・SHA-256 を固定。既存資産は `prepare_assets.py --verify-only` で確認する。アーカイブは検証後に展開し、パス逸脱を拒否する。モデル重みの Apache-2.0 と実行依存のライセンスは別物で、例えば pykakasi は GPL-3.0。商用アプリへの組み込み・再配布を承認済みとはしない。

## 評価を分離する

推論は人の正解時刻を読まない。`--coarse` に渡すのは、このエンジンが独自に予測した出力だけ。正解データは推論完了後の評価器にだけ渡す。

```bash
python evaluate.py prediction.json reference.json metrics.json
```

正解の形式:

```json
{"audioSha256":"...","lyricsSha256":"...","kind":"expert/manual/proxy の区別", "lines":[{"lineId":0,"text":"照合対象の本文","start":1.23}]}
```

音声/歌詞ハッシュ・行ID・本文を照合し、未一致も分母に残す。候補が出た行だけを使って成功率を上げない。`make_report.py --private ... --output ...` は個別の歌詞・音源・正解時刻をコピーせず集計だけを作る。

`check_consistency.py` はゲイン変更と先頭無音追加に対する整合性を測る。今回5行のうち1行で無音追加後に3.6秒ずれた。これは絶対時刻の正解を測る試験ではないが、自動適用を見送る具体的な根拠になる。

`combine.py` はベース・大型・歌声音素の中央値と候補範囲を出す。参照時刻を使わない。今回精度は安定して改善しなかったため採用しない。全行を保留し、モデルが一致しても正しさとは見なさない。`refine.py` も別曲で悪化したため不採用。両方をデフォルト補正として使わない。
