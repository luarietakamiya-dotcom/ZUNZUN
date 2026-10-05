# A0 / B0 実装前確認 — Codex → Claude
確認日: 2026-10-05 JST
対象HEAD: 65aa6d1a559a71a4492c243c461d6a41afc79775
状態: コード読解の報告完了。製品コード変更・依存追加・モデル取得・MusicSyncコード閲覧なし。

## 指示の優先順位
最新の「並行2トラック」指示に、姫がD-005の方向を了承したと記録されている。D-005を優先し、以前のD-004のポスター/聖堂の見た目には戻さない。
今回の「確認して」をA0の調査依頼として実施。A1/A2やB1/B2を既に実装したとは扱わない。

## A0: TYPE_ART_DIRECTION 第5章
| 項目 | 確認結果 | 根拠 |
|---|---|---|
| 1 ctxと図形 | 構図から2D ctxにアクセス可能。グラデーション・輪郭・複写・反転は実装可能。ただしsave/restoreし、main passとghost passを区別する。直接描く図形はJ.mainDrawの文字処理や外接矩形計算には自動で含まれない。 | vendor/jizura/jizura-engine.js:4011–4045、src/core/lyrics/packs/design-kit.ts:25–36 |
| 2 1字ごとの動き | mainDrawへ1字ずつfont/x/y/size/rot/alpha/sx/syを渡せる。sy=-1の反転も描画側で適用される。ただし既存enter/hold/exit/treat/cameraが追加で作用するため、D-005では重複を避けた専用部品セットが必要。 | vendor/jizura/jizura-engine.js:1710–1735、806–871、src/core/lyrics/packs/types.ts:61–74 |
| 3 全面格子 | W/H、文字数、書体メトリクスから行列を選べる。縦長は別の行数にする。1字は1セル、2字は横長1行/縦長2行を候補、長文はセルの縦横比と文字の実測幅で候補を評価。試作のfitをそのまま移すとフォントの字面差で余白が残るため、実書体で計測する。均一拡大だけでは任意字数で四辺全部に触れる保証はない。字形の縦横比をどこまで伸ばしてよいかはClaudeレビューが必要。 | docs/art-studies/type-art-studies.html:68–76、vendor/jizura/jizura-engine.js:696–735、1005 |
| 4 拍の代替 | 既存beatOfは拍なしで0.5秒刻み。実拍があればindex/since/lenを使う。ただし速い曲の毎拍脈動はMAX_FLASH_HZ=3の制約と別に検証する。motion=0で光源移動/脈動/字間変化を止める。 | src/core/lyrics/packs/util.ts:55–68 |
| 5 複写負荷 | 試作は1字110回+本体1回。15字で1665描画/コマ、30fpsなら49950描画/秒（1 passの算術値、GPU実測ではない）。JIZURAはghost等のpassもあり、各複写をmainDrawに流すとさらに文字処理が重複する。キャッシュした文字マスク/影レイヤーの合成を候補にし、110回の逐次描画と比較して方式を決める。回数を減らすだけでは縞の再発があるため、画質も比較。 | docs/art-studies/type-art-studies.html:182–201、vendor/jizura/jizura-engine.js:3835–3870、1710–1735 |
| 6 旧修正 | Hyper/Gothicの全3構図をD-005に作り替えるならD-001–D-003の旧構図への修正は不要。ただし衝突・読める短文・装飾の視認性・行内の空白は新構図の受け入れ条件に残す。Summer等の残る構図の不具合まで直ったとは扱わない。 | docs/TYPE_ART_DIRECTION.md:作品表/第5章、最新並行指示A1 |

## 書体と描画上の注意
- dela/tokumin/dot/klee/mincho_black/mincho_lightは既にJ.FONTS登録済み（vendor/jizura/jizura-engine.js:209–225）。新しいフォントライブラリは不要。
- 1字ごとに別のfontを渡す機能はある。現行art-directed-layoutsのdrawはfitSizeには固定fontを使い、描画だけopt.fontで上書きできるので、混合書体時は計測と描画のfontを揃える修正が必要（src/core/lyrics/packs/art-directed-layouts.ts:37–41）。
- fontsOfPlanはstyle.fontsとcut.paramsの文字列/配列から書体を拾う（vendor/jizura/jizura-engine.js:290–300）。混合書体はparamsにfont一覧を宣言すれば既存の準備対象へ入る。
- prepareFontsはensureFonts失敗を握り、タイムアウトとのraceを使う（src/core/lyrics/jizura-adapter.ts:576–578）。現在の「待つ」は指定フォント成功を保証しない。実書体の読み込み確認・失敗表示・代替で検証した場合の報告が必要。
- shadowBlurは描画側でallowFilter=falseなら0になり得る（vendor/jizura/jizura-engine.js:834）。プレビューのfast=trueと書き出しの差を確認し、作品の法則をぼかしだけに依存させない。
- ctxへの不透明な全面塗りは、既存の透過歌詞レイヤーでビジュアライザーを隠す。初期実装案は文字・影・半透明の光のみ。白等への全面切替は採用しない。暗い全面背景の扱いもClaudeに確認する。
- sy=-1を使った反射の文字外接矩形は符号を含むため、テストでは角を正規化した実描画矩形を別途計算する。

## LYRIC_DESIGN_BRIEF 9.7
1. 背景の面: ctx/rect/polyで描ける。ctx.createLinearGradient等も使える。ただし上記の透過・pass処理が前提。D-005優先で、明るい全面切替を加える案は除外。
2. 同じ行の積み足し: fitsに渡るのはnのみでcut.lineは見えない（vendor/jizura/jizura-engine.js:3376–3380）。fitsでは解決しない。J.plan後、同じlineのcutへ構図・共通params・lineStart/lineEndと語の出現時刻を付けるアダプタ後処理を提案。描画は絶対時刻から計算し、seekや書き出し順で状態が変わらないようにする。既存手指定・ロック済みcutを優先。カメラ・enter/exitも行内で不連続にならないように揃える必要がある。
   根拠: src/core/lyrics/jizura-adapter.ts:622–658（plan生成/section mergeの境界）、vendor/jizura/jizura-engine.js:2963–3026（cutごとの構図選択）。
   変更範囲: packsだけではなくjizura-adapter.tsの追加が必要な案。対象2テーマだけに限定し、JIZURA本体は変更しない。seedによる選択結果は変わるため、実装前の姫の了承が未受領。
3. 拍から語間隔: beatOfのlenが使えるが、拍同期は歌詞の実際の歌い出しを意味しない。残り表示時間と最低静止時間で登場間隔を制限する。cut.ltのリセットではなくlineStart由来の時刻を使う。短いcutでも全字が出ることを検証する。

## ファイル分割・テスト案
- art-directed-layouts.tsの登録/旧キーは維持し、packs/layouts/type-grid.ts、hyper-light.ts、gothic-light.tsへ分けられる。既存Terminal/Summer等を先行変更しない。
- 実装案の対象: 上記packs、kinetic-packs.ts、fresh-packs.test.ts、必要ならjizura-adapter.ts、lyric-motion.ts（縦長の見本対応）。
- tests/e2e/flash-safety.spec.tsは現在ビジュアライザー対象で、Hyper/Gothic歌詞の合格実績には使えない。歌詞を含む測定ケースを追加し、静止/短文/長文/速い拍も検証する。
- 影の実測、実フォントの縦横描画、コンタクトシート、MP4速度は未実施。今回はコード読解のみなのでbuild/testで新実装が通ったとは報告しない。

## B0: MusicSyncとブラウザAI
現在、次の文書は未受領。
- 元曲/stem等の素材形式とサンプルレート
- 元曲へのoffset、先頭無音、処理で長さが変わるか
- 共通化できる前処理のAPI/入力/出力
MusicSyncコードは今回読んでいない。閲覧は最新の共同指示に従い姫の許可待ち。以前のリポジトリ名称検索だけで機能の有無は判断しない。
B1も未実行。使い捨て実験でのモデル取得の了承と、実曲3–5曲＋基準のタップ時刻が必要。架空の速度・精度・スマホ結果は書かない。

## Claudeへの返答・判断依頼
1. A0の技術確認は以上。文字マスク合成で影を作る案、任意アスペクトでの字の伸縮制限、暗い背景の扱いを設計レビューしてほしい。
2. 同一行の構図固定はアダプタ後処理が適切と判断。jizura-adapter.tsを追加対象にしてよいか。seedの選択変更は姫に具体的に確認する。
3. 混合書体の事前準備と、fast描画のグロー差を受け入れ条件へ入れてほしい。
4. A1は上記確認後、代表2テーマに限定して開始。A2/B2へ自動的に進めない。
