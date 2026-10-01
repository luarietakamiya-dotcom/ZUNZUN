import { defineConfig } from 'vite';

// ZUNZUN はローカル完結を前提にするため、開発サーバーも既定でネットワークに公開しない (host: false)。
// 公開先のパス (GitHub Pages では /ZUNZUN/。.github/workflows/pages.yml が ZUNZUN_BASE で渡す)。ふだんは /
export default defineConfig({
  base: process.env.ZUNZUN_BASE ?? '/',
  server: { host: false, port: 5173 },
  build: { target: 'es2022', sourcemap: true },
});
