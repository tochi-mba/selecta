import { defineConfig, devices } from '@playwright/test';

// Scratch config for the owner-delegated UF person-step checks (tag ve-). Deleted after the run.
const port = process.env.SELECTA_E2E_PORT ?? '9660';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.ve.ts',
  timeout: 1_500_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: './results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    actionTimeout: 20_000,
    headless: true,
    launchOptions: { args: ['--mute-audio'] },
  },
  projects: [
    { name: 'edge', use: { channel: 'msedge' }, testMatch: '**/edge-*.ve.ts' },
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'] }, testMatch: '**/phone-*.ve.ts' },
    { name: 'edge-pixel', use: { ...devices['Pixel 7'], channel: 'msedge' }, testMatch: '**/phone-*.ve.ts' },
  ],
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
