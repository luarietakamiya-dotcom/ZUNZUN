# 引き継ぎメモ（ローカル Claude Code ⇄ Cloud Session）

最終更新: 2026-09-29（Cloud Session で変拍子対応の R3 = JIZURA とつなぐ部分を実装した時点）。
これまでの作業は Claude Code の Cloud Session で行い、`npm install` が必要な確認だけをユーザーがローカル PC（Windows / PowerShell）で実行していた。
ローカルの Claude Code なら `npm` も `git` も直接使えるので、以後は同じ場所で実装と検証を完結できる。

## 現在地

| 段階 | 内容 | 状態 | コミット |
|---|---|---|---|
| Phase 1 | 設計（`docs/ARCHITECTURE.md`） | 完了 | `e75e00c` `da5e8ca` |
| Step 1 | Vite/TS 足場・6 タブの UI シェル | 完了 | `bd335c8` |
| Step 2 | AudioEngine（デコード・オフライン解析・BPM・タイムライン・再生） | 完了 | `a768b37` |
| Step 3 | Visualizer Registry / Host / デバッグ用プリセット | 完了 | `81166cf` |
| Step 4 | PostFX（Bloom・Light Rays）/ Compositor | 完了 | `04b9d7f` |
| Step 5 | Project JSON 保存・読み込み（ref + sha256、再リンク） | 完了 | `9dea7f7` `8a5ddda` |
| Step 6 | Overlay Manager（PNG/WebP/JPG） | 完了 | `6702adf` `a30c3b5` |
| Step 7 | MP4 書き出し（WebCodecs + Mediabunny） | 完了・実機で音ズレ 1 フレーム以内を確認 | `c4af441` |
| Step 8 | プリセット **Solar Gate** | 完了・ユーザー確認済み | `e85632b` |
| Step 9 | プリセット **Milky Way** | 完了・ユーザー確認済み | `0ee8a0d` |
| Step 10 | プリセット **Live Stage** | 完了・ユーザー確認済み | `071f22b` |

最後に確認できたテスト結果: 28 ファイル / 215 テスト + E2E 7 件すべて成功（ローカル Windows、three.js r180、mediabunny 1.60.0）。

## いま次にやること（2026-09-29 時点）

R2（変拍子の画面）・R3（JIZURA とつなぐ）は実装済み・**ユーザー確認待ち**（実際の曲での見た目と使い心地）。次は **R4**（`J.register` で変拍子向けの独自の演出と変拍子用スタイル。同梱ファイルは改変しない。独自の演出は `planRhythmAt(env.plan, t)` で小節・まとまりの位置を読む）。詳細は下の表と `docs/ARCHITECTURE.md`「変拍子（リズム）の方針」。

- 2026-09-29 にローカルの Claude Code から **Cloud Session へ移した**（ユーザーが PC を閉じても進められるように）。クラウドではアプリ内ブラウザが使えないので、見た目の確認は Playwright（`npm run test:e2e`、SwiftShader）か、ヘッドレス Chromium で canvas を画像にして行う。実際の曲（ユーザーの「Black Rose」など）はクラウドに無いので、実際の曲での確認はユーザーに頼む。
- ユーザーとのやり取りは**必ず日本語**（途中で英語になって 2 回注意された）。

## 歌詞モーション + 半自動タップ同期 + 変拍子（MVP 後・Phase 4 として計画を承認済み）

ユーザーの決定（2026-09-28）:
- **フォントだけは外部通信を許可**（Google Fonts から、歌詞モーションが使う書体だけを読み込む）。`docs/ARCHITECTURE.md` の技術選定表を更新済み。音源・画像・歌詞などは送信しない。
- **JIZURA は最新のコミット `8da975f` に固定して同梱する**（L5 で GitHub からダウンロードすることも了承済み）。なお Phase 1 で調べた `bae339e` は今の履歴と分岐している（履歴が書き換えられた模様）。VERSION はどちらも 0.9.0。
- **順番は同期が先**（L1 → L6）。1 段階ごとに build / lint / test・コミットし、ユーザーの確認を待つ。

| 段階 | 内容 | 状態 |
|---|---|---|
| L1 | 歌詞データの土台: `core/lyrics/parse.ts`（テキスト/LRC/SRT、JIZURA `J.parseLyrics` の移植）、`timing.ts`（`J.computeTiming` の移植 + `lineEnds`）、Project JSON の `lyrics`（検証つき、version 1 のまま）、store | 完了（`4983784`） |
| L2 | 同期の計算（純粋関数）: 歌い出し候補（歌声らしさの立ち上がり）、吸着（候補 → ビート → そのまま、±150ms、Alt で無効）、タップの状態（叩く/戻る/中断/取り消し/やり直し）、LRC/SRT の全体オフセット推定（相互相関） | 完了（`b9f9f70`） |
| L3 | Lyrics タブ①: 入力・読み込み・行一覧、再生しながら Space/Enter で行頭を叩く（Backspace で戻る、Esc で中断）、吸着の設定、今の行の強調（文字だけのプレビュー） | 完了（ユーザー確認済み。`981dc83`〜`fb84935`） |
| L4 | タイムライン編集（canvas）: 波形・歌声らしさ・ビート線・行ブロック、ドラッグ（吸着、Alt で無効）、矢印 10ms / Shift で 100ms、選択行・全体のオフセット、取り消し/やり直し、選択行のループ試聴、LRC のオフセット提案 | 完了（ユーザー確認済み。`3583c1f`） |
| L5 | JIZURA の同梱（`vendor/jizura/`、エディタ UI と書き出しを除いたエンジン、LICENSE・元コミット明記、遅延読み込み）とアダプタ（seed 固定のため `Math.random` を一時的に差し替え、`J.computeTiming` を包んで `lineEnds` を反映）。E2E（同じ seed → 同じ画像）。ビジュアライザーの E2E もここで作る | 完了（`cf709e7`） |
| L6 | Host の描画順に歌詞の層を追加（プリセット → PostFX → 歌詞 → オーバーレイ）、プレビュー（縮小・簡易描画）と書き出し（全解像度）、モーション設定の最小 UI、見た目の確認と 3 秒の MP4 | 完了（Visualizer タブで Solar Gate に重なることをユーザーが確認。`19a65f0`） |
| L7 | **オリジナルのスタイル**（ユーザー要望 2026-09-28）: 既存のスタイルを元に、名前・色 6 色・書体 3 役・質感 4 項目を変えた「マイスタイル」を作り、プロジェクトに保存（1 プロジェクト 1 つ）。`J.STYLES` に同じ形で登録（同梱ファイルは改変しない） | 実装済み・**ユーザー確認待ち** |
| R | **変拍子に対応した歌詞モーション**（ユーザー要望・計画承認 2026-09-29）。方針は `docs/ARCHITECTURE.md`「変拍子（リズム）の方針」。小節の頭はタップ、拍子は `2+2+3` のようなまとまりで区間ごとに指定、Project JSON 最上位の `rhythm` に保存。対象は歌詞モーションだけ（`AudioFrame` は変えない）。**JIZURA は改変せず**、変拍子向けの演出を `J.register` で独自に追加し、変拍子用スタイルを作る（ユーザーの提案。フォークより本家の更新を取り込みやすい）。R1 データと計算 → R2 画面 → R3 JIZURA とつなぐ → R4 変拍子パック | R1〜R3 実装済み・**ユーザー確認待ち**。次は R4 |

L1 の要点:
- **行番号の数え方は JIZURA と完全に同じにする**（`lineTimes` のキーが行番号なので、ずれると別の行に時刻が付く）。移植時に、実物の `J.parseLyrics` / `J.computeTiming` を Node で動かして、同じ入力で同じ結果になることを確認した（一回限りの確認。L5 で同梱したあとは Vitest の比較テストにする）。
- SRT は JIZURA が扱わないので、LRC に変換してから渡す（`srtToLrc`、字幕内の改行は手動区切り `/`）。字幕の終了時刻は `parseLyricsSource(...).srtEnds` で取れる（`lineEnds` の初期値用）。
- `lineEnds` は ZUNZUN の拡張。終了は次の行の開始より後ろに伸ばさず、開始 + 0.35 秒より短くしない。
- Project JSON の `lyrics.motion` は L5 で項目を決めるまで空（読み込み時もすべて捨てる）。

L2 の要点（`src/core/lyrics/`）:
- `candidates.ts` `findOnsetCandidates(vocalLikeness, frameRate)`: **L3 で作り直した**。「直後 120ms の中央値 − 直前 120ms の中央値」（段差）の山を候補にし（前後 120ms で最大、最大の段差の 20% 以上）、時刻はその近くで 1 フレームの増加がいちばん大きいフレームに合わせる。最初の版（瞬間的な増加量 + 上位 15%）は、Lyrics タブで合成音源を鳴らしたら、キックのアタックや音の切れ目のクリックも候補にして 6 個のはずが 33 個出た。中央値なら窓の半分より短い山は無視される。**実際の曲（伴奏あり）での出方はまだ未確認**。
- `snap.ts` `snapTime(t, {candidates, beats}, windowSec, enabled)`: 候補 → ビート → そのまま。候補はビートより遠くても窓内なら優先。
- `tap.ts` `TapSession`: JIZURA の startTap / tapNow / tapBack / stopTap と同じ規則（後ろの行の古い時刻が叩いた時刻 + 0.2 秒より前なら消す、途中の行からは 2.5 秒前から再生、間奏の行も叩く）。lineTimes は不変に扱い、毎回新しいオブジェクトを返す。
- `history.ts` `History<T>`: 取り消し・やり直し（上限 200）。L3 のタップと L4 のタイムラインで共有する。
- `offset.ts` `estimateOffset(lineStarts, candidates)`: ±5 秒を 10ms 刻みで探し、行の開始の近く（ガウス σ=60ms）にある候補の強さの合計が最大のずらし量を返す。ずらさない場合の点・一致した行の割合も返すので、UI は「どれくらい良くなるか」を見せて提案できる。

L3 の要点（`src/ui/panels/lyrics.ts` ほか）:
- 画面: 入力（形式の選択・ファイル読み込み・テキスト）/ 再生と文字のプレビュー（今の行・次の行）/ タップ同期 / 行の一覧（開始は直接入力でき、行を押すとそこへ移動・選択。手動の時刻は × で消せる）。
- **吸着は叩き終えてから「吸着」ボタンでまとめて**（ユーザーの希望。最初は叩くたびに吸着していた）。叩いた時刻は聞こえている位置のまま記録し、`snapAllLines`（`core/lyrics/snap-all.ts`）で手動の行をまとめて寄せる: ①各行の近く ±300ms で「近さ × 強さ」が最大の候補とのずれの中央値を「叩くタイミングのくせ」として見積もり（3 行以上、±250ms まで）、②「叩いた時刻 + くせ」を中心に ±吸着範囲で「近さ × 強さ」最大の候補 → 無ければビート → 無ければそのまま、③行の順番は崩さない。「吸着前に戻す」は、吸着後に手を加えていない間だけ 1 回で戻せる（取り消しの履歴で 1 つ戻すのと同じ）。一覧の由来は、吸着で動いた行を「吸着 −40ms」のように出す。実際の曲（Black Rose, 3:07）では歌い出し候補が 392 個（約 2 個/秒）出ていたので、1 行ずつ最寄りに寄せるより強さで選ぶ方がよい。`LyricsTiming.snap`（叩いたときに吸着するか）は今は使っていない（Project JSON の互換のため残している）。
- **モード切り替え「タップで合わせる」/「確認する」**（ユーザー要望）: 確認モードでは Space は再生/一時停止だけ（記録しない）、プレビューは今の行をいちばん大きくして行内の進み具合をバーで出し、一覧の行を押すとその 1 秒前から再生する。タップ同期の欄は隠す。モードはモジュール単位で持つ。
- プレビューは 3 行: 前の行（小さく薄く）・今の行・**次の行（いちばん大きく = これから叩く行、「次 (n 行目)」の見出し付き）**。
- **再生中の Space はいつでも「記録」**: タップ中でなくても、再生中に Space/Enter を押すとその場でタップが始まり、「次の行」（過ぎた同期済みの行の次。プレビューの「次: …」と同じ）の頭として記録する。止まっているときの Space は再生、Esc はタップをやめて一時停止。最初は「タップ中でなければ Space = 再生/一時停止」にしていて、ユーザーが「再生」ボタンを押してから Space を押すと一時停止になった（ボタンにフォーカスが残り、ブラウザの標準動作でもう一度押される + こちらの切り替え）。Lyrics タブでは Space をどのボタンの上でも横取りする（Enter はボタンの上ではボタンを押す）。
- キー: タップ中は Space/Enter で叩く・Backspace で 1 つ戻る（3 秒戻して再生）・Esc で中断・**Shift** を押しながら叩くと吸着しない（最初は Alt にしていたが、Windows では Alt+Space でウィンドウのメニューが開くので変えた）。叩いた時刻は **いまスピーカーから聞こえている位置**（`AudioEngine.heardTime`、`AudioContext.getOutputTimestamp()` で出力の遅れを差し引く）で記録する。最初は処理中の位置（`currentTime`）で記録していて、ユーザーから「間違ったほうに吸着する」と報告があった（出力の遅れのぶん後ろの候補に寄る。この PC の内蔵出力で約 48ms、Bluetooth では 150〜250ms ほど）。「今の行」の表示も聞こえている位置に合わせた。タップ中でなければ Ctrl/Cmd+Z で取り消し、Ctrl/Cmd+Y（Shift+Z）でやり直し、Space で再生/一時停止。入力欄にフォーカスがあるときはどれも効かない。
- 取り消しの履歴・選択中の行はモジュール単位で持つ（タブを切り替えても残る）。Project JSON の読み込みなど別の経路で時刻が差し替わったら、履歴を捨てて今の状態から始める（`syncHistoryWithStore`）。タップ中にタブを離れるとタップはそこで終わる。
- **タップも LRC の時刻も無い行は「未同期」**として扱う: 一覧では時刻欄を空にして仮の時刻を薄く出すだけ、プレビューにも出さない。JIZURA の規則では 1 行目が 0.4 秒から始まる仮の時刻が付くため、最初はイントロで歌詞が流れて「もう吸着している」ように見えた（ユーザー報告）。仮の時刻は L5 の歌詞モーションで使うので内部では持つ。途中の行からタップを始めるときの再生位置も、同期済みの時刻だけから決める。
- ファイルを読み込むと、前の歌詞の時刻は消す（取り消しで戻せる）。SRT は字幕の終了時刻を lineEnds に入れる。
- **最後の行の lineEnds は、見積もりより長くてもそのまま使う**（次の行が無いので。SRT の最後の字幕が短く切られていた）。
- **`AudioEngine.play()` を直した**: 以前は `_lastT`（Visualizer タブの描画でしか更新されない）から再生していたので、他のタブで一時停止 → 再生すると古い位置に戻っていた。今は AudioPlayer が覚えている位置から再生する。`currentTime` ゲッターも追加。
- 確認のしかた: 開発サーバーを開き、ページ内の JS で合成音源（120 BPM のキック + 決めた時刻から鳴る 800Hz の「声」）を作って `store.audio.load()` に渡し、「1 行目からタップ」を実際にクリックしてから、JS でタイマーを使って決めた時刻に Space の keydown を送った。**アプリ内ブラウザのペインが隠れていると requestAnimationFrame が動かない**ので、テスト用の打鍵はタイマーで行う（アプリ側の表示の更新も止まるが、タップ処理はキーイベントで動くので影響しない）。
- 確認できたこと: 候補・ビートへの吸着・吸着なし・Alt、途中の行からのタップ、Backspace、Esc、取り消し/やり直し、直接入力、×、SRT の読み込み、保存 → 読み込みの往復。**確認できていないこと: 実際の曲での候補の出方と使い心地**（ユーザー確認待ち）。

R1 の要点（`src/core/rhythm/`）:
- データ: Project JSON 最上位の `rhythm: { enabled, bars: number[] (小節の頭の秒、昇順), meters: {bar, pattern}[] }`（`defaultRhythm()` は `enabled: false`・拍子 `4`）。読み込み時は検証（時刻は 0〜24 時間・昇順・近すぎるものをまとめる、拍子は `parseGrouping` で読めるものだけ・同じ小節は後勝ち・1 つも無ければ `4`）。store に `rhythm` / `setRhythm`。
- `grouping.ts`: `parseGrouping("2+2+3") → [2,2,3]`、数字 1 つは等分（`"4" → [1,1,1,1]`）、全角可、まとまり 1〜16・合計 32 まで。`formatGrouping` は逆。
- `grid.ts`: `buildRhythmGrid({bars, meters})` → 小節（最後の小節はひとつ前と同じ長さ、0.2 秒未満は捨てる）・拍（= まとまりの頭、`{t, bar, group, groupsInBar, barHead, length}`）・`beats`（JIZURA に渡す）・`accents`（小節の頭）。`groupsForBar`（その小節以前で最後の指定）、`rhythmPositionAt(grid, t)`（小節・まとまりの中の進み具合。R4 の演出が使う）。
- `bars.ts`: `fillToEnd`（最後の数小節の長さの中央値で曲の終わりまで埋める。半小節未満の端数は作らない）、`fillGaps`（間が小節の長さのほぼ整数倍なら等分して埋める。数小節ごとに叩く使い方）、`BarTapSession`（始めた時刻より後ろの小節の頭は消す・叩くたびに足す・0.15 秒以内の連打は無視・このタップで叩いたものだけ 1 つ戻れる）。
- `targets.ts`: 小節の頭の吸着先は**音全体の立ち上がり（flux）**を優先し、無ければ自動検出のビート（歌詞の吸着先の「歌声の立ち上がり」とは別）。

R2 の要点（`src/ui/panels/lyrics-rhythm.ts`、`src/core/rhythm/edit.ts`）:
- Lyrics タブのタイムラインのすぐ下に「リズム (変拍子)」欄。変拍子モードのチェック（`rhythm.enabled`。歌詞モーションへの反映は R3）、「最初から叩く」「再生位置から叩く」（2 秒前から流す。始めた位置より後ろの小節の頭は消える）、タップ中は Space/Enter = 小節の頭・Backspace = 1 つ戻る（3 秒戻して再生）・Esc = 終わる（一時停止）、Shift を押しながらだと吸着しない。
- **小節の頭は叩くたびに吸着する**（歌詞のように最後にまとめてではない）。吸着先は `barSnapTargetsFor`（音の立ち上がり → ビート）、範囲は ±80ms（立ち上がりは打楽器ごとに多く出るので歌詞より狭い）。記録のたびに「音の立ち上がりに吸着 +12ms」のように出す。
- 小節のタップ中は、Lyrics パネルの `onKey` より先にリズム欄の `handleKey` が受ける（歌詞のタップと Space を取り合わない。歌詞のタップ中は小節のタップを始められない、逆も同じ）。
- 「残りを同じ長さで埋める」「間を埋める」「小節をすべて消す」。取り消し/やり直しは**この欄のボタン**（歌詞の時刻とは別の履歴、モジュール単位。Ctrl+Z は歌詞の時刻のまま）。履歴の値は null もありうるので `canUndo` で判定する。
- 拍子の区間: 「N 小節目から [2+2+3]」の一覧（書き換え・×。1 小節目の指定は消せない）と追加欄（「再生位置の小節」で番号を入れられる）。候補は datalist。`setMeter`（同じ小節は置き換え・昇順・書き方をそろえる）/ `removeMeter` / `barIndexAt` / `describeGrouping`。
- 今の位置の表示（「2 小節目 · 2+2+3 の 3 番目のまとまり」とまとまりの箱）。
- タイムライン: 小節線（橙の太線 + 小節の番号）と、まとまりの頭（橙の細線、4px 未満に詰まるときは描かない）。`TimelineData.rhythm`（`buildRhythmGrid` の結果、store.rhythm ごとにキャッシュ）。
- 確認できたこと（ヘッドレス Chromium、合成した 7/8 の音 = 1 小節 1.75 秒、小節の頭とまとまりの頭にキック）: 3 小節を少しずらして叩く → 吸着、Esc、「残りを同じ長さで埋める」（10 小節に）、1 小節目から 2+2+3・5 小節目から 4、変拍子モードのオン、取り消し/やり直し、今の位置の表示、タイムラインの見た目（スクリーンショット）、小節のタップ中に歌詞の時刻が記録されないこと。
- **気づいたこと（未対応・要相談）**: 吸着後の小節の頭が、本当の位置より約 33ms（60fps の 2 フレーム）早くなった（1.75 → 1.7167）。解析の FFT 窓（約 46ms）がフレームの時刻を中心にしているため、立ち上がりの手前のフレームで flux が増え始めるのが原因と思われる。歌い出し候補（歌詞の吸着）も同じ作りなので同じように早めに出ている可能性がある。直すなら解析の時刻の付け方か候補の時刻の補正（全体に影響するので Phase 4 扱い）。
- 未実装: 小節線のドラッグ、1 小節目より前（曲の頭）への小節の追加（「最初から叩く」では 0 秒の小節の頭は叩けない。イントロを後ろへ埋める機能は無い）、クリック音での確認。**実際の曲での使い心地は未確認**。

R3 の要点（`src/core/lyrics/jizura-adapter.ts`）:
- JIZURA が音の情報から読むのは `duration` / `beats` / `energy` / `energyRate` の 4 つだけ。`beats` は plan に複製され、①行の中のカットの切れ目の吸着（±0.13 秒）、②拍ごとの色ズレの脈動、③演出が読む `env.beat`（何拍目・拍の長さ・拍からの経過）に使われる。
- `motionRhythmGrid(rhythm)`: 変拍子モードがオンで小節が 1 つ以上作れるときだけ `buildRhythmGrid` の結果、それ以外は null（自動検出のビート）。`buildJizuraAudio(analysis, grid)` は grid があれば **拍（まとまりの頭）を beats にする**。小節の外（イントロ・最後の小節の後ろ）には拍が無い（自動のビートは変拍子と合わないので混ぜない）。
- `attachRhythm(plan, grid)`: `plan.zzRhythm` に小節とまとまりの並びを添える（ZUNZUN の拡張。JIZURA 本体は読まない）。`planRhythmAt(plan, t)` で「何小節目・何番目のまとまり・進み具合」が取れる（R4 の演出用）。
- `LyricMotionOptions.rhythm`、`MotionRequest.rhythm`、`Mp4ExportJob.rhythm` を追加。プレビュー（Visualizer / Lyrics タブ）と書き出しは `store.rhythm` を渡す（書き出しは開始時に複製）。作り直しのキーは、変拍子モードがオンのときだけ小節と拍子を含む（オフの間に叩き直しても作り直さない）。
- 確認できたこと: 本物の JIZURA（jsdom）で、7/8 の拍を渡すと plan のビートがそれになり、行の中のカットの切れ目が拍の上に乗る（`jizura-compat.test.ts`）。ヘッドレス Chromium で実際に描き、切れ目が 3.75（小節の頭）→ 4.25 → 4.75（まとまり）→ 5.5 …になること、同じ設定なら同じ絵、オフとは違う絵になること。**実際の曲での見た目は未確認**。

L7 の要点:
- データ: `LyricsMotion.custom: LyricsCustomStyle | null`（`name` / `base`（元の JIZURA スタイル）/ `colors`（fg・sub・accent・accent2・ghostA・ghostB、#rrggbb）/ `fonts`（display・serif・body、JIZURA の書体のキーまたは '' = 元のまま）/ `texture`（grain・scan・ghost 0..1.5・glow））。マイスタイルを使うときは `motion.style = CUSTOM_STYLE_KEY ('zz-custom')`。読み込み時は検証し、`base` が壊れていれば丸ごと null。
- アダプタ: `customFromStyle`（元のスタイルの「文字が明るい配色」・最初の書体・質感から初期値を作る）、`buildCustomStyle`（元のスタイルを複製し、**暗い背景の配色だけ**残して色を差し替え。`ink` はアクセント役か文字役かを保つ。書体・質感・色ズレ・光・名前を差し替え。演出の好み `bias` や装飾はそのまま）、`registerCustomStyle`（`LyricMotion.create` のたびに `J.STYLES['zz-custom']` を上書き。`STYLE_ORDER` には入れないのでランダムには選ばれない）、`jizuraFonts`（ユーザーが読み込んだ書体は除く）、`isDarkText`。
- 画面: Lyrics タブの「歌詞モーション」欄に「このスタイルを元にマイスタイルを作る」ボタンと編集欄（`src/ui/panels/lyrics-style-editor.ts`）。スタイルの一覧の先頭に「★ 名前」。文字色が暗いと「読みにくくなります」と注意。「元のスタイルの色・書体・質感を読み込む」「マイスタイルを削除」。
- 最初の版に入れていないもの（ユーザー了承済み）: 演出の好みの細かい調整、自分の PC のフォントファイル、ほかのプロジェクトでの使い回し。
- 確認できたこと: 開発サーバーで作成 → 色・書体・名前の変更 → 一覧の表示・注意の表示、元の noir とマイスタイル（ピンクの文字 + Dela Gothic One）を描き比べて差し替わっていること。

L6 の要点:
- **Host の描画順**: プリセット → PostFX (Bloom) → **歌詞** (`src/core/lyrics/layer.ts` の `LyricLayer`) → オーバーレイ。Host に足したのは `readonly lyrics` と render/resize/dispose の 1 行ずつ。歌詞は Bloom を通さない（オーバーレイと同じ）。JIZURA は Canvas 2D で描くので、DOM に載せない 2D canvas に透過で描き、1 枚の板のテクスチャとして正射影で重ねる。JIZURA の画面比率を保って中央に収める（書き出しと同じ比率なら画面いっぱい）。テクスチャは大きさが変わるたびに作り直す（WebGL2 の texStorage のため）。
- **どの LyricMotion を描くか**は呼び出し側が決める: プレビュー（Visualizer タブ・Lyrics タブ）は `previewMotionProvider`（`motion-provider.ts`、タブをまたいで 1 つ）。設定（歌詞・時刻・モーション設定・seed・書き出しの比率・fps・音源）が 350ms 変わらなくなってから作り直し、その間はひとつ前を表示し続ける。プレビューは `fastLyrics: true`（ぼかし等を省く）。書き出しは `renderMp4` の中で書き出し開始時の設定から `LyricMotion.create` を直接呼ぶ（`fast: false`）。音源が無いときは歌詞を重ねない（ダミーの時刻になるため）。
- **背景なしで重ねるための調整**（同梱ファイルは改変せず、アダプタで対応）:
  - 配色: 文字が明るい配色だけを使う（`keepLightTextSchemes`。JIZURA のスタイルには「明るい背景 + 暗い文字」「暗い背景 + 暗い文字」の配色が混ざる）。
  - 画面を覆う演出を使わない（JIZURA の `enabled` で無効化）: 場面転換 10 種（`COVERING_TRANSITIONS`、途中のコマで画面の半分以上を塗る。最初はクリムゾンで `knCornerSwing` が画面全体を赤く塗った）とレイアウト 10 種（`COVERING_LAYOUTS`、障子・カーテン・ジッパー・字幕の帯・新聞など、画面の 8 割以上を背景ごと塗る）。27 種の場面転換と 184 種のレイアウトを 1 つずつ強制して描いて測った。文字の飾り・装飾・画面効果は覆わなかった。紙やカードを描くレイアウト（5〜6 割）は残した。**JIZURA を更新したら** `tests/e2e/visual.spec.ts` の「覆い隠さない」テストが新しく覆うもの（場面転換 5 割 / レイアウト 9 割以上）と、名前の変わったものを見つける。
- **設定**: `LyricsSettings.motion` = `{ enabled, style, motion, decor, density }`（既定は JIZURA の defaultProject と同じ。Project JSON に保存、読み込み時は検証）。Lyrics タブの「歌詞モーション (JIZURA)」欄: 重ねるかどうか・スタイル（JIZURA を読み込んでから 27 種を名前で出す）・3 つのスライダー・歌詞モーションだけのプレビュー（黒地）・状態（準備中 / 失敗）。
- 確認できたこと: 3 プリセット × 6 通りのスタイル・時刻で重ねた見た目（映像が見えたまま歌詞が乗る）、**3 秒の MP4 の書き出し**（90 フレーム・3.008 秒・640×360・H.264 + AAC。書き出したファイルを Mediabunny で読み直し、0.9 / 1.9 / 2.6 秒のコマに正しい行が映像と重なって入っていることを目で確認）。E2E に書き出しのテスト（`tests/e2e/export.spec.ts`。H.264 を書き出せないブラウザではスキップ）と「覆い隠さない」テストを追加。
- **まだ確認していないこと**: 実際の曲・実際の画面（Visualizer タブ）でのプレビューの重さ（毎フレーム JIZURA を 2D で描いてテクスチャに上げている）。長い曲での歌詞モーションの準備時間（全カットの下描き）。

L5 の要点:
- `vendor/jizura/jizura-engine.js`: JIZURA の `src/*.js` をファイル名順に連結（`build.py` と同じ）。`11_export.js`（書き出し、mp4-muxer に依存）と `12_ui.js`（エディタ画面）は除いた（どちらもエンジン側から参照されないことを確認）。**本文は無改変**（`@VERSION@` → `0.9.0` のみ）。生成は `node scripts/vendor-jizura.mjs <JIZURA のフォルダ> <SHA>`（ネットワークに接続しない）。出典・ライセンスは `vendor/jizura/README.md`・`LICENSE`、`THIRD_PARTY_NOTICES.md`。
- `src/core/lyrics/jizura-adapter.ts`:
  - `loadJizura()`: 動的 import（約 2MB、歌詞モーションを使うときだけ読み込む）。読み込み時に `J.computeTiming` を包み、`applyManualEnds`（`timing.ts` と共通）で lineEnds を反映する。
  - `buildJizuraProject` / `buildJizuraAudio`（音量は JIZURA と同じく 95 パーセンタイルで正規化）/ `nearestAspect`（書き出しサイズに最も近い JIZURA の比率）/ `lyricMotionSeed`（`deriveSeed(project.seed, 'lyrics')`）。
  - `LyricMotion.create(lyrics, audio, { projectSeed, width, height, fps })` → `render(ctx, t, { fast })`（透過・canvas の幅に合わせて拡大縮小）。Renderer は seed 付きの `Math.random` で作り、紙の質感もその場で作ってキャッシュさせる。
  - **書体の準備を待ってから返す**: `J.ensureFonts` のあとでも、描き始めてから読み込まれる書体があった（Google Fonts は文字の範囲ごとに分けて配信している）。E2E で 1 回目だけ `Noto Serif JP 700` が読み込み中で別の書体になり、2 回目以降と画像が違った。捨てる用の Renderer で全カットを小さく下描きして読み込みを始めさせ、読み込み中の書体が無くなるまで待ち（上限 10 秒）、`J.glyphs` / `J.metrics` のキャッシュを消してから、本番の Renderer を作る。
- テスト: `jizura-compat.test.ts` は**同梱した本物の JIZURA を jsdom で読み込み**、`parseLyrics`（行番号の数え方）と `computeTiming`（lineEnds の反映を含む）が移植版と完全に一致することを確かめる（jsdom に canvas が無いので、このテストの中だけ `getContext` を空にしている）。`tests/e2e/visual.spec.ts` は Visualizer 3 プリセット（真っ黒でない・同じ seed なら同じ画像・違えば違う画像）と歌詞モーション（透過・同じ seed なら同じ画像・手で決めた開始と終了がカット割りに使われる）。Playwright は SwiftShader で WebGL を動かす（`playwright.config.ts`）。`npm run test:e2e` は 5 件で約 25 秒。
- ESLint: `scripts/**/*.mjs` に Node のグローバル（process / console / URL）を足した。

L4 の要点:
- `src/ui/panels/lyrics-timeline.ts`: canvas 1 枚のタイムライン（目盛り・波形・歌声らしさの線・歌い出し候補の目盛り・ビート線・行のブロック・再生位置・ループ区間）。Lyrics タブの再生欄のすぐ下。ドラッグ中は見た目だけ動かし、離したときに `onDragCommit` でパネルへ渡す（パネルが `core/lyrics/edit.ts` の規則で書き換えて履歴に積む）。
- 操作: ブロックの左端 = 開始、右端 = 終了、真ん中 = 行ごと移動。離した位置は吸着（`snapTime`、Shift で吸着なし。設計では Alt だったが Windows の Alt 問題があったので Shift にそろえた）。ブロックをクリック = 選択（確認モードなら 1 秒前から再生）、何も無いところをクリック = その位置へ移動、ドラッグ = 左右に移動、ホイール = 左右、Ctrl+ホイール = 拡大縮小。← → で選んだ行を 10ms（Shift で 100ms）、↑ ↓ で行を選ぶ。
- 編集の規則（`core/lyrics/edit.ts`）: 開始は前後の**同期済みの**行の間（未同期の行の仮の時刻には縛られない）、終了は開始 + 0.35 秒 〜 次の行の開始（次が未同期でも、その仮の開始より後ろは computeLineTimes が切り詰めるので同じ上限）、行ごとの移動は手動の終了も一緒に動かす。LRC の行も動かしたら手動の時刻になる。
- 選んだ行のループ試聴（行の 0.5 秒前 〜 行の終わり）、選んだ行・全体を指定の ms ずらす、「全体のずれを推定」（`estimateOffset`、同期済みの行が 3 行以上必要）→ 「この量ずらす」。
- 波形は `core/audio/peaks.ts`（200 区間/秒の最大振幅、音源ごとにキャッシュ）、表示範囲は `core/lyrics/viewport.ts`。
- 確認できたこと（開発サーバー、合成ポインタイベント）: 開始・終了・行ごとのドラッグ、ビートへの吸着と Shift で吸着なし、クリックで選択・移動、矢印キー、取り消し、全行 0.7 秒遅れの LRC で「−720ms ずらすと 0% → 100%」の提案と適用、描画（スクリーンショット）。**ループ試聴は requestAnimationFrame で動くため、ペインが描画されない状態では確かめられていない。実際の曲での使い心地も未確認。**
- 合成イベントでは `setPointerCapture` が例外を出すので try で囲んでいる（実際のマウスでは不要だが害はない）。

### Live Stage の要点（Step 10）

- ムービングライト 8 台（底の開いた円錐 + ボリューム風シェーダー、加算）。向きは `leanX/leanZ`（真下からの傾き）で持ち、ビートごとにパターン表の次の段を目標にして滑らかに追う。パターン（fan / cross / wave / chase / converge）は 8 ビートごとに `ctx.rng` で選び直す（直前と同じものは選ばない）。ビートが無い区間はゆっくりのスイープ。
- bass → スモーク濃度（立ち上がり速く・引きはゆっくり）。光の筋の濃さ・床近くの霞・奥の壁の照り返しに効く。
- high → レーザーのストロボ。**光過敏性への配慮として点灯の立ち上がりは毎秒 3 回まで**（`MAX_STROBE_HZ`、ユーザー承認済み）。周期の頭でだけ「この周期で光らせるか」を決めるので、high がしきい値付近で揺れても余計に点滅しない。ビートでの光の筋の明滅も幅を控えめにしている（0.65〜1.0 倍）。
- 床は Reflector（半解像度、ユーザー承認済み）。
- 縦長では `layoutScale`（16:9 で 1、最小 0.45）でトラス・灯体・レーザーの間隔と横の振り幅を詰める。

## プリセットの作り方（Solar Gate / Milky Way で固まった型）

- `preset.ts` は `VisualizerPreset` を実装し、`readonly scene` / `readonly camera` を持つ。`init()` で全部を組み立て、`update(frame, params)` で音に反応させ、`resize()` でカメラと Reflector を更新し、`dispose()` で全部解放する。
- 音は `shapeAudio(frame, params)` / `shapeBands(...)`（`src/core/visualizer/response.ts`）を通して 0..1 にしてから使う。
- テスト用に `inspect()`（反応結果の数値）と、決定論を確かめるためのスナップショット取得メソッドを用意する。
- グラデーションのテクスチャは canvas ではなく配列から `DataTexture` で作る（jsdom でも同じものが作れる）。
- `manifest.post` で Bloom の基準値を決める。HDR（成分 > 1）で光らせたいものだけがしきい値を超えるようにする。

### 見た目の検証（重要）

最初の版はどちらのプリセットも、実際に描くまで分からない問題を抱えていた（Solar Gate は白飛び、Milky Way は天の川が灰色の霧・流れ星が出すぎ）。
**テストが通っても見た目は確認できないので、必ず実際に描いて画像を見ること。**

Cloud Session では、ヘッドレス Chromium（Playwright、SwiftShader の WebGL）で本物の `VisualizerHost` + PostFX + プリセットを描き、合成した 120 BPM の音（0.5 秒ごとのキック、16 分のハイハット）を固定の時刻で流してスクリーンショットを撮っていた。
ローカルでは `npm run dev` で直接見られるが、比較や記録には同じ方法（Playwright で canvas を `toDataURL`）が便利。
なお `docs/ARCHITECTURE.md` の Verification にある「Playwright でプリセットごとに一定時刻のフレームを描き、真っ黒でないこと・同じ seed なら同じ画像になることを確認」は**まだ E2E テストとして実装していない**（`tests/e2e/shell.spec.ts` のみ）。

## ハマりどころ（実際に起きたこと）

- **暗い色は数値より明るく見える。** 線形の色値のつもりで決めた空の色が、画面ではかなり明るく出た。見た目は実際のピクセル値を測って調整する。
- **加算合成の重なりと Bloom で白飛びしやすい。** 1 本 1 本は控えめにし、Bloom のしきい値は高め（0.55〜0.6）、半径は狭め（0.25〜0.3）にしている。
- **`PointsMaterial` の見た目の大きさは `size × (描画バッファの高さ / 2) / 距離` px。** 距離 13 で size 0.11 だと約 3px しかなく、ほぼ見えなかった。
- **`createImageBitmap()` を Three.js のテクスチャにすると上下が反転する。** `{ imageOrientation: 'flipY' }` を渡す（`texture.flipY` は ImageBitmap には効かない）。
- **`npm run build` はテストファイルも型チェックする。** テストだけの型エラーでもビルドが落ちる。
- **TypeScript**: `CommonParams` のようなインターフェースは `Record<string, unknown>` にそのまま代入できない（プリセットの `update()` に渡すときは `as CommonParams & Record<string, unknown>`）。キーがユニオン型の書き込みは `never` 扱いになりやすいので、`store.setParam()` のような総称型のセッターにする。
- **Mediabunny** は `package.json` が `^1.0.0` 指定で、どの版が入っているか Cloud Session から見えなかったため、どの 1.x でも通る `bitrate: QUALITY_*`（新しい版では非推奨）を使っている。ローカルで確認した版は **1.60.0** なので、`quality: new Quality('high')` に置き換えてよい（未対応）。
- **Live Stage の最初の版も描いてみるまで問題が見えなかった。** 床近くの霞が灰色の霧になった（濃度を 1/4 程度に下げた）。客席側へ傾けた光の筋がカメラに迫って画面を覆った（`MAX_LEAN_Z` で上限）。レーザーがカメラの近くを通り、太い帯になって白飛びした（カメラ手前の面 `LASER_TARGET_Z` で終わらせた）。
- **`shapeAudio()` は NaN をそのまま通す**（`clamp01(NaN)` が NaN）。Live Stage は `finite01()` で受けてから使っている。
- **ヘッドレス描画のハーネス**: `VisualizerHost.dispose()` は `forceContextLoss()` するので、同じ canvas で次の Host を作ると WebGL コンテキストが取れない。撮影ごとに canvas を作り直す。Windows ローカルでは Playwright 同梱の Chromium に `--use-angle=swiftshader --enable-unsafe-swiftshader` を付けて動いた（960×540・約 7 秒分の描画で 1 枚 20 秒ほど）。

## 未解決の設計課題（変更前にユーザーと相談。Phase 4 = Plan Mode 相当）

1. **PostFX に OutputPass（トーンマッピング + 色空間変換）が無い。** HDR が硬く白飛びする。入れると全プリセットの見た目が変わる。
2. **Light Rays パスが未調整。** 重みの合計が露出の約 3 倍になり、有効にすると明るくなりすぎる。現状どのプリセットも使っていない。
3. **Sensitivity / Bass / Mid / High の適用場所。** 設計では Host がまとめて適用するはずだが、デバッグ用プリセットが自前で sensitivity を掛けているため、今は各プリセットが `response.ts` を呼ぶ方式。
4. **Overlay タブにライブプレビューが無い。** 見た目は Visualizer タブで確認する（キャンバスを 2 タブで共有するには UI の作りを変える必要がある）。
5. **書き出しの MP4 はダウンロードまで丸ごとメモリに置かれる。** 長い曲 × 最高画質でメモリを多く使う（File System Access API でディスクへ直接書く案）。
6. **バンドルが 500kB を超える警告。** コード分割（プリセットや Mediabunny の遅延読み込み）で対処できる。
7. **プリセット選択がプルダウン。** 仕様ではサムネイルから選ぶ（`manifest.thumbnail` は空）。
8. **`npm audit` の moderate 2 件。** 開発用依存のみ。`npm audit fix --force` は使わない方針。

## MVP 後

- 歌詞モーション（Lyric Motion）と歌詞同期: **LYRIMO/Suno のブックマークレットは使わない。AI も使わない。** 半自動タップ（歌い出し候補・ビートへの吸着）+ タイムラインでの後調整（`docs/ARCHITECTURE.md`「歌詞同期の方針」）。歌声らしさ（vocalLikeness）は AudioEngine がすでに計算している。
- 書き出し形式の追加: WebM、PNG 連番（透過）。
- プリセットの追加: Aurora / Moon Ocean / Cyber Core / Liquid Mirror / Retro CRT（ユーザーの元の仕様。それぞれ「色違い」ではなく反応の仕組みが違う世界観にする）。
