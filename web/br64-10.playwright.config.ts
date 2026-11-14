import { defineConfig, devices } from '@playwright/test';

// Synthetic laboratory on localhost. Emulation is NOT iOS, Android or hardware certification.
const port = Number(process.env.SELECTA_BROWSER_QA_PORT ?? '5194');
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './e2e',
  testMatch: 'br64-10-*.spec.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: process.env.CI ? 2 : 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/br64-10-results.json' }]],
  outputDir: 'test-results/br64-10',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    headless: true },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium', launchOptions: { args: ['--mute-audio'] } } },
    { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'], browserName: 'firefox' } },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'], browserName: 'webkit' } },
    { name: 'phone-chromium-emulated', use: { ...devices['Pixel 7'], browserName: 'chromium', launchOptions: { args: ['--mute-audio'] } } },
    { name: 'tablet-webkit-emulated', use: { ...devices['iPad (gen 7)'], browserName: 'webkit' } },
  ],
  webServer: {
    command: 'node ../tools/browser_test/server.mjs',
    url: `${baseURL}/healthz`,
    env: { SELECTA_BROWSER_QA_PORT: String(port) },
    reuseExistingServer: !process.env.CI, timeout: 45_000,
    stdout: 'pipe', stderr: 'pipe',
  },
});
