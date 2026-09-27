# 引き継ぎメモ（Cloud Session → ローカル Claude Code）

最終更新: 2026-09-27（Cloud Session での作業終了時点）。
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
| Step 9 | プリセット **Milky Way** | push 済み。**ユーザーのローカル確認待ち** | `0ee8a0d` |
| Step 10 | プリセット **Live Stage** | **次の作業** | — |

最後に確認できたテスト結果: 10 ファイル / 83 テストすべて成功（Cloud Session 上で実物の three.js r180 を使って実行）。

## 次にやること

1. **Milky Way のローカル確認**（ユーザーにお願いしている段階）: `npm run build` / `lint` / `test`（10 ファイル 83 件）と、Visualizer タブで曲を流しての見た目。
2. **Step 10: Live Stage**（`docs/ARCHITECTURE.md`「プリセット初期3種の反応設計」）
   - beat 同期のパターンでムービングライトを振る
   - bass でスモークの濃度（ボリューム風のコーン）
   - high でレーザーのストロボ
   - Solar Gate / Milky Way と同じ作り方: `src/visualizers/live-stage/`（`index.ts` / `preset.ts` / `palette.ts` / `shaders.ts` / `live-stage.test.ts`）、`src/visualizers/index.ts` に 2 行追加、5 テーマ（default / gold / ice / neon / mono）、縦長 9:16 でも破綻しないカメラ。
3. Live Stage が終わったら MVP の機能はそろう。その先は下の「未解決の設計課題」と「MVP 後」をユーザーと相談する。

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
- **Mediabunny** は `package.json` が `^1.0.0` 指定で、どの版が入っているか Cloud Session から見えなかったため、どの 1.x でも通る `bitrate: QUALITY_*`（新しい版では非推奨）を使っている。`npm ls mediabunny` で版を確認したら `quality: new Quality('high')` に置き換えてよい。

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
