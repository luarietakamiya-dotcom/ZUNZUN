# ZUNZUN アーキテクチャ設計（Phase 1 確定版）

## Context
- ZUNZUNは、音源を読み込み、完成済みの「世界観プリセット」を選ぶだけで音楽に反応する映像を作れるツールです。後から歌詞モーション（Lyric Motion）とオーバーレイも重ねられるようにします。
- 実行形態はローカル完結のブラウザアプリ（Chrome/Edge）です。動画の書き出しにはMediabunnyを使います。どちらもユーザー確認済みです。
- 参照元の [852wa/JIZURA](https://github.com/852wa/JIZURA) は v0.9.0（調査時点のcommit `bae339e`）、MIT、© 2026 hakoniwa、約36,600行です。プレーンJSのCanvas2Dエンジンで、`window.J` にまとまっています。
- この文書はPhase 1（設計）で確定した内容です。設計を変える場合はPlan Modeに戻り、このファイルを更新します。

## 1. 全体アーキテクチャ
```
[Audio File] → AudioEngine ─(offline解析)→ AudioTimeline(60Hz, 全曲分)
                     └─ 再生(AudioContext) → 現在時刻 t
t ─→ FrameClock ─→ AudioTimeline.at(t) = AudioFrame
                  ├→ VisualizerHost → 現在のPreset.update(frame) → THREE.Scene → PostFX(bloom/rays)
                  ├→ LyricLayer (JIZURA Renderer.frame(ctx, plan, t, {transparent}))  ※MVP外
                  └→ OverlayManager (画像レイヤー群)
                  → Compositor(Three: 背景=preset / 中=lyric texture / 前=overlay) → Canvas
Export: 同じ FrameClock を fps 刻みで回す → VideoFrame → Mediabunny(MP4/WebM) / PNG連番
```
設計の軸：
- **解析は事前（offline）、描画は時刻駆動**です。プレビューと書き出しがまったく同じ `AudioFrame` を読むので、同期ずれが原理的に起きません。JIZURAの `J.analyzeAudio`（先に全曲を解析）と `Renderer.frame(ctx, plan, t)`（時刻で描画）と同じ考え方です。
- **決定性**：`project.seed` からプリセットごとの乱数を派生させます（mulberry32。JIZURA `src/01_util.js` の `J.rng`、`J.h` を移植）。描画中に `Math.random` は使いません。
- **プリセットは互いに独立**させます。各プリセットは自分のScene、Camera、PostFX設定を持ちます。共有するのはRendererとAudioFrameだけです。

## 2. モジュール分割
| モジュール | 責務 |
|---|---|
| `core/audio` | デコード、オフライン特徴抽出（FFT → bass/mid/high/rms/peak/beat/spectralEnergy/flux + 64帯域、歌詞同期用の歌声らしさとonset）、BPM・ビートグリッド、再生と時刻の管理 |
| `core/clock` | preview（再生同期）とexport（固定fps）で共通のフレーム時計 |
| `core/visualizer` | `VisualizerPreset` 型、Registry（フォルダ追加で自動登録）、Host（生成、切替、resize、dispose） |
| `core/render` | WebGLRenderer、PostFXスタック、Compositor |
| `core/overlay` | 画像レイヤー（position/scale/rotation/opacity/order/glow/float/beat） |
| `core/project` | スキーマ、`version`、migrate、検証（読み込むファイルは信頼しない前提。JIZURAの `mergeProject` と同じ方針）、save/load |
| `core/assets` | 素材の参照管理（相対パスとsha-256）、IndexedDBキャッシュ、再リンク |
| `core/export` | WebCodecs + Mediabunny、PNG連番（zip） |
| `core/lyrics`（MVP後） | LRC/SRTパーサ、半自動タップ同期（歌い出しへの吸着）、タイムライン編集、JIZURAアダプタ |
| `ui` | Music / Visualizer / Lyrics / Overlay / Settings / Export の6パネル |
| `visualizers/<id>/` | プリセット本体（1フォルダで完結） |

### Visualizer 共通インターフェース
```ts
interface AudioFrame { t; dt; bass; mid; high; rms; peak; beat /*0..1 減衰パルス*/; beatIndex; spectralEnergy; flux; bands: Float32Array /*64*/ }
interface CommonParams { intensity; sensitivity; bass; mid; high; glow; motion; colorTheme; cameraMotion }
interface VisualizerManifest { id; name; thumbnail; version; paramsSchema /*固有パラメータ*/; defaults; post: PostConfig }
interface VisualizerPreset {
  init(ctx: { renderer; width; height; seed; params; rng }): Promise<void> | void
  update(frame: AudioFrame, params): void   // scene/cameraを更新するだけで、描画はHostが行う
  resize(w, h): void
  dispose(): void
  readonly scene: THREE.Scene; readonly camera: THREE.Camera
}
```
- 感度の補正（sensitivity、bass/mid/high倍率）は、Hostが `AudioFrame` を渡す前に適用します。プリセット側は常に0..1の値を受け取ります。
- 状態を持つプリセット（粒子など）のシーク時は、Hostが `prewarm(t)` を任意で呼びます。書き出しは0秒から順番に描画するので、状態を持っていても再現性は保てます。

## 3. 技術選定
| 項目 | 採用 | 理由 |
|---|---|---|
| 言語/ビルド | TypeScript + Vite | 型でプラグイン契約を固定します。`import.meta.glob` でプリセットを自動登録できます |
| 3D | Three.js（WebGL2の `WebGLRenderer`） | 実績があり、書き出し時のcanvas → VideoFrameも安定しています。WebGPUは将来の選択肢として残します |
| PostFX | `three/addons` の EffectComposer + UnrealBloomPass、Light Raysは自作のradial blurパス | 依存を増やさないためです。不足したら pmndrs/postprocessing（zlib）を検討します |
| UI | Vanilla TS（小さなstoreとDOMヘルパー） | 初期UIは6パネルと単純なので、フレームワークは不要です |
| 書き出し | WebCodecs + **Mediabunny**（MPL-2.0） | MP4(H.264/AAC)とWebM(VP9/Opus)を1つのライブラリで扱えます |
| テスト | Vitest（ロジック）+ Playwright（同梱Chromiumで描画スモーク） | |
| フォント | **Google Fonts から実行時に読み込む（2026-09-28 にユーザー決定で変更）** | 当初は「OFLフォントをローカル同梱」でしたが、日本語フォントは 1 書体で数 MB あり、JIZURA の 23 書体を同梱すると数十 MB になるため変更しました。**外部通信を許すのはフォントの取得だけ**です（JIZURA の実装どおり、歌詞モーションが実際に使う書体だけを fonts.googleapis.com / fonts.gstatic.com から読み込みます）。音源・画像・歌詞などのユーザーデータは送信しません。ユーザーが自分のフォントファイルを読み込む機能（JIZURA の `J.loadFontFile`）も使えます |

**FFmpegとWebCodecsの比較**：WebCodecsはGPUエンコードが使えて高速で、追加ダウンロードもありません。MP4/WebMはこちらを主軸にします。ffmpeg.wasmは約30MBと大きく、処理も遅く、x264を含むビルドはGPLになるため採用しません。AE向けの透過素材はPNG連番を基本にします。ProRes 4444が必要になった場合は、書き出したPNG連番を手元のネイティブFFmpegで変換する手順をドキュメント化して対応します。透過WebM（VP9 alpha）はブラウザのサポート状況を実装時に確認し、使えれば追加します。

## 4. JIZURAから再利用・参考にできる部分
| 対象 | 扱い |
|---|---|
| `src/01_util.js`（イージング、hash、`J.rng`） | TSへ移植して再利用します（MIT表記あり） |
| `src/10_audio.js`（エネルギー、onset、自己相関BPM、位相） | BPMとビート検出のロジックを移植して再利用します。帯域分解（bass/mid/high）は新規に書きます |
| `src/05b_registry.js`（`J.register` 方式） | 設計を参考にします。Visualizer Registryの型付き版として作ります |
| `J.defaultProject` / `mergeProject` / `timing.lineTimes` / `seed` | Project JSONの構造と検証方針の参考にします |
| `src/08_planner.js` `J.parseLyrics`（LRCタグ、`[間奏]`、`*強調*`） | 歌詞パーサとして移植します（MVP後） |
| タップ同期（`12_ui.js` startTap/tapNow/tapBack） | Space/Enter/Backspaceの操作系をそのまま参考にします |
| **歌詞モーション本体**（layout/enter/hold/exit/treat/decor/bg/cam/fx/trans、`Renderer.frame(ctx, plan, t, {transparent})`） | `vendor/jizura/` に**改変最小で同梱**します。OffscreenCanvasに透過描画し、Threeのテクスチャとして合成します。3.6万行を再実装しなくて済み、AE用jsxとも互換を保てます |
| `11_export.js`（codecの候補順、HW → SWフォールバック、bitrate上限） | 書き出しロジックの参考にします |

## 5. ライセンス上の注意
- JIZURA（MIT）：移植、同梱したファイルには著作権表示とMIT全文を残します（`vendor/jizura/LICENSE`、`THIRD_PARTY_NOTICES.md`）。改変した場合はファイル冒頭にその旨を書きます。
- Mediabunny（MPL-2.0）：改変せずnpm依存として使います。改変した場合、そのファイルは開示が必要です。NOTICEに記載します。
- Three.js（MIT）、フォント（OFL-1.1）：NOTICEに記載します。
- **Suno連携**：LYRIMOのブックマークレットは、Sunoのセッショントークンを読み取って非公式APIを呼んでいます。規約や仕様変更のリスクがあるため採用しません。Suno曲は手動でダウンロードしたファイルとして扱います（「歌詞同期の方針」を参照）。
- 生成物の権利は音源と画像の権利者にあります。この旨をREADMEに明記します。

## 6. MVPの範囲
対象：音源読み込み、Audio Analyzer、Visualizer Preset Manager、Solar Gate、Milky Way、Live Stage、PNG Overlay、Project Save/Load（ユーザー指定どおり）。
- プレビュー再生（再生、停止、シーク）と、共通パラメータ9項目の最小UIを含みます。
- 書き出しは基盤のみです。MP4を1本出せるところまで作ります（Phase 2のExport基盤）。
- 対象外：歌詞（Lyric Motion、半自動同期、タイムライン編集）とWebM/PNG連番は、MVPのあとに作ります。Sunoのブックマークレットと、AIによる歌詞の自動アライメントは作りません。

## 7. 実装順序（1ステップごとにビルド、テスト、コミット）
0. `docs/ARCHITECTURE.md` と、ライセンス、NOTICEの雛形をコミットします ← 承認後の最初の作業
1. Viteの足場（TS、ESLint、Vitest、Playwright）と空のUIシェルを作ります
2. AudioEngine：デコード → オフライン特徴抽出 → AudioTimeline、再生と時刻管理
   - テスト：合成信号（60Hzのサイン波 → bass優位、クリック列 → beat/BPM）で検証します
3. Visualizer Registry + Host + 型 + デバッグ用プリセット（帯域を棒で表示）
4. PostFX（bloom、light rays）とCompositor
5. Project JSON：スキーマ、migrate、検証、Save/Load、素材参照
6. Overlay Manager（PNG/WebP/JPG、変形、glow/float/beat）
7. Export基盤（WebCodecs + Mediabunny、MP4）
8. Solar Gate → 9. Milky Way → 10. Live Stage（Phase 3。1つずつ追加します）

## 8. ディレクトリ構成
```
zunzun/
  docs/ARCHITECTURE.md  docs/PROJECT_FORMAT.md  docs/ADDING_A_VISUALIZER.md
  public/fonts/
  src/
    main.ts
    core/{audio,clock,visualizer,render,overlay,project,assets,export,lyrics}/
    ui/{panels,components}/
    visualizers/
      _debug/  solar-gate/  milky-way/  live-stage/
        index.ts (manifest+factory)  preset.ts  shaders/*.glsl  thumbnail.webp
  vendor/jizura/ (MVP後、LICENSE同梱)
  tests/{unit,e2e}/
  THIRD_PARTY_NOTICES.md  LICENSE  package.json  vite.config.ts
```

## Project JSON（`*.zunzun.json`）概要
```json
{ "format":"zunzun-project","version":1,"app":"0.1.0","seed":20260927,
  "audio":{"ref":"assets/song.mp3","sha256":"…","name":"…","duration":213.4,"sampleRate":48000,"bpm":128},
  "visualizer":{"preset":"solar-gate","presetVersion":1,"common":{"intensity":0.8,"sensitivity":0.6,"bass":1,"mid":1,"high":1,"glow":0.7,"motion":0.6,"colorTheme":"gold","cameraMotion":0.4},"params":{}},
  "overlays":[{"id":"ov1","ref":"assets/logo.png","sha256":"…","x":0.5,"y":0.8,"scale":0.3,"rotation":0,"opacity":1,"z":10,"glow":0,"float":0,"beat":0.2}],
  "lyrics":{"engine":"jizura","source":"lrc","text":"…","timing":{"lineTimes":{},"lineEnds":{},"snap":true,"snapWindowMs":150},"motion":{…JIZURA project subset…},"stem":{"ref":"vocal.wav","sha256":"…","enabled":true}},
  "colors":{},"fonts":{},
  "export":{"width":1920,"height":1080,"fps":60,"format":"mp4","quality":"high","transparent":false} }
```
- 素材は埋め込まず、`ref`（プロジェクトフォルダからの相対パス）と `sha256` で参照します。File System Access APIでフォルダを扱い、IndexedDBをキャッシュにします。見つからない場合は再リンクのUIを出します。
- 座標は正規化（0..1）して保存し、アスペクト比が変わっても崩れないようにします。
- 読み込み時の検証：色はhex、キーは `[\w-]+`、数値はclamp、未知のキーは破棄します（JIZURAの `mergeProject` と同じ方針）。

## プリセット初期3種の反応設計
- **Solar Gate**：円環そのものは拡大縮小しません。bassで円周から光線が伸び（放射状のインスタンスとshaderの長さ）、beatで光柱がフラッシュし、highで粒子が放出されます。鏡面床（Reflector）とbloomを使います。
- **Milky Way**：highで星のきらめき、midで天の川の輝度、beatで流星が発生（seedで決定）、rmsで湖面の反射の揺らぎが変わります。
- **Live Stage**：ムービングライトをbeat同期のパターンで振り、bassでスモークの濃度（ボリューム風のコーン）、highでレーザーのストロボが反応します。

## 歌詞同期の方針（MVP後、`core/lyrics`）
**決定：LYRIMOやSunoのブックマークレットは使いません。**「半自動タップ＋タイムラインでの後調整」を標準にします。AIは使いません。

入力
- 歌詞テキスト（貼り付け）、LRC、SRTを受け付けます。
- Suno曲も、ユーザーが自分でダウンロードした音源と、コピーした歌詞テキストを読み込むだけで扱えます。Sunoのサイトには一切アクセスしません。

1. **半自動タップ同期**
   - 再生しながら Space/Enter で各行の頭を叩きます。Backspaceで1つ戻り、Escで中断します（JIZURAのタップ操作と同じ）。
   - 叩いた時刻は、±150ms以内にある「歌い出し候補」へ自動で吸着します。候補がなければビートに吸着し、それもなければ叩いた時刻をそのまま使います。
   - 吸着のオン/オフと吸着範囲は設定で変えられます。
   - 歌い出し候補は、Audio Engineが作る**歌声らしさ（vocal activity）**から求めます。中央定位を強調し、300Hz〜3kHz帯のエネルギーとその立ち上がりから計算します。
2. **タイムラインで後調整**
   - 表示する段は、波形、歌声らしさ、ビートグリッド、歌詞の行ブロックです。
   - 行ブロックは、開始位置と終了位置をドラッグで動かせます。ドラッグ中も吸着が効き、Alt/Optionを押している間は吸着しません。
   - 矢印キーで微調整できます（10ms、Shiftを押すと100ms）。
   - 選択した行、または全体をまとめて前後にずらせます（全体オフセット）。
   - 取り消しとやり直しに対応します（Ctrl/Cmd+Z/Y）。
   - 行を選ぶとその少し前から再生し、ループ試聴できます。
   - **ボーカル stem（2026-09-29 ユーザー承認）**: ボーカルだけの音源を読み込むと、歌い出し候補をそこから拾います（伴奏の同じ帯域の楽器の出だしを候補にしないため）。ビートは元の曲から取り、再生・ビジュアライザー・書き出し・小節の吸着は元の曲のままです。stem の中身は保存せず、`lyrics.stem` にファイル名と sha256・使うかどうかだけを保存します（プロジェクトを読み込んだら選び直す）。
3. **既存のLRC/SRTの自動オフセット補正**
   - 読み込んだタイミングが全体的にずれている場合に使います。歌声らしさとの相互相関から全体オフセットを1つ推定し、提案します。適用するかどうかはユーザーが決めます。

保存
- 手で決めたタイミングはすべて `lyrics.timing.lineTimes`（行の開始）と `lineEnds`（行の終了、任意）に保存します。形式はJIZURAと互換で、LRCのタグより優先します。
- 歌声らしさなどの解析結果はプロジェクトに保存しません。音源から毎回、同じ結果を再計算できるためです。

MVPへの影響
- Audio Engine（Step 2）で、歌声らしさとonsetの時系列も一緒に計算します。後から歌詞機能を足しても、Audio Engineを作り直さずに済みます。

## 変拍子（リズム）の方針（2026-09-29 ユーザー承認、`core/rhythm`）
自動のビート検出は「1 つのテンポの等間隔グリッド」なので、変拍子（5 拍子・7 拍子・途中の拍子変更・3+3+2 のような不規則なまとまり）を表せません。そこで小節と拍子はユーザーが決めます。

- **小節の頭は、再生しながらタップして決めます**（歌詞のタップと同じ操作）。数小節叩けば、残りや間を同じ長さの小節で埋められます。叩いた時刻は、音の立ち上がり → 自動検出のビートへ吸着します。
- **拍子は、拍のまとまりで書きます**（`2+2+3` = 7 等分を 2・2・3 にまとめる、`4` = 4 等分）。区間ごとに「この小節から」と指定できるので、途中で拍子が変わる曲も扱えます。
- 小節の頭と拍子から「拍（まとまりの頭）の並び」と「小節の頭（アクセント）」を作ります。拍の間隔は不規則になります。
- Project JSON の最上位に `rhythm`（オン/オフ・小節の頭の時刻・区間ごとの拍子）を保存します。曲全体の設定なので歌詞の中には置きません（将来ビジュアライザーでも使えるように）。
- **今回の対象は歌詞モーション**です。ビジュアライザー（`AudioFrame`）は変えません。
- 歌詞モーション（JIZURA）には、変拍子モードのときだけ、自動検出のビートの代わりにこの拍の並びを渡します。あわせて「何小節目・何番目のまとまり・小節内の何拍目」を plan のデータに添えます。
- **JIZURA は改変しません。** 変拍子向けの演出は、JIZURA が用意している拡張の仕組み `J.register` で ZUNZUN 独自の演出として追加し、それを選びやすくする変拍子用スタイルを作ります（独自の演出は JIZURA の「部品セット」に入れ、変拍子モードがオンで変拍子用スタイルのときだけ候補に入れる。既存のスタイルでは候補の一覧にも入らないので、カット割りは 1 つも変わらない。R4 の実装時に、重み 0 だけでは JIZURA の抽選の誤差で選ばれうると分かったためこうした）。JIZURA の中の「4 拍でひと回り」前提の演出は、変拍子用スタイルでは選ばないようにします。本家の更新はこれまでどおり取り込めます。
- 進め方: R1 データと計算 → R2 画面（タップ・拍子の指定・タイムラインの小節線）→ R3 JIZURA とつなぐ → R4 変拍子パック（独自の演出と変拍子用スタイル）。

## Verification
- 各ステップで `npm run build`、`npm run lint`、`npm test`（Vitest）を実行します。
- Audio：合成WAVのfixtureで、帯域比、BPM誤差1%以内、ビート位置の誤差20ms以内を確認します。
- Visualizer：Playwrightでプリセットごとに一定時刻のフレームを描画し、真っ黒でないことと、同じseedなら同じ画像になることを確認します。
- Project：save → load → save の往復で内容が変わらないこと、不正なJSONを拒否すること、旧versionをmigrateできることを確認します。
- Export：3秒のMP4を書き出し、長さとフレーム数を確認します。音ズレはクリック音とフラッシュ映像のテスト素材で目視確認します。
- 各フェーズの終わりに、作業内容、変更ファイル、テスト結果をまとめます。

## 運用メモ
- Phase 2以降は **Claude Sonnet 5 + 通常モード** の想定です。モデルの切り替えはユーザー側で行ってください（私からは切り替えられません）。
- パッケージ追加（three、mediabunny、vite、vitest、playwright、typescript、eslint）は、Step 1の前に一覧と理由を示してから実行します。
- pushは毎回確認を取ってから行います。対象はZUNZUNリポジトリのみです。
