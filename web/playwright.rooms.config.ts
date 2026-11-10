import { defineConfig } from '@playwright/test';

// Browser tests for the Rooms guest page, the big-screen display and playback devices, against
// the real cloud API with test sign-ins and a synthetic song library (tests/cloud_e2e_server.py).
// Its own port, so it never meets the owner's site (8733), the main browser tests (8799) or the
// Cloud site tests (8812).
//
//   pnpm exec playwright test -c playwright.rooms.config.ts
const python = process.env.SELECTA_PYTHON ?? 'uv run python';
const port = process.env.SELECTA_ROOMS_E2E_PORT ?? '8741';

export default defineConfig({
  testDir: './e2e-cloud',
  testMatch: '**/*.cloud.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: './test-results/rooms',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    actionTimeout: 15_000,
    channel: 'msedge',
    headless: true,
    launchOptions: { args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `${python} ../tests/cloud_e2e_server.py ${port}`,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
