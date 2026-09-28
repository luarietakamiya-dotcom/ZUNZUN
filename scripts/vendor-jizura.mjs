// JIZURA のエンジン部分を vendor/jizura/jizura-engine.js にまとめ直すスクリプト (ネットワークには接続しない)。
//
// 使い方: JIZURA のリポジトリを手元に用意し (git clone して目的のコミットを checkout するなど)、
//   node scripts/vendor-jizura.mjs <JIZURA のフォルダ> <コミット SHA>
//
// JIZURA 本家の build.py と同じく src/*.js をファイル名順に連結する。ただし次の 2 つは含めない:
// - 11_export.js (JIZURA 自身の MP4/PNG 書き出し。ZUNZUN は自前の書き出しを使う。mp4-muxer に依存する)
// - 12_ui.js (JIZURA のエディタ画面)
// どちらもエンジン側からは参照されていない (定義される J.* はエディタ画面からしか使われない) ことを確認済み。
// 本文は改変しない。build.py と同じく @VERSION@ だけを VERSION ファイルの値に置き換える。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [srcRoot, sha] = process.argv.slice(2);
if (!srcRoot || !sha || !/^[0-9a-f]{40}$/.test(sha)) {
  console.error('usage: node scripts/vendor-jizura.mjs <JIZURA のフォルダ> <40 桁のコミット SHA>');
  process.exit(1);
}
const EXCLUDE = new Set(['11_export.js', '12_ui.js']);
const version = readFileSync(join(srcRoot, 'VERSION'), 'utf8').trim();
const files = readdirSync(join(srcRoot, 'src'))
  .filter((f) => f.endsWith('.js') && !EXCLUDE.has(f))
  .sort();
const body = files.map((f) => readFileSync(join(srcRoot, 'src', f), 'utf8').replace(/\r\n/g, '\n')).join('\n').replaceAll('@VERSION@', version);

const header = `/*!
 * JIZURA 字面 — lyric motion engine (vendored into ZUNZUN)
 * Copyright (c) 2026 hakoniwa — MIT License (see vendor/jizura/LICENSE)
 * Source: https://github.com/852wa/JIZURA  commit ${sha}  (VERSION ${version})
 *
 * ZUNZUN での扱い (vendor/jizura/README.md も参照):
 * - src/*.js をファイル名順に連結した (JIZURA の build.py と同じ)。11_export.js と 12_ui.js は含めない
 * - 本文は改変していない。@VERSION@ だけを ${version} に置き換えた (build.py と同じ処理)
 * - 生成: node scripts/vendor-jizura.mjs <JIZURA のフォルダ> ${sha}
 * - 含めたファイル: ${files.join(', ')}
 */
`;
writeFileSync(new URL('../vendor/jizura/jizura-engine.js', import.meta.url), header + body + '\n');
console.log(`wrote vendor/jizura/jizura-engine.js (${files.length} files, ${(header.length + body.length) / 1024 | 0} KB)`);
