import { defineConfig } from '@playwright/test';

// Scratch: one headed Edge session read by NVDA (tag ve-). Deleted after the run.
const port = process.env.SELECTA_E2E_PORT ?? '9661';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.nvda.ts',
  timeout: 1_200_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: './results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    actionTimeout: 20_000,
    channel: 'msedge',
    headless: false,
    viewport: null,
    launchOptions: { args: ['--mute-audio', '--force-renderer-accessibility', '--start-maximized'] },
  },
  webServer: {
    command: `"C:/Users/tochi/Documents/Code/selecta/.venv/Scripts/python.exe" "C:/Users/tochi/Documents/Code/selecta/tests/e2e_server.py" ${port}`,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 400_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { SELECTA_E2E_STRESS: '1', SELECTA_E2E_STEMS: '1', SELECTA_E2E_DIST: 'dist-ve' },
  },
});
