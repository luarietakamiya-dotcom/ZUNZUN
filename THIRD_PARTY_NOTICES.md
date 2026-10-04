# Third-party notices

ZUNZUN が参照・移植・同梱するサードパーティのソフトウェアと素材の一覧です。
依存やコードを追加したときに、ここへ追記します。

## JIZURA 字面 (MIT)

- Source: https://github.com/852wa/JIZURA
- 用途: 設計の参考、一部ロジックの移植（移植したファイルの冒頭に出典を記載。`src/core/lyrics/parse.ts`・`timing.ts`・`tap.ts` など）、
  および歌詞モーションエンジンの同梱（`vendor/jizura/jizura-engine.js`、commit `8da975fb362d966b065217618aedafd5a35a39e0`、VERSION 0.9.0）。
  同梱ファイルは本文を改変していない（`@VERSION@` の置き換えのみ）。詳細と LICENSE の全文は `vendor/jizura/README.md`・`vendor/jizura/LICENSE`。
- JIZURA が使う書体（Noto Sans JP / Noto Serif JP / Dela Gothic One ほか、SIL Open Font License 1.1）は同梱せず、
  歌詞モーションを使うときに Google Fonts から読み込む（ZUNZUN で外部通信を許しているのはフォントの取得だけ）。

```
MIT License

Copyright (c) 2026 hakoniwa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Mediabunny (MPL-2.0)

- Source: https://github.com/Vanilagy/mediabunny
- 用途: MP4 書き出し時のエンコード (WebCodecs) とコンテナ化 (`src/core/export/mp4.ts`)。
- 改変せず npm 依存 (`mediabunny`) としてそのまま使用している。MPL-2.0 はファイル単位のコピーレフトのため、
  Mediabunny のソースファイルを改変した場合はその改変ファイルの公開が必要になる (現状は改変なし)。
- License text: https://www.mozilla.org/en-US/MPL/2.0/

## three.js (MIT)

- Source: https://github.com/mrdoob/three.js
- 用途: 映像の描画。改変せず npm 依存 (`three`) としてそのまま使用している。License text: `node_modules/three/LICENSE`

## 書体 (SIL Open Font License 1.1)

- JIZURA が使う書体（Noto Sans JP ほか）。同梱せず、Google Fonts から読み込む（上の JIZURA の項を参照）。

## 同梱の画像 (AI 生成)

- 対象: `src/assets/city-scroll/`（流れる街並み）、`src/assets/cyber-space/`（サイバー空間）、`src/assets/library/`（用意された背景）、
  `src/assets/photo-motion/`（写真に動き）。作者が ChatGPT (OpenAI の画像生成) で作ったもの。
  `src/assets/help/` は、このアプリの画面を撮った使い方の画面写真。
- 実在の人物・ブランド・他人の作品の写真やイラストをもとにした画像は含めない。
- 注意: リポジトリの MIT ライセンス (`LICENSE`) はソフトウェアに対するもの。AI が生成した画像の著作権は国・内容によって扱いが定まっておらず、
  再利用の条件 (そのまま使ってよいか、クレジットが要るか) は別に決める必要がある。決めたら、ここと README に書く。
- 画像の作り方の目安 (出どころの記録): 画像ごとの生成日・プロンプトは記録していない。今後足すときは、ここに出どころを 1 行足す。
