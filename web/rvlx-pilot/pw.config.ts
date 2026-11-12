import { defineConfig } from '@playwright/test';
const port = '9421';
export default defineConfig({
  testDir: '.',
  testMatch: '*.pilot.ts',
  timeout: 600_000,
  workers: 1,
  reporter: [['list']],
  outputDir: '../test-results-rv-lx',
  use: { baseURL: `http://127.0.0.1:${port}`, channel: 'msedge', headless: true, actionTimeout: 8_000, launchOptions: { args: ['--mute-audio'] } },
  webServer: {
    command: `C:/Users/tochi/Documents/Code/selecta/.venv/Scripts/python.exe ../../tests/e2e_server.py ${port}`,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 420_000,
    env: { SELECTA_E2E_DIST: 'dist-rv-lx', SELECTA_E2E_PORT: port, SELECTA_E2E_STRESS: process.env.RVLX_STRESS ?? '' },
  },
});
