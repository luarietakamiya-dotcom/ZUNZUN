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
| `core/audio` | デコード、オフライン特徴抽出（FFT → bass/mid/high/rms/peak/beat/spectralEnergy/flux + 64帯域）、BPM・ビートグリッド、再生と時刻の管理 |
| `core/clock` | preview（再生同期）とexport（固定fps）で共通のフレーム時計 |
| `core/visualizer` | `VisualizerPreset` 型、Registry（フォルダ追加で自動登録）、Host（生成、切替、resize、dispose） |
| `core/render` | WebGLRenderer、PostFXスタック、Compositor |
| `core/overlay` | 画像レイヤー（position/scale/rotation/opacity/order/glow/float/beat） |
| `core/project` | スキーマ、`version`、migrate、検証（読み込むファイルは信頼しない前提。JIZURAの `mergeProject` と同じ方針）、save/load |
| `core/assets` | 素材の参照管理（相対パスとsha-256）、IndexedDBキャッシュ、再リンク |
| `core/export` | WebCodecs + Mediabunny、PNG連番（zip） |
| `core/lyrics`（MVP後） | LRC/SRTパーサ、タップ同期、JIZURAアダプタ |
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
| フォント | OFLフォントをローカル同梱 | JIZURAは実行時にGoogle Fontsへ接続します。ZUNZUNは外部通信をしない方針なので、この部分は変更します |

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
- **Suno Import**：非公式APIに依存します。LYRIMOのブックマークレットはSunoのセッショントークン（`__session` / clerk JWT）を読み、`studio-api.prod.suno.com` の `aligned_lyrics` を叩いています。規約や仕様変更のリスクがあるので、自己責任機能として分離し、MVPには入れません。
- 生成物の権利は音源と画像の権利者にあります。この旨をREADMEに明記します。

## 6. MVPの範囲
対象：音源読み込み、Audio Analyzer、Visualizer Preset Manager、Solar Gate、Milky Way、Live Stage、PNG Overlay、Project Save/Load（ユーザー指定どおり）。
- プレビュー再生（再生、停止、シーク）と、共通パラメータ9項目の最小UIを含みます。
- 書き出しは基盤のみです。MP4を1本出せるところまで作ります（Phase 2のExport基盤）。
- 対象外：歌詞（Lyric Motion、同期）、Suno Import、WebM/PNG連番、自動歌詞解析（ローカルでも実質AIモデルが必要なので、後から任意機能として追加します）。

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
  "lyrics":{"engine":"jizura","source":"lrc","text":"…","timing":{"lineTimes":{}},"motion":{…JIZURA project subset…}},
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

## Suno Import（MVP後）の安全設計
- ブックマークレットは曲ページ上で実行し、取得するもの（音源、歌詞、タイミング、曲名）をダイアログに明示してから動かします。
- 受け渡しは2通りです。①曲データ一式をファイルとしてダウンロードし、ZUNZUNにドロップする（基本）。②ZUNZUNのウィンドウへ `postMessage`（targetOriginは固定。受信側で `origin` とスキーマを検証）。
- トークンをページ外に送らない、外部スクリプトを読み込まない、コードを短く監査しやすく保つ、の3点を守ります。Suno側の仕様変更に備えて、パーサはバージョンごとに分けて持ちます。

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
