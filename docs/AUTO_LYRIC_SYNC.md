# 音源と既知歌詞の自動同期 — 実装前設計
日付: 2026-10-05 / 担当: Codex / 状態: ブラウザ版VSで完結する方式を優先。AI依存追加・実曲精度は未確認

## 要求
姫から「音源解析して、完璧に歌詞を合わせてほしい」。対象は特定の曲の手作業ではなくVSの自動同期機能（本人確認済み）。
目的は、正しい歌詞本文を変えずに、実際の歌声から各行の開始・終了を求めること。BPMへの吸着や文字数での等分を自動同期の代用にしない。全曲完全一致を保証する表記はしない。

## 現在との差
現行: core/audio/analyze.ts の300Hz–3kHz帯の強さと立ち上がり、歌い出し候補、手動タップ、±範囲での吸着。
歌詞本文との音声照合は未実装。ARCHITECTURE.mdの従来方針はAI同期を対象外としているが、今回の依頼はその機能追加を求めている。既存のタップ・ドラッグ・LRC/SRTは維持する。

## 提案する方式（12:24 JST 姫の追加指示を反映）
姫はワンツールを希望し、選択肢では「ブラウザ版のまま」を選択。別のPC補助アプリを起動して結果ファイルを渡す案は標準案から外す。
操作: 今のVSへ音源と正しい歌詞を入れる → 歌詞画面の「自動同期」 → 同画面で試聴・要確認行の修正 → 適用。
ブラウザ内のWeb Workerで音声AIを動かす候補を調査する。モデル準備・ダウンロード進捗・解析・中断もVS内で扱う。モデル取得を除き音源・歌詞を外部へ送らない設計とする。
Transformers.jsの公式資料にWhisperのWebGPU実行と語タイムスタンプのAPIがある。ただしこれはASR機能の存在を確認しただけで、既知の日本語歌詞を正確に同期できると確認したわけではない。
WebGPU/WASMでの対応モデル、歌唱精度、複数分の曲でのメモリ、スマホの対応は検証してから可否を決める。未対応端末で無断のクラウド解析へ切り替えない。

## MusicSync連携案（12:24 JST 姫の提案）
姫から「MusicSyncと連携すればどう？」。ワンツールの希望を保ち、VSの画面から処理できる共通エンジン/データ受け渡しとして検討する。
- 音声前処理・既存の解析・任意のボーカルstemを利用できるなら、歌詞照合の入力や区間の補助に使う。
- 音量/BPM等の解析と、歌詞本文を歌声へ照合する処理は別。連携だけを高精度自動同期の完成と扱わない。
- MusicSyncの現在の実装、ブラウザで再利用できるAPI、歌詞照合の有無は未確認。GitHubで当該ownerのmusic名称検索に一致するrepoは見つからなかった。存在しないとの判断はしない。
- 初版の自動同期を、MusicSyncの起動やファイル中継を必須とする方式にしない。
- 再利用できる場合も共通形式、音源sha、sample rate、offset、元曲/stem対応を明示し、二重解析やずれを避ける。
- 今回の変更はZUNZUNの設計文書のみ。MusicSync側へのcommit/pushは行わない。

## 解析の段階
1. 元曲と歌詞のsha256、行ID、長さを固定。空行・セクション・JIZURAの強調などは既存parseと同じ規則で表示文字と照合用文字を分ける。
2. 任意のボーカルstemを利用。元曲と長さ・オフセットを照合。初版で自動分離は追加しない。
3. 多言語ASRで歌われた語句と大まかな区間を取得。ASRの本文でユーザーの歌詞を書き換えない。
4. 日本語の空白差・句読点・表記ゆれを考慮し、既知歌詞とASRを順序付きで照合。サビの繰り返しは出現順と音声区間を使い、単純な部分文字列一致にしない。
5. 根拠を得た区間で既知歌詞をforced alignmentし、文字・語の開始/終了から各行の時刻を求める。行を発見できないときは未同期で返す。無理な等分で埋めない。
6. 欠落・順序逆転・音源外・重複・極端な短さ・過長・音声一致不足を検査。歌唱VADやモデルのscoreだけを校正済み確率として扱わない。
7. 要確認区間だけユーザーのアンカーを追加して再解析。手動確定・ロック済み行は保護。

## 実行エンジン候補と追加するもの
ブラウザの第一調査候補: @huggingface/transformers / ONNX Runtime Web / 多言語Whisperの対応モデル。日本語の語/文字タイムスタンプで既知歌詞を照合する方式を実曲で検証する。
既知本文のforced alignmentはASRの語タイムスタンプと同一機能ではない。ブラウザ上で必要なalignmentモデル/処理を動かせるか、ASR照合で行単位の目標精度を達成できるかを別に検証する。
WhisperXはPython側の比較評価候補に留め、VSの標準実行依存にしない。stable-tsは公式archiveのため標準依存に選ばない。
追加パッケージ・モデル取得はCLAUDE.mdに従い必要性を説明して了承後に進める。現時点で未導入。モデルのライセンス・版本・配布サイズを記録する。

## 結果データ案
version、audioSha256、lyricsSha256、engine/model/version、originalDuration。
lines: lineId、originalText、start/end（未同期ならnull）、status（candidate/review/unmatched）、reasonCodes、evidence。
units: original文字範囲、start/end、rawModelScore。日本語は空白で単語が切れないため「語」固定にはしない。
手修正はmanualとして区別し、変更が1回のundoで戻るよう適用する。既存projectでは新フィールド無しでも読めること。ユーザーの歌詞や音源が変わった結果は適用しない。
初版の行時刻は既存timing.lineTimes/lineEndsへ適用。語・文字単位の時刻をモーションの出現へ反映するのは、その保存・レンダラの互換性を検証して次段階で行う。

## 検証と完成条件
- 行単位: 中央値・95パーセンタイルの開始/終了誤差、欠落行、間奏誤配置、要確認の見逃しを人手の基準時刻と比較。
- まず複数の日本語実曲（長いイントロ/間奏、反復サビ、伴奏が強い曲、伸ばす母音、速い歌唱、混合英語、合唱）で評価。歌声の開始は「最初の可聴発音」に定義。
- 仮目標: 確定対象の行開始の95%を±100ms以内。これは目標であり達成実績ではない。品質不足なら候補扱いに留め、未同期を表示。
- unit tests: 改行/見出し/反復/欠落/表記ゆれ/不正データ/sha不一致/手修正保護/undo。
- UI: 解析中断、再解析、結果試聴、要確認だけ移動、適用前後比較。
- 同じ保存データのプレビュー・書き出しで同じ時刻を使う。既存608テストを含むbuild/lint/tests、実曲試聴とMP4を別々に記録。
- 現時点は設計のみ。AI環境のインストール、自動同期コード、実曲検証は未実施。

## 共同作業
Codex: VS内UI・ブラウザ実行・整合性/履歴・既存タイムラインとの統合・品質評価。
Claudeへ依頼: エンジン候補/日本語歌唱の照合方式をレビュー。実装する場合は開始前に対象ファイルを共有記録で宣言。既存モーションのレビュー作業とはファイルを分ける。
依存追加の了承後に分担を再確認する。ブラウザ完結の希望をPC補助アプリへの了承と取り違えない。

## 調査した公式資料
- https://huggingface.co/docs/transformers.js/guides/webgpu （ブラウザのWebGPU実行）
- https://huggingface.co/docs/transformers.js/api/pipelines （ASRと語タイムスタンプ）
- https://github.com/m-bain/whisperX （forced alignment、単語辞書外/重なる声の制限、実行環境）
- https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py （言語別alignmentモデルとAPI）
- https://github.com/openai/whisper （多言語ASR、モデル）
- https://github.com/SYSTRAN/faster-whisper （ローカル推論と実行環境）
- https://github.com/jianfch/stable-ts （既知本文のalignment、archive状態）

## 2026-10-05 B0: MusicSyncソースの読み取り結果

姫の「やって！」でコード読み取りを了承。保存済み資料の対象名からalpha.16.5 Performance Fast PathのソースZIPを取得。SHA-256は `697b5a803a16b5133251fbfe0dd2b49b5d2eafb4e69ab05eb781b4456324218a`。MusicSyncへの変更なし、静的読解のみ。impact.67 Portableはソースを含まないため、以下の結果を最新版へ外挿しない。過去の性能監査を今回の測定値として引用しない。

| 確認事項 | ソースで確認した事実 | 根拠（alpha.16.5） |
|---|---|---|
| 読み込む形式 | UIの音声選択はWAV/FLAC/AIFF/AIF/OGG。soundfileでFloat32、samples×channelsへ読む。monoは左右複製、3ch以上は先頭2ch。実行環境の対応codecは未確認 | `app.py:530,543`、`native_core/io.py:10–16` |
| sample rate | 最初の素材、または複数STEM中の最大rateへ統一。polyphase resample。既定48kHzが全素材のrateとは限らない。track.source_sample_rateは統一後rateであり、元ファイルのrate保持ではない | `native_core/stem_session.py:536–587`、`native_core/io.py:19–23` |
| 開始位置 | track.offset_secondsをround(offset×session.sample_rate)でsample化し、前をゼロで埋めて配置。UIでは0以上。読込時の自動無音除去・元曲との自動位置照合はこの経路にない | `native_core/stem_session.py:603–615`、`app.py:759,770` |
| 保存 | .msyncsessionは設定・パス・offsetを含むJSON。音声本体は別ファイル参照で、これだけをVSへ渡しても音源は取得できない | `native_core/stem_session.py:1775–1829,1910–1930` |
| 処理済み出力 | UIの全曲書き出しはprocessed_mixをPCM_24 WAVへ保存し、session/mix/final_guardをJSONレポートへ出す。自動のボーカル分離やボーカルstem専用書き出しは確認できない | `app.py:2214–2234`、`native_core/io.py:26–30` |
| 区間の補助 | detect_song_sections/SectionDescriptorからstart/end_sampleとsample_rate、秒の変換、confidenceを取れる。これは曲構造の推定であり歌詞行の時刻ではない | `native_core/stem_session.py:1165`、`native_core/section_commander.py:23–45` |
| 実装環境 | NumPy/SciPy/soundfile等のPython DSP。Tk UI。確認したnative_core/app/依存にASR・既知歌詞alignment・HTTP APIは見当たらない | `requirements.txt`、`native_core/`、`app.py` の検索と入出力経路の読解 |

### VSに渡す場合の共通形式案（まだ接続していない）
`originalAudioSha256`、`inputAudioSha256`、元曲duration、素材種別（original_mix/vocal_stem/processed_mix）、実素材sampleRate/channels、offsetの根拠、切り出し開始秒、除去した先頭無音秒、source versionを明示する。

原STEMファイルを切り出して認識した場合は、元曲時刻 = 認識時刻 + ファイル内切り出し開始 + 除去した先頭無音 + 元曲に対するSTEM開始offset。先にMusicSyncのセッション時刻へ配置済みの音声をrender_mix(start_sample=...)で切り出した場合は、元曲時刻 = 認識時刻 + start_sample/sample_rate（セッション0が元曲0と一致することが別途必要）。この経路にSTEM offsetをもう一度足さない。丸めはsample単位で記録する。

歌声入力としては、既に存在する未加工ボーカルstemを優先して比較する案。Air Polishやreverb等を通したmixの認識改善は未測定なので、処理済みなら高精度と決めない。Python関数をそのままブラウザへimportはできない。VSを別アプリの起動必須にしない方針を維持し、共通データ形式とブラウザ内の処理を先に検証する。

**B0で未受領:** 実際に使う元曲/STEMの形式・rate、元曲とのoffset(ms)と先頭無音/切り出しの担当者確認、前処理の具体的な入出力。上表はソース調査結果で、素材提供者からの確認書ではない。

**B1結果:** 隔離ページのWASMで準備3,640.8ms、3秒無音認識3,932ms。無音誤認識と範囲外timestamp9件を棄却。実曲/手タップ正解がないため±100ms達成率は未測定。詳細と生JSONは `docs/CODEX_SYNC_EXPERIMENT.md`。B2は未実装。
