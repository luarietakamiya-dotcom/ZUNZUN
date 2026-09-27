import { defineConfig } from 'vite';

// ZUNZUN はローカル完結を前提にするため、開発サーバーも既定でネットワークに公開しない (host: false)。
export default defineConfig({
  server: { host: false, port: 5173 },
  build: { target: 'es2022', sourcemap: true },
});
