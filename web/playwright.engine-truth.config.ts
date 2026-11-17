import { defineConfig, devices } from '@playwright/test';

// BF-0466-03: run the unmocked AudioWorklet tripwire in all three browser engines. This is a
// logic/scheduling gate only; every project is muted and therefore makes no audibility claim.
const python = process.env.SELECTA_PYTHON ?? 'uv run python';
const port = process.env.SELECTA_ENGINE_TRUTH_PORT ?? '8814';
const dist = process.env.SELECTA_ENGINE_TRUTH_DIST ?? 'dist-engine-truth';

export default defineConfig({
  testDir: './e2e-cloud',
  testMatch: 'engine-truth.cloud.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: './test-results/engine-truth',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    actionTimeout: 20_000,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `pnpm exec vite build -c vite.cloud-e2e.config.ts --outDir ${dist} --logLevel warn && pnpm exec vite build -c vite.cloud-e2e-authkit.config.ts --outDir ${dist}-authkit --logLevel warn && ${python} ../tests/e2e_cloud_server.py ${port}`,
    env: { ...process.env, SELECTA_CLOUD_E2E_DIST: dist },
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
