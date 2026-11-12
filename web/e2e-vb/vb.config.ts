import { defineConfig, devices } from '@playwright/test';

// Temporary config for Claude's owner-delegated person-step checks (S4 ADR-0101 to 0113). Deleted after the run.
const port = process.env.SELECTA_E2E_PORT ?? '9631';
const python = process.env.SELECTA_PYTHON ?? 'C:\\Users\\tochi\\Documents\\Code\\selecta\\.venv\\Scripts\\python.exe';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.vb.ts',
  timeout: 600_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    actionTimeout: 20_000,
    launchOptions: { args: ['--mute-audio'] },
  },
  projects: [
    { name: 'edge', use: { channel: 'msedge', headless: true }, testIgnore: /devices-/ },
    { name: 'iphone', use: { ...devices['iPhone 13'] }, testMatch: /devices-.*\.vb\.ts/ },
    { name: 'pixel', use: { ...devices['Pixel 7'] }, testMatch: /devices-.*\.vb\.ts/ },
  ],
  webServer: {
    command: `${python} ../tests/e2e_server.py ${port}`,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
