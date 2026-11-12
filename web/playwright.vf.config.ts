import { defineConfig } from '@playwright/test';

// Temporary config for the Claude verification captures (vf-); deleted after the run.
const port = process.env.SELECTA_E2E_PORT ?? '9670';
const python = process.env.SELECTA_PYTHON ?? '../.venv/Scripts/python.exe';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/*.vf.ts', ...(process.env.VF_EXTRA ? process.env.VF_EXTRA.split(',') : [])],
  timeout: 900_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    actionTimeout: 20_000,
    channel: 'msedge',
    headless: true,
    launchOptions: { args: ['--mute-audio'] },
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
