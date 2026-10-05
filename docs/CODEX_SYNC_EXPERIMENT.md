# B0 / B1 歌詞同期の隔離実験（2026-10-05）

姫の「やって！」でモデル取得・MusicSyncの読み取りを了承。B2（製品へのAI依存・自動適用）は未実装。通常のVSは実験ページをimportしない。

## B0: MusicSync
アクセス可能な10リポジトリの名前にMusicSyncはない。所有者を絞ったGitHub既定ブランチのコード検索「MusicSync」にも結果なし。ローカル名検索にも該当なし。関連名の候補 `3-Sync` のREADMEはアーティストの楽曲/壁紙サイトの説明で、音源解析エンジンではなかった。`3-Sync-Another` のREADMEは404。全ブランチ・未接続の保存場所は調べられていない。MusicSyncのURLまたは作業場所が必要。

素材形式、サンプルレート、stem/元曲のoffset、先頭無音、再利用APIの入出力は未受領・未確認。他リポジトリへ変更していない。

## B1: Node CPUによる実行確認（ブラウザ速度とは別）

- 隔離場所: ZUNZUN外の `/workspace/scratch/vs-sync-experiment`。
- npm: `@huggingface/transformers` 4.3.0。モデル: `onnx-community/whisper-tiny`、q8、CPU。
- 実取得ファイル合計: **43,613,734 bytes（41.59 MiB）**。encoder 10,124,990 bytes、decoder 30,719,241 bytes、他は設定とtokenizer。ランタイム・ライブラリのサイズは含まない。
- 再測定時のキャッシュ済みロード: **583.99 ms**。初回ロードの厳密な比較は同時取得の影響があるため未確定。
- 入力: Float32、16 kHz、48,000 sample、**3秒の完全な無音**。歌唱ではない。
- 日本語ASR（timestamp、生成上限128 token）: **3,644.11 ms**。
- 実行後のNodeプロセスRSS: **598,986,752 bytes（571.24 MiB）**。ピーク値やブラウザ/スマホのメモリではない。
- **無音から非空の日本語を生成し、3秒を越えるtimestampを9区間返した。結果は棄却。** ASR結果の自動適用は禁止し、無音・音源範囲外・欠落・反復を検証する必要がある。
- 生の測定結果: `docs/experiments/whisper-tiny-silence-node.json`。

## B1: ブラウザ実験

`public/experiments/lyric-sync/` は使い捨ての独立フォルダ。通常アプリへのリンク・依存追加なし。Workerで認識し、中止でWorkerを終了。WASM/WebGPUを明示選択、モデルロード/認識時間と範囲外timestampを表示、JSON保存が可能。音源は端末内でmono/16 kHzへ変換し、外へ送る処理なし。

ライブラリはjsDelivr、モデルはHugging Faceから実験開始時のみ取得。実曲ファイルの選択だけではネットワークへ音源を送らない。外部コード/モデルの初回取得と負荷は実験ページで明記。

最初のCloud Chrome測定で **WebGPU adapterなし**。WASMはweb用配布物のbare module import解決で止まったため、同じバージョンの依存同梱配布物 `dist/transformers.js` へ修正して再測定する。失敗を性能値として扱わない。

ブラウザのheap値は取得できてもGPU/WASMメモリを含む総使用量ではない。表示はその限定を明記。実曲3〜5曲・正しい歌詞・手で合わせた行頭時刻は未提供。歌唱の行頭一致率、±100 ms達成、かな正規化、強制アラインメントの精度は未測定。認識テキストを元歌詞へ上書きする機能はない。

## A1 実画素の確認

CI run `37283365714`、commit `ad6a747188fcb8345ed25d601a7d1cb33eac9fa7` の歌詞E2E **4/4成功**。9秒の見本、240 BPM、動き/装飾1、320×180または180×320。各ケース行内境界6箇所を確認。境界の±80 msでalpha>0.1の画素割合の最小値。

| パック・比率 | 境界付近の最小描画割合 | 明るさ急変/秒の最大 | fast/通常の最大画素差 | 描画時間p95 |
|---|---:|---:|---:|---:|
| Hyper 横 | 30.48% | 2 | 0 | 10.1 ms |
| Hyper 縦 | 31.81% | 3 | 0 | 12.7 ms |
| Gothic 横 | 5.43% | 0 | 0 | 0.5 ms |
| Gothic 縦 | 4.75% | 0 | 0 | 0.3 ms |

この見張りテストは正式な光過敏検査ではない。描画時間は小さいCIキャンバスでの値で、1080p書き出しやスマホの速度ではない。fast差分は毎秒1コマ、計9コマで比較。実MP4の色・画質・同期は未確認。

## 次に必要な情報と判断

MusicSyncの所在、実曲・既知歌詞・基準時刻を受け取ってB0/B1を続ける。ブラウザ測定と歌唱の一致率を評価するまで「完璧な自動同期」とは扱わない。D-005のA2（残る4テーマ）は姫のA1見た目レビュー後。

公式資料: https://huggingface.co/docs/transformers.js/guides/webgpu 、 https://huggingface.co/docs/transformers.js/guides/dtypes 。配布形態は導入した4.3.0のpackage/distも確認。
