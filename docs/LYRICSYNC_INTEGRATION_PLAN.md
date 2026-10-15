# LyricSync 組み込みの計画（2026-10-14 姫が承認。段階 1 は実装済み）

作成: Claude / 2026-10-13
元の資料: LyricSync のセッションからの引き継ぎ（HANDOFF_ZUNZUN.md、2026-10-12。姫がこの会話に貼った内容）
CLAUDE.md の決まり: 設計の方針を変えるので「Phase 4・Plan Mode」。**この計画を姫が承認するまで、コードは書かない。**

---

## 0. 前提（ZUNZUN 側で確かめたこと）
- ZUNZUN は**ブラウザの Web アプリだけ**。Electron 版は無い。動く場所は 2 つ。
  - 公開版: `https://luarietakamiya-dotcom.github.io/ZUNZUN/`（GitHub Pages。スマホでも使っている）
  - 手元: `npm run dev` → `http://localhost:5173`
- 歌詞の時刻は `project.lyrics.timing`（`lineTimes` / `lineEnds` / `snap` / `snapWindowMs` / `blanks`）。読み込みは `sanitizeProject()`（`src/core/project/validate.ts`）が、行番号の上限や数値の範囲を確かめている。
- LRC・SRT の読み込みはすでにある（歌詞タブの「ファイルから読み込む」）。書き出しも 2026-10-08 に追加済み。
- Codex が別の道（A-003: 既知の歌詞と声の照合の実験）を進めている。そこで使った MMS の照合モデルは **CC-BY-NC-4.0（非商用）** なので「製品には採用しない」と記録している。LyricSync も MMS を使っている（後述 6）。

## 1. 方針をこう変える（設計書の書き換え案）
今の設計書（`docs/ARCHITECTURE.md`）:
- 94 行目「Suno のブックマークレットと、AI による歌詞の自動アライメントは作りません」
- 156 行目「『半自動タップ＋タイムラインでの後調整』を標準にします。AI は使いません」

**書き換え案:**
> ZUNZUN 本体には、AI の照合モデルを入れない（同梱もダウンロードもしない）。
> ただし、**利用者の PC で動く別のツール LyricSync の結果を読み込むこと**と、**同じ PC の LyricSync（127.0.0.1）を呼び出すこと**はできるようにする。
> 自動で付けた時刻は「たたき台」で、半自動タップ・タイムラインでの後調整を標準とする考え方は変えない。
> 外への送信はしない（LyricSync は同じ PC の中で動き、音源も歌詞も PC の外に出ない）。

理由: 「ローカル完結」「後調整が標準」という ZUNZUN の芯は保ったまま、手打ちが苦手な姫の手間を減らせる。重いモデルは ZUNZUN に入らないので、アプリは軽いまま。

## 2. 段階に分けて入れる（おすすめ）
### 段階 0: 今すぐ（コードの変更なし）
LyricSync が作った `.lrc` を、歌詞タブの「ファイルから読み込む」で読む。LyricSync は間奏の行を `[間奏]` として残すので、行番号は変わらない（資料のとおり）。

### 段階 1: 「LyricSync の結果を読み込む」（ネットに出ない。公開版とスマホでも使える）
- 歌詞タブに「LyricSync の結果を読み込む」を足す。LyricSync の出力（`files.zunzun` の JSON、または応答の JSON 全体）を選ぶと、`lineTimes` / `lineEnds` だけを今の歌詞の時刻として入れる。
  - `snap` / `snapWindowMs` は**入れない**（姫が決めた吸着の設定を上書きしないため）。
  - 入れる前に **行の数と中身が今の歌詞と合うか** を確かめる。合わなければ入れずに「歌詞が違います」と出す（行番号のずれ防止）。このために LyricSync 側の出力に「行の本文（または歌詞のハッシュ）」が要る → 6 の依頼 (a)。
  - 読み込みは「取り消し」で戻せる（今の歌詞の履歴に積む）。
- `review`（自信の低い行の番号）は、**タイムラインで目立たせる**（色の印）。プロジェクトの JSON には保存しない（`sanitizeProject()` を変えずに済む）。その行を手で動かしたら印は消える。
- **自動の結果にさらに吸着はかけない**（LyricSync の評価で、吸着はクリック音に引っぱられて精度が下がったため）。ドラッグのときの吸着は、今までどおり姫の設定に従う。

### 段階 2: 「自動で合わせる」ボタン（**公開版を PC の Chrome で開いたとき**も使う。2026-10-13 姫「公開版にしたい」）
- 歌詞タブに「LyricSync で自動で合わせる」を足す。LyricSync の `clients/lyricsync-client.ts`（fetch だけ・tsc --strict で型チェック済み）を**そのまま**コピーして使う（ZUNZUN 側で中身を変えない）。
- 送るもの: 音源のファイル（`audio: Blob`）、今の歌詞の本文、ボーカルのステムがあれば `vocals`（分離を飛ばせて精度も上がる）。
- 受けたら段階 1 と同じ処理（行の照合 → `lineTimes` / `lineEnds` → `review` の印）。
- 1 曲 30〜130 秒かかるので、待っている表示と「中止」を付ける。
- LyricSync が起動していない（`health()` が null）ときは「LyricSync が起動していません。PC で `lyricsync.exe serve` を起動してください」と案内する。ブラウザからはサーバーを起動できない。
- **公開版（GitHub Pages）から使う**ための条件（2026-10-13 姫の希望で、これを前提にする）:
  1. LyricSync 側: 許可する Origin に `https://luarietakamiya-dotcom.github.io` を足し、Private Network Access の preflight に `Access-Control-Allow-Private-Network: true` で答える（6 の依頼 (b)。LyricSync のセッションに姫から伝える）。
  2. 姫: 新しい Chrome が「ローカルネットワークへのアクセスを許可しますか」と聞いたら許可する（初回だけ）。
  3. ZUNZUN: うまくいかない理由を出し分けて案内する（起動していない／Origin で断られた（403）／ブラウザが許可していない）。
- **スマホでは使えない**（LyricSync は PC にあるため）。PC の公開版で合わせた結果を、プロジェクトの保存か SRT・LRC で持っていく。ボタンは押せない状態にして理由を書く。
- まずは PC の Chrome を前提にする。Safari・Firefox は未確認。

## 3. 変えるファイル（承認後）
- 新規 `src/core/lyrics/lyricsync.ts`（LyricSync の出力を検証して `timing` に直す。行の照合）とその単体テスト。
- 段階 2 のみ: 新規 `src/core/lyrics/lyricsync-client.ts`（LyricSync のファイルをそのままコピー）。
- `src/ui/panels/lyrics.ts`（ボタンと案内）、`src/ui/panels/lyrics-timeline.ts`（`review` の印）。
- `docs/ARCHITECTURE.md`（1 の書き換え）、`docs/HANDOFF.md`。
- 変えないもの: `sanitizeProject()` / `validate.ts`（新しい項目を保存しないため）、LyricSync のコード、JIZURA。新しいパッケージは足さない。

## 4. 確かめ方
- 単体テスト: 正しい出力・行の数が違う・本文が違う・間奏を含む・数値がおかしい（NaN・負・逆順）・`review` の番号が範囲外、の各場合。
- E2E: LyricSync の応答をまねたテスト用のサーバー（Playwright の route）で、段階 2 のボタン → 時刻が入る → `review` の行に印、まで。起動していない場合の案内も。
- 姫の PC での実地: THREE COUNT などで「自動で合わせる」→ 印の行を手直し → 書き出し。**これは私にはできない**（LyricSync が姫の PC にしかないため）。

## 5. 決めてほしいこと（姫へ）
1. **方針の書き換え（1）に賛成か。**
2. **どこまで入れるか**: 段階 1 と 2（2 は公開版の PC の Chrome でも使う。姫の希望）。
3. **Codex の A-003（自動同期の実験）をどうするか**: LyricSync を使うなら、Codex の B2（製品への組み込み）は止めて、LyricSync の結果の評価・手直しの UI に回すのが重複しないと思う。
4. `review` の印をプロジェクトに保存したいか（保存するなら `sanitizeProject()` の変更が要る。おすすめは保存しない）。

## 6. LyricSync 側へのお願い（姫から伝えてほしい。LyricSync のコードは ZUNZUN 側では変えない）
- (a) 出力に**行の本文（または歌詞のハッシュ）**を入れてほしい。ZUNZUN が「今の歌詞と同じ行番号か」を確かめるため。
- (b) **（必須になった）** 公開版（GitHub Pages）から使うために: 許可する Origin に `https://luarietakamiya-dotcom.github.io` を足し、Chrome の Private Network Access の事前確認（preflight）に `Access-Control-Allow-Private-Network: true` で答えてほしい。
- (c) **MMS の照合モデルの利用条件（CC-BY-NC-4.0、非商用）**の確認。作った MV を収益化する場合に問題がないか、LyricSync 側で確かめてほしい（Codex の実験でも、この条件で「製品に採用しない」としていた）。私は法律の判断はできないので、気になる点として挙げる。


## 7. 決まったこと（2026-10-14 姫「LyricSync を導入した人だけ使える、にする」「OK」）
- **LyricSync を自分の PC に入れた人だけの機能**にする。入れていない人は今までどおり手で合わせる。
- 設計書の方針を書き換えた（`docs/ARCHITECTURE.md` の 94 行目・「歌詞同期の方針」の改定）。
- 「要確認」の印はプロジェクトに保存しない。
- Codex の A-003 の製品化（B2）は止める。Codex は LyricSync の結果を手直しする画面のレビューに回る。
- 途中で試した別案: 音を聞かない AI に数字の材料だけ渡す方式は使えない水準だった（`docs/LLM_TEXT_ALIGNMENT_20261014.md`）。

## 8. 実装の状況
- **段階 1（済み）**: 歌詞タブ「LyricSync の結果を読み込む」。`src/core/lyrics/lyricsync.ts`（読み込みと検証。行の数・本文・値を確かめ、合わなければ取り込まない）、`src/ui/panels/lyrics.ts`（ボタン・案内・結果の表示・取り消し）、`src/ui/panels/lyrics-timeline.ts`（自信の低い行に橙の線と「要確認」。その行を手で動かすと消える）。
- **段階 2（2026-10-15 実装。本物との通信は未確認）**: 歌詞タブ「LyricSync で自動で合わせる」。`src/core/lyrics/lyricsync-remote.ts`（`/health` → `POST /jobs` → `GET /jobs/{jid}` を 2 秒ごと）。窓口は姫の PC の `/openapi.json` で確認。`lyricsync-client.ts` の実物は使わず ZUNZUN 側で書いた（応答の形は openapi に無いので、よくある名前を幅広く受け、読めなければ応答を保存して送ってもらう）。中止は待つのをやめるだけ（取り消しの窓口が無い）。
- **LyricSync 側へのお願い（既製品らしくするため。姫から伝える）**: (d) ダブルクリックで起動できるショートカット（デスクトップ・スタートメニュー）と、起動中が分かる表示（タスクトレイなど）。(e) 応答の形（`/jobs`・`/jobs/{jid}` の JSON）を openapi に書く。(f) 仕事の取り消しの窓口（`DELETE /jobs/{jid}`）。
- **段階 2 を本物の LyricSync 1.1.0 で確認（2026-10-16、姫の PC。RTX 2080 Ti / large-v3）**:
  - LyricSync 1.1.0 で、お願いの (d)(e)(f) は入った（トレイのショートカット・openapi に Job の形・`DELETE /jobs/{jid}`）。それに合わせて、中止と時間切れのときに `DELETE /jobs/{jid}` を送るようにした（取り消せない版なら「裏で計算を続けます」と出す）。つながらないときの案内は「デスクトップの LyricSync をダブルクリック」にした。
  - 確かめたこと: 開発版（localhost:5173）のボタンから本物に曲と歌詞を送り、`/health` → `POST /jobs` → `GET /jobs/{id}` の進み具合が画面に出る。「中止」で LyricSync の仕事も止まる（`running: null` になった）。LyricSync の失敗（`status: error`）は、止まった段階つきで画面に出る。
  - 見つけて直した不具合: 計算中（1〜2 分）にタブを替える・表示が切り替わる（画面の幅でスマホ表示⇔PC 表示）と、パネルが作り直されて、結果もエラーも出ず取り込まれなかった。仕事をパネルの外（`lyrics.ts` のモジュール）に持ち、作り直したパネルが引き継ぐようにした。
  - **成功の応答は本物ではまだ通っていない**: LyricSync 1.1.0 が THREE COUNT（2 つの音源・見出しあり/なし・ZUNZUN からでも curl からでも）で毎回 `ValueError: max() arg is an empty sequence` で止まる（「合わなかった行をその周りだけで合わせ直しています」の段階、進み 90%）。前に 1.0.0 で成功した音源でも同じなので、1.1.0 の退行と見ている（LyricSync 側で直してもらう）。代わりに、前に LyricSync が書き出した本物の結果（`.lyricsync.json` と `.zunzun-timing.json`）から、server.py と同じ形（`result.files.zunzun` は JSON の**文字列**）の応答を組み立ててページの fetch に返し、ボタン → 途中でタブを替える → 戻る、の流れで 61 行の開始・終了がすべて一致、自信の低い 5 行に橙の印が出ることを確かめた。
  - まだ確かめていないこと: 公開版（github.io）を PC の Chrome で開いたときの「ローカル ネットワークへのアクセス」の確認と接続。LyricSync の不具合が直ったあとの、本物の成功の応答。
