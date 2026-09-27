# ローカル実行手順 (npm install が必要な工程)

Cloud Session からは `registry.npmjs.org` へのアクセスが組織のネットワークポリシーでブロックされているため、
依存パッケージのインストールはこのリポジトリを clone したローカル環境（またはネットワーク許可済みの環境）で行ってください。
ソースコード自体は Cloud Session 側で作成・編集を進めます。

## 前提

- Node.js 20 以上（動作確認は Node 22 系）
- ローカルに Chromium が無ければ Playwright が別途ダウンロードします

## 手順

```bash
git clone https://github.com/luarietakamiya-dotcom/ZUNZUN.git
cd ZUNZUN
git pull   # Cloud Session 側の最新コミットを取得

npm install

# Playwright が使うブラウザを初回のみ取得 (すでに Chrome/Chromium がある場合は省略可)
npx playwright install chromium

# 開発サーバー起動 (http://localhost:5173)
npm run dev

# 型チェック + 本番ビルド
npm run build

# Lint
npm run lint

# 単体テスト (Vitest)
npm test

# E2E テスト (Playwright) — 開発サーバーを自動起動して実行
npm run test:e2e
```

## 想定される依存パッケージ

`package.json` に定義済み。主なもの:

- 実行時: `three`, `mediabunny`
- 開発時: `vite`, `typescript`, `vitest`, `jsdom`, `@playwright/test`, `eslint`, `typescript-eslint`, `@eslint/js`, `@types/three`

すべて `registry.npmjs.org` から取得します。社内プロキシ等でミラーが必要な場合は `.npmrc` で `registry` を差し替えてください。

## うまくいかないとき

- `npm install` が特定パッケージだけ失敗する場合は、`npm cache clean --force` のあと再試行してください。
- `npm run test:e2e` で `Executable doesn't exist` と出た場合は `npx playwright install chromium` を実行してください。
- 作業が終わったら `git push` してこのリポジトリに反映してください（`node_modules/` はコミットしません。`.gitignore` 済みです）。
