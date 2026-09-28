# 引き継ぎメモ（Cloud Session → ローカル Claude Code）

最終更新: 2026-09-28（MVP 完了後、歌詞機能の L1 を実装した時点）。
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

最後に確認できたテスト結果: 13 ファイル / 117 テストすべて成功（ローカル Windows、three.js r180、mediabunny 1.60.0）。

## 次にやること: 歌詞モーション + 半自動タップ同期（MVP 後・Phase 4 として計画を承認済み）

ユーザーの決定（2026-09-28）:
- **フォントだけは外部通信を許可**（Google Fonts から、歌詞モーションが使う書体だけを読み込む）。`docs/ARCHITECTURE.md` の技術選定表を更新済み。音源・画像・歌詞などは送信しない。
- **JIZURA は最新のコミット `8da975f` に固定して同梱する**（L5 で GitHub からダウンロードすることも了承済み）。なお Phase 1 で調べた `bae339e` は今の履歴と分岐している（履歴が書き換えられた模様）。VERSION はどちらも 0.9.0。
- **順番は同期が先**（L1 → L6）。1 段階ごとに build / lint / test・コミットし、ユーザーの確認を待つ。

| 段階 | 内容 | 状態 |
|---|---|---|
| L1 | 歌詞データの土台: `core/lyrics/parse.ts`（テキスト/LRC/SRT、JIZURA `J.parseLyrics` の移植）、`timing.ts`（`J.computeTiming` の移植 + `lineEnds`）、Project JSON の `lyrics`（検証つき、version 1 のまま）、store | 実装済み・**ユーザー確認待ち** |
| L2 | 同期の計算（純粋関数）: 歌い出し候補（歌声らしさの立ち上がり）、吸着（候補 → ビート → そのまま、±150ms、Alt で無効）、タップの状態（叩く/戻る/中断/取り消し/やり直し）、LRC/SRT の全体オフセット推定（相互相関） | 次 |
| L3 | Lyrics タブ①: 入力・読み込み・行一覧、再生しながら Space/Enter で行頭を叩く（Backspace で戻る、Esc で中断）、吸着の設定、今の行の強調（文字だけのプレビュー） | |
| L4 | タイムライン編集（canvas）: 波形・歌声らしさ・ビート線・行ブロック、ドラッグ（吸着、Alt で無効）、矢印 10ms / Shift で 100ms、選択行・全体のオフセット、取り消し/やり直し、選択行のループ試聴、LRC のオフセット提案 | |
| L5 | JIZURA の同梱（`vendor/jizura/`、エディタ UI と書き出しを除いたエンジン、LICENSE・元コミット明記、遅延読み込み）とアダプタ（seed 固定のため `Math.random` を一時的に差し替え、`J.computeTiming` を包んで `lineEnds` を反映）。E2E（同じ seed → 同じ画像）。ビジュアライザーの E2E もここで作る | |
| L6 | Host の描画順に歌詞の層を追加（プリセット → PostFX → 歌詞 → オーバーレイ）、プレビュー（縮小・簡易描画）と書き出し（全解像度）、モーション設定の最小 UI、見た目の確認と 3 秒の MP4 | |

L1 の要点:
- **行番号の数え方は JIZURA と完全に同じにする**（`lineTimes` のキーが行番号なので、ずれると別の行に時刻が付く）。移植時に、実物の `J.parseLyrics` / `J.computeTiming` を Node で動かして、同じ入力で同じ結果になることを確認した（一回限りの確認。L5 で同梱したあとは Vitest の比較テストにする）。
- SRT は JIZURA が扱わないので、LRC に変換してから渡す（`srtToLrc`、字幕内の改行は手動区切り `/`）。字幕の終了時刻は `parseLyricsSource(...).srtEnds` で取れる（`lineEnds` の初期値用）。
- `lineEnds` は ZUNZUN の拡張。終了は次の行の開始より後ろに伸ばさず、開始 + 0.35 秒より短くしない。
- Project JSON の `lyrics.motion` は L5 で項目を決めるまで空（読み込み時もすべて捨てる）。

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
