import { defineConfig, devices } from '@playwright/test';

// vc- delegated verification run (scratch, removed after use). Stress library, own port and build.
const port = process.env.SELECTA_E2E_PORT ?? '9640';
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.vc.ts',
  timeout: 900_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: '../test-results-vc',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    actionTimeout: 20_000,
    headless: true,
    launchOptions: { args: ['--mute-audio'] },
  },
  projects: [
    { name: 'edge', testIgnore: '**/devices.vc.ts', use: { channel: 'msedge' } },
    { name: 'iphone-webkit', testMatch: '**/devices.vc.ts', use: { ...devices['iPhone 13'] } },
    { name: 'iphone-webkit-landscape', testMatch: '**/devices.vc.ts', use: { ...devices['iPhone 13 landscape'] } },
    { name: 'pixel-edge', testMatch: '**/devices.vc.ts', use: { ...devices['Pixel 7'], channel: 'msedge' } },
    { name: 'zoom200-edge', testMatch: '**/devices.vc.ts', use: { channel: 'msedge', viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: `${process.env.SELECTA_PYTHON ?? 'C:/Users/tochi/Documents/Code/selecta/.venv/Scripts/python.exe'} ../tests/e2e_server.py ${port}`,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { SELECTA_E2E_STRESS: '1', SELECTA_E2E_DIST: process.env.SELECTA_E2E_DIST ?? 'dist-vc' },
  },
});
