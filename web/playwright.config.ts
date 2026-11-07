import { defineConfig } from '@playwright/test';

// Real pages in a real browser against a real server, with a small library synthesized by
// tests/e2e_server.py. Edge is already on every Windows machine, so there's nothing big to download.
// Muted, so running these never plays through anyone's speakers.
const python = process.env.SELECTA_PYTHON ?? 'uv run python';
const port = process.env.SELECTA_E2E_PORT ?? '8799';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  // Fully-parallel discovery balances GitHub shards by test, not by file. Within each
  // shard there is still only ONE worker using its own mutable test server and database.
  workers: 1,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: 'msedge',
    headless: true,
    launchOptions: { args: ['--mute-audio'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `${python} ../tests/e2e_server.py ${port}`,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
