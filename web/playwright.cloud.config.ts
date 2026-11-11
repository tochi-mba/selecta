import { defineConfig } from '@playwright/test';

// Every cloud browser test, in one project against one server (tests/e2e_cloud_server.py): the
// production Cloud API over a fresh database, with fake sign-in, fake object storage, fake
// Stripe, a synthetic Rooms song library and test audio on the same server. The Cloud site, the
// Rooms guest page, the display and the device harness are built first, with AuthKit swapped
// for a test double (vite.cloud-e2e.config.ts); a second build keeps the real AuthKit library
// for the sign-in redirect test (vite.cloud-e2e-authkit.config.ts, served at localhost). Its own
// port, so it never meets the local test server (8799) or a running Selecta (8733).
//
//   pnpm e2e:cloud
const python = process.env.SELECTA_PYTHON ?? 'uv run python';
const port = process.env.SELECTA_CLOUD_E2E_PORT ?? '8812';
// SELECTA_CLOUD_E2E_DIST builds into, and serves, another folder so parallel runs never share one.
const dist = process.env.SELECTA_CLOUD_E2E_DIST ?? 'dist-cloud-e2e';

export default defineConfig({
  testDir: './e2e-cloud',
  testMatch: '**/*.cloud.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: './test-results/cloud',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    actionTimeout: 20_000,
    channel: 'msedge',
    headless: true,
    launchOptions: { args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm exec vite build -c vite.cloud-e2e.config.ts --outDir ${dist} --logLevel warn && pnpm exec vite build -c vite.cloud-e2e-authkit.config.ts --outDir ${dist}-authkit --logLevel warn && ${python} ../tests/e2e_cloud_server.py ${port}`,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
