# ZUNZUN — Claude Code 向けプロジェクト指示

ローカル完結型（ブラウザ・外部送信なし）の Music Visualizer + Lyric Motion ツール。
TypeScript + Vite + Three.js (r180) + WebCodecs/Mediabunny。**ユーザーとのやり取りは日本語で行う。**

- 設計: `docs/ARCHITECTURE.md`（Phase 1 で承認済みの設計。勝手に変えない）
- 現在地・次の作業・過去のハマりどころ: `docs/HANDOFF.md`（**作業を始める前に必ず読む**）

## 絶対に守ること

- 作業対象はこの ZUNZUN リポジトリ（`luarietakamiya-dotcom/ZUNZUN`）だけ。**MusicSync など他のリポジトリには一切 commit/push しない。**
- `git push` はユーザーへの確認なしで行ってよい（2026-09-30 ユーザー指示「push 毎回確認しなくていい」）。push 先は作業ブランチだけ。force push はしない。
- `--dangerously-skip-permissions` は使わない。`npm audit fix --force` は実行しない。
- パッケージを追加するときは、先に必要性を説明して了承を得る。
- 大量のファイル削除・破壊的なコマンドは事前に確認する。秘密情報は扱わない。

## 作業の進め方（ユーザー指定のフェーズ運用）

| フェーズ | 内容 | モデル / モード |
|---|---|---|
| Phase 1 | 設計・調査 | Opus・Plan Mode |
| Phase 2 | 基盤実装（完了済み） | Sonnet・通常モード |
| Phase 3 | ビジュアライザーを 1 プリセットずつ追加 | 通常モード |
| Phase 4 | 難しい問題（設計の衝突・原因不明のバグ・複雑な GLSL/Three.js・書き出しの品質/同期・JIZURA 統合方針） | **Opus・Plan Mode で原因分析と修正計画を先に出す** |
| Phase 5 | 小さな修正・UI 調整・プリセット追加・リファクタ | Sonnet・通常モード |

1. 既存コードを先に読む。一度に全部書き換えない。小さな単位で変更する。
2. 1 機能ごとに `npm run build` / `npm run lint` / `npm test` を通す。既存機能を壊さない。
3. 不要な依存を増やさない。ライブラリにある機能を再実装しない。
4. 各ステップの終わりに「作業内容・変更ファイル・テスト結果」をまとめ、**次のステップへ進む前にユーザーの確認を待つ。**
5. 設計変更が必要になったら勝手に変えず、Plan Mode に戻って提案する。
6. コミットメッセージには、何を検証できて何を検証できていないかを正直に書く。

## コマンド

```bash
npm run dev        # http://localhost:5173
npm run build      # tsc -b（テストファイルも型チェック対象）+ vite build
npm run lint
npm test           # Vitest（jsdom）
npm run test:e2e   # Playwright
```

## コードの約束事

- **プリセットは `src/visualizers/<id>/` に閉じる。** 追加は `src/visualizers/index.ts` に import + `register()` の 2 行だけ。Host/Registry/他プリセットは触らない。
- プリセットが使ってよいのは `AudioFrame` / `CommonParams`（`src/core/types.ts`）と `src/core/visualizer/response.ts`（Sensitivity/Bass/Mid/High の適用）だけ。
- **決定論**: 乱数は `init()` で渡される `ctx.rng`（`project.seed` 由来）だけ。描画系で `Math.random()` を使わない（同じプロジェクト → 同じ書き出し映像）。
- `dispose()` で作ったジオメトリ・マテリアル・テクスチャ・Reflector をすべて解放する。
- 各プリセットに、WebGL なしで three.js のシーングラフだけを動かす Vitest スペックを付ける（型: `src/visualizers/solar-gate/solar-gate.test.ts`）。反応設計・seed の再現性・NaN 耐性・dispose を確認する。
- Project JSON（`*.zunzun.json`）に音源・画像のバイナリを埋め込まない（ref + sha256 のみ）。読み込みは `sanitizeProject()` を通す。
- UI パネルはタブ切り替えのたびに丸ごと作り直される（unmount フックなし）。タブをまたいで保つ状態は `src/core/store.ts` かモジュール単位のシングルトンに置く。
