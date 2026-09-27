# Third-party notices

ZUNZUN が参照・移植・同梱するサードパーティのソフトウェアと素材の一覧です。
依存やコードを追加したときに、ここへ追記します。

## JIZURA 字面 (MIT)

- Source: https://github.com/852wa/JIZURA
- 用途: 設計の参考、および一部ロジックの移植（移植したファイルの冒頭に出典を記載）。歌詞モーションエンジンは MVP 後に `vendor/jizura/` へ同梱予定。

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

## 予定（導入時に正式な表記を追記）

- three.js — MIT
- 同梱フォント — SIL Open Font License 1.1
