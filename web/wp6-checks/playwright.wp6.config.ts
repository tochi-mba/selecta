import { defineConfig, devices } from '@playwright/test';

// wp6- owner-delegated verification run (scratch, removed after use). Made-up library only.
const port = process.env.SELECTA_E2E_PORT ?? '9790';
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.wp6.ts',
  timeout: 900_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: '../test-results-wp6',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    actionTimeout: 20_000,
    headless: true,
    launchOptions: { args: ['--mute-audio'] },
  },
  projects: [
    { name: 'nvda', testMatch: '**/nvda-*.wp6.ts', use: { channel: 'msedge', headless: false, launchOptions: { args: ['--mute-audio'] } } },
    { name: 'edge', testIgnore: ['**/nvda-*.wp6.ts'], use: { channel: 'msedge' } },
    { name: 'phone', testMatch: '**/narrow.wp6.ts', use: { ...devices['iPhone 13'], browserName: 'chromium', channel: 'msedge' } },
  ],
  webServer: {
    command: `C:/Users/tochi/Documents/Code/selecta/.venv/Scripts/python.exe C:/Users/tochi/Documents/Code/selecta/tests/e2e_server.py ${port}`,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { SELECTA_E2E_STRESS: '1', SELECTA_E2E_DIST: process.env.SELECTA_E2E_DIST ?? 'dist-wp6' },
  },
});
