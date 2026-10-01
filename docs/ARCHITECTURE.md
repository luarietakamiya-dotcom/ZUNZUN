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
                  ├→ BackgroundCompositor (背景の一枚絵・動画)
                  └→ OverlayManager (画像レイヤー群)
                  → Compositor(Three: 奥=背景 / preset / 中=lyric texture / 前=overlay) → Canvas
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
  "background":{"ref":"assets/sky.jpg","sha256":"…","kind":"image","fit":"cover","dim":0.35,"blur":0,"blend":"screen","visualizerOpacity":1,"loop":true},
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
- **Speaker Rack**（2026-09-30 追加。ユーザーの参考画像②③）：並び「ラックとスピーカー」は左右の大きなスピーカーと真ん中の機材ラック。bass でウーファーのコーンが重さのあるばねで前後（行き過ぎて戻る）、high でツイーター、帯域でスペクトラムの LED（ピークの点が残る）とイコライザーの LED、音量で VU メーターの針（慣性）・赤いランプ・真空管。並び「スピーカーの通路」は通路の両側にスピーカーを積み上げ、コーンが手前から奥へ少しずつ遅れて動く（低音の波が奥へ伝わる）。照明ありの材質（MeshStandardMaterial）と RoomEnvironment の映り込みを使う初めてのプリセット。光るのは小さな LED・ランプ・真空管・細い帯・灯りだけ。
- **写真に動き (Photo Motion)**（2026-09-30 追加）：用意された 3 枚の写真を画面いっぱいに映し、シェーダーで効果を付ける（スピーカーの所が低音でふくらむ、明るい所だけが音量で光る、写真のスペクトラムの LED が帯域で伸び縮み、ステージの照明が拍で左右交互に、スモーク）。効果の位置は写真ごとに決めて photos.ts に持つ。乱数は使わない。2026-10-01: 場面 = 層の重なりにして、ユーザーの切り抜きの絵から組み立てる場面 2 つ（ラックとスピーカー: 明かりが静かなときは消え音で点く / 通路: 照明とスモークの層が音で点く）を足した。

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
     - **2026-10-01 変更 (ユーザー指示「吸着してる？ちょっと使いづらい」)**: ドラッグの吸着は最初は切っておき、タイムラインの下のチェック「ドラッグで吸着する」で入れる。Shift (Alt から変更済み) を押している間は逆。
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

## ビジュアライザーごとの設定（2026-09-30 ユーザー承認、`core/visualizer/preset-params.ts`）
- プリセットは manifest の `controls`（`PresetControl`: つまみ `range` か選択 `select`。名前と説明は日英）で自分だけの設定を宣言できる。Visualizer タブの「このビジュアライザーの設定」に出る。
- 値は Project JSON の `visualizer.params` に **プリセットの id ごと**に保存する（別のプリセットに切り替えて戻っても残る）。使うときは `resolvePresetParams` でその一覧に合わせて直す（知らない名前は捨て、範囲に収め、選べない値は既定）。
- 描くときは、共通の設定と合わせて update() の params に同じ名前で入る（プレビューも書き出しも）。
- 最初の利用: Live Stage のカメラ（場所 5 つ: 客席の後ろ / 最前列 / 真横 / 上から / ステージの奥から、高さ・距離・左右の向き）。
- Live Stage の「光を客席へ」（`towardCrowd` 0..1。既定 0 = 今までと同じ）。ライトを客席側へ大きく傾け、カメラを向いた瞬間はライトの玉が大きく明るくなり光条が出る。**まぶしさは B（ユーザー承認）**: 向いた瞬間だけ画面全体が少し明るくなる（上限 0.1、多くても 0.75 秒に 1 回、0.3 秒ほどで引く。向いたままでも明るいままにしない）。光の筋はカメラの近くほど薄く（6 より遠ければ変わらない）、カメラへまっすぐ向いた筋も薄くして、画面を覆って白くならないようにする。レーザーもカメラの手前で終わらせる。

- Live Stage の「ステージの機材」（`stageSet`: `none` / `band`。**既定 none = 今までどおり照明だけ**。ユーザー承認 2026-09-30「A」: 保存済みのプロジェクト・書き出しの絵を変えない）。`src/visualizers/live-stage/stage-set.ts` にまとめる。band: 格子のトラスと左右の柱（門の形。今までの横棒と置き換える）、左右の黒い幕、奥のドラムの台（④-1）→ ドラム・アンプ・マイク（④-2、`band-gear.ts`。bass でバスドラムの面・スピーカーのコーン、high でシンバル、音量で LED）→ 足す照明（④-3、`uplights.ts`: 奥の壁ぎわのアップライト 6 台と壁の色づき。機材の後ろの床の灯り・マイクの足もとの灯りは band-gear.ts）。機材の形に `ctx.rng` は使わない（引く回数が変わると照明のパターンがずれるため）。

## 光過敏への配慮の見張り（2026-09-30、`tests/e2e/flash-safety.spec.ts`）
- すべてのプリセット（と Live Stage の「光を客席へ」1 の客席の後ろ / 最前列 / 真横）を、120 BPM の強い拍・低音（いちばん光りやすい条件）で 8 秒ぶん 1 コマずつ描き、明るさ（相対輝度）を測る。
- 「光った」= 0.2 秒以内に画面の 25% 以上の画素が 0.1 以上明るくなったとき（ガイドラインの「広い範囲の大きな明るさの変化」に近い数え方。正式な検査の代わりではない）。**どの 1 秒でも 3 回まで**、真っ白に近い画素が画面の 25% を超えないこと。
- 新しいプリセットを足したら、この一覧にも足す。

## レイヤー（画面の重なる順番）（2026-09-30 ユーザー承認、`core/render/composition.ts`・`screen-capture.ts`・Host の render）
- `CompositionSettings { order, hidden, visualizerBlend, visualizerOpacity, lyricsOpacity }` を Project JSON の `composition` に保存する。順番は奥 → 手前。決まったレイヤーは `background` / `visualizer` / `lyrics` / `overlays`、素材は `media:<id>`（次の段階）。
- ビジュアライザーの重ね方・濃さは、以前は `background.blend` / `visualizerOpacity` にあった。背景が無くても下に素材を置けば要るので composition に移した。古いプロジェクトは読み込むときに移す（`normalizeComposition` の legacy）。
- 描き方（Host.render）:
  - **ビジュアライザーより奥が背景だけ（既定の並び）**: 今までどおり、ビジュアライザーを画面へ直接描いてから背景を上から重ねる（fast）。見た目は作り直す前と画素まで同じ（6 通りで差 0 を確認）。
  - **それ以外**: ビジュアライザーを画面へ描いてから写し取り（`copyFramebufferToTexture`。画面の値そのまま = 色の変換なし）、画面を消して奥から順に重ね直す。背景は不透明に、ビジュアライザーは写し取った絵を重ね方どおりに、歌詞・重ねる画像は今までどおり画面へ描く。
  - ビジュアライザーを画面の外へ直接描かないのは、PostFX の最後の Bloom が画面へ描くときだけ色を変換するため（背景の方針と同じ理由）。
  - **画面の透明度（alpha）は 1 のまま触らない**。「そのまま上に」で透明度まで混ぜると、ブラウザが canvas を画像にするときに色を alpha で割り、明るく写った（1.3 倍）。
- プリセットは隠していても毎フレーム動かす（表示に戻したときに続きから）。
- **素材レイヤー**（`core/render/media.ts`、Project JSON の `media`、順番の中では `media:<id>`）: 画像・動画を好きな位置・大きさ・回転・濃さで置く。重ね方は「そのまま上に / スクリーン / 加算」。中身は保存せず ref + sha256 だけ（背景・オーバーレイと同じ）。動画は背景の動画と同じ仕組み（プレビューはブラウザの動画を曲の時刻に合わせ、書き出しは各フレームの時刻ちょうどの絵）。透明な部分がある PNG・WebM（VP9 + alpha）はその透明度も使う（書き出しは Mediabunny の `CanvasSink({ alpha: true })`）。
- **クロマキー**（`core/render/chroma.ts`。GPU の式と同じものを TypeScript でも持ち、Vitest で確かめる）: 「透かす色らしさ」= 透かす色でいちばん強い成分（緑）がほかの成分よりどれだけ強いか ÷ その成分、で測る（明るさで割るので、影の暗い緑も透ける。YCbCr の色みの距離では暗い緑が透けなかった）。透かす範囲・境目のぼかし・にじみ取り（強い成分をほかの成分まで下げる）。ほぼ黒い画素は透かさない。透かす色はサムネイルを押して拾う（スポイト）か、色の欄で選ぶ。
  - 2026-09-30 やりやすく（ユーザー「グリーンバックのこっちゃう」）: 「自動で合わせる」（`autoChroma`: 絵全体から緑か青の強い画素を集め、多い方を背景の色に。とくに色の強い半分の平均を透かす色にし、背景の画素の 95% が完全に透ける範囲にする。0.15〜0.75 に収める）、「縁を削る」（`choke` 0..1 = 素材の画素で 0〜3 つぶん。まわり 8 方向の透明度のいちばん小さい値を使う = 残る所を内側へ削る。`erodeAlpha` と media.ts のシェーダー）、「透け具合を見る」（プレビューだけ。残る所を白・透ける所を黒で描く。`store.chromaPreviewId`、Project JSON には入れない。書き出しでは使わない）。新しい素材の既定値を 範囲 0.4・ぼかし 0.12・にじみ取り 0.8・縁を削る 0.35 に。前のプロジェクトは保存された値のまま（縁を削るは無いので 0）。

## 表記の言語（日本語 / English）（2026-09-30 ユーザー承認、`core/i18n.ts`）
- ヘッダーの「日本語 / EN」で切り替える。既定は日本語。選んだ言語はこのブラウザ（localStorage `zunzun.lang`）に覚え、Project JSON には入れない。
- 文言は使う場所で `tr('日本語', 'English')` と書く（キーの一覧は持たない）。設定の一覧は `{ ja, en }`（`Text2`）で持ち、作るときに `t2()` で選ぶ。
- 切り替えると、シェルがタブ名と今のタブを作り直す（パネルは作るたびに tr を呼ぶ。再生欄は文字だけ付け直す）。
- ユーザー要望「誰が見てもわかりやすく、光の強さとか説明をかねて」: 日本語ではタブ名・設定の名前も日本語（「光の強さ」「音への反応のしやすさ」など）にし、つまみの下に何が変わるかの短い説明を付ける（英語でも同じ）。
- 画面に出るエラー（core が投げるもの）も訳す。ファイル選びのボタン（Choose File）はブラウザが描くので、ブラウザの言語のまま。

## ビジュアライザーの見え方（拡大・位置・傾き）（2026-09-30 ユーザー承認、`core/render/view.ts`）
- どのプリセットにも共通の「見え方」`ViewSettings { zoom, x, y, roll }` を Project JSON の `visualizer.view` に保存する（古いプロジェクトには無く、読み込むと既定 = 何も変えない）。
- Host が描く直前にプリセットのカメラへ当て、描いたら戻す（プリセットは知らない。プリセットの作り方の約束は変わらない）。
  - 拡大・位置はカメラの見る窓（`setViewOffset`）。大きな画面の一部を描くので、拡大しても粗くならない。1 より小さいと見える範囲が広がる。
  - 傾きはカメラを視線の軸のまわりに回す（正 = 映る絵が反時計回り）。
- 背景・歌詞・オーバーレイには効かない（ビジュアライザーだけ）。画面の一部に小さく置く（ピクチャー・イン・ピクチャー）は、次のレイヤー化で扱う。
- 進め方（ユーザー承認）: ① 見え方（済）→ ② レイヤー化（済: 並べ替え・表示/非表示・重ね方）とグリーンバックの素材（計画承認済み）→ ③ Live Stage のカメラと奥から手前へ来る照明（済）。あわせて（済）、メニューの表記を英語と日本語で切り替えられるようにする。

## 用意された背景（2026-09-30 ユーザー承認「3 枚をリポジトリに入れて」、`core/library.ts`）
- アプリと一緒に配る背景の画像。`src/assets/library/*.webp`（ユーザーが用意した 3 枚: ライブステージ・スピーカーと機材ラック・スピーカーの通路。元の PNG 約 2.4MB を WebP 品質 0.88 で 200〜320KB に）。同じサーバーから読むだけで、外部には送らない。
- 一覧 `LIBRARY`（id・名前（日英）・URL・sha256・ファイル名）。sha256 はファイルと突き合わせる試験がある（ファイルを差し替えたら一覧も直す）。
- Project JSON には、ほかの背景と同じく中身を入れず、`ref = library:<id>` と sha256 だけ。開いたとき、ref と sha256 が一覧と合えば自動で読み込む（`store.restoreLibraryBackground`。読んでいる途中に別の背景を選んだら上書きしない）。合わなければ今までどおり「選び直してください」。
- 「背景と素材」タブの背景の欄に、サムネイルの列「用意された背景から選ぶ」。

## 背景（一枚絵・動画）の方針（2026-09-29 ユーザー承認、`core/render/background.ts`）
- 見た目の順番は **背景 → ビジュアライザー → 歌詞 → オーバーレイ**。背景には Bloom をかけません（明るい写真が白飛びしないように）。
- プリセットは背景を不透明な黒で塗るので、**プリセットには手を入れず合成で解決します**。ビジュアライザーは今までどおり画面へ直接描き、その上から背景を重ねます。重ね方は「スクリーン」（既定。黒は透けて光だけが乗る）・「加算」・「そのまま上に」（濃さで透かす）。スクリーンと加算はどちらが上でも同じ結果になるので、この順で描いても見た目は「背景が奥」になり、ビジュアライザーの色は背景なしと完全に同じです。
- 背景の設定（収め方・暗さ・ぼかし・重ね方・ビジュアライザーの濃さ・動画のくり返し）は Project JSON 最上位の `background`。中身は保存せず ref + sha256 だけ（オーバーレイと同じく読み込み後に選び直す）。
- 進め方: ①一枚絵（済）→ ②動画（済。プレビューはブラウザの動画を曲の位置に合わせ、書き出しは Mediabunny で各フレームの時刻ちょうどの絵を取り出す。動画の音は使わない。パッケージの追加なし）→ ③必要なら時刻を決めて差し込む動画（ユーザーは今回 ② まで = 「背景として動画を流す」を選択）。

## オリジナルの歌詞モーション（演出パック）の方針（2026-09-29 ユーザー承認、`core/lyrics/packs/`）
- 曲調に合わせたスタイルを ZUNZUN で作る（静か・激しい・ロック・動画に寄り添う から。あとで増やす）。**演出そのものもオリジナル**で、1 スタイルにつき 8〜12 個を登場・退場・表示中の動き・装飾・カメラなどにまたがって作る。
- 1 つのパック = スタイル（配色・書体・質感・演出の選ばれやすさ）+ そのスタイルのときだけ出るオリジナルの演出 + 使わない JIZURA の演出の決まり（例: 静かな曲ではグリッチ・揺れ・フラッシュを使わない）。
- **JIZURA は改変しない**。演出は `J.register` で足し、JIZURA の「部品セット」に入れる（そのパックのスタイル、またはそれを元にしたマイスタイルのときだけ候補に入る）。既存のスタイルのカット割りは 1 つも変わらない（テストで確かめる）。
- 守ること: 同じ seed なら同じ絵（乱数は JIZURA の `J.r` だけ）、ビジュアライザーを覆いすぎない、点滅は毎秒 3 回まで。
- 「動画に寄り添う」は小さくするだけにしない: 背景の色を読み取って文字の色に使う、文字の後ろに板を敷かない、中央を空ける、画面全体の効果を使わない、動きを映画の字幕に寄せる。
- **レイアウト（画面の組み方）もオリジナルで作る**（2026-09-30 ユーザー要望。「図案 (ZUNZUN)」から。いずれ JIZURA のレイアウトを使わなくても済むくらい増やす）。レイアウトも `J.register('layout', …)` で足し、JIZURA 本体は改変しない。
- 進め方: ① しくみ + 静か（済）→ ② 激しい・ロック（済）→ ③ 動画に寄り添う（背景の色の読み取りを含む。済）→ ④ 追加（ポップ（済: 弾む）・シティポップ・ドリーミーなど、BPM と音の強さからのおすすめ）。

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
