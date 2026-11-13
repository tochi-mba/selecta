import { defineConfig } from '@playwright/test';

// Agent-owned LF12 browser suite; doesn't edit shared Playwright configuration (Agent 19).
export default defineConfig({
  testDir: '../../../e2e',
  testMatch: 'lf12-*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  workers: 1,
  fullyParallel: false,
  use: {
    browserName: 'chromium',
    headless: true,
    launchOptions: { args: ['--mute-audio'] },
  },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5182 --strictPort',
    url: 'http://127.0.0.1:5182/src/cloud/lf-device-control/lf12-fixture.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
