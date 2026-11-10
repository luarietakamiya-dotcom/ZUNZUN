# vendor/jizura — JIZURA 字面 の歌詞モーションエンジン

- 出典: https://github.com/852wa/JIZURA
- コミット: `4c8278cef161b38b132055e7b5efa112a5d41790`（v0.13.0、2026-11-10 取り込み）
- ライセンス: MIT（© 2026 hakoniwa）。全文は同じフォルダの `LICENSE`。
- 取り込んだ日: 2026-09-28（0.9.0、`8da975f`）。2026-11-08 に 0.10.1 へ更新（姫の了承。英字の歌詞が単語の途中で折り返される不具合が本家で直っていたため）

## 中身

`jizura-engine.js` は JIZURA の `src/*.js` をファイル名順に連結したもの（JIZURA の `build.py` と同じ）です。次の 2 つは含めていません。

| 含めないファイル | 理由 |
|---|---|
| `src/11_export.js` | JIZURA 自身の MP4/PNG 書き出し（mp4-muxer に依存）。ZUNZUN は自前の書き出しを使う |
| `src/12_ui.js` | JIZURA のエディタ画面 |

どちらもエンジン側からは参照されていません（そこで定義される `J.*` はエディタ画面からしか使われない）。

## 改変

**本文は改変していません。** `build.py` と同じく `@VERSION@` を `0.13.0` に置き換えただけです。

ZUNZUN に合わせる必要があるところは、同梱ファイルではなく `src/core/lyrics/jizura-adapter.ts` 側で対応しています。

- 決定論: `J.Renderer` は紙の質感とフィルムの粒を `Math.random()` で作るので、Renderer を作るときと紙の質感の下準備のときだけ `Math.random` を seed 付きの乱数に差し替える。
- 行の終了（ZUNZUN の `lineEnds`）: `J.computeTiming` を包んで反映する。
- 折り返し: `J.splitLines` を包み、英字と日本語が混ざった行では英字のかたまり（RAB!T、won’t など）の途中で切らず、英語と日本語の境目を優先する（`src/core/lyrics/split-lines.ts`。2026-11-08）。本家 0.10.1 は英字だけの行は単語の間で切るが、混ざった行は文字数だけで切る。
- フォント: JIZURA の実装どおり Google Fonts から読み込む（ZUNZUN で外部通信を許しているのはフォントの取得だけ。`docs/ARCHITECTURE.md` の技術選定を参照）。

## 更新のしかた

JIZURA を手元に clone して目的のコミットを checkout し、次を実行します（ネットワークには接続しません）。

```bash
node scripts/vendor-jizura.mjs <JIZURA のフォルダ> <40 桁のコミット SHA>
```

更新したらこの README のコミットとライセンスを書き直し、`npm test`（行番号の数え方が移植版と一致するかの比較テストを含む）と `npm run test:e2e` を通してください。
