import { defineConfig, devices } from '@playwright/test';

// BF-0466-03 (gate 2): run the engine's real probe and limiter worklets (the exact processor
// source the app ships) in all three browser engines: `pnpm e2e:engine-truth`. This is a
// processing and scheduling gate only and makes no audibility claim: Chromium and Firefox are
// muted, WebKit has no mute switch and the graph ends in a zero gain anyway. Firefox and WebKit
// browsers must be installed (`pnpm exec playwright install firefox webkit`).
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
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'media.autoplay.default': 0,
            'media.autoplay.block-webaudio': false,
            'media.volume_scale': '0.0',
          },
        },
      },
    },
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
