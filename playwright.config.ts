import { defineConfig, devices } from '@playwright/test';

// このコンテナ/セッションに同梱されている Chromium をそのまま使う想定 (追加ダウンロード不要)。
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // GPU の無い環境 (ヘッドレス) でも WebGL で描けるように SwiftShader を使う (tests/e2e/visual.spec.ts)
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
      },
    },
  ],
});
