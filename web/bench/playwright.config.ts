import { defineConfig } from '@playwright/test';

// How the pages hold up with a big library and a long mix, on this computer, in a production build:
//   pnpm build && pnpm exec playwright test --config bench/playwright.config.ts
// It's a measurement, not a pass or fail, so it isn't part of the tests CI runs. What it finds goes in
// docs/adr/selecta-3-1-measurements.md. Runs of it are only comparable on the same hardware.
const python = process.env.SELECTA_PYTHON ?? 'uv run python';
const port = process.env.SELECTA_SCALE_PORT ?? '8821';
const songs = process.env.SELECTA_SCALE_SONGS ?? '20000';
const inMix = process.env.SELECTA_SCALE_MIX ?? '100';

export default defineConfig({
  testDir: '.',
  testMatch: '*.bench.ts',
  timeout: 600_000,
  workers: 1,
  reporter: [['list']],
  outputDir: `${process.env.TEMP ?? '.'}/selecta-bench-results`,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: 'msedge',
    headless: true,
    launchOptions: { args: ['--mute-audio', '--enable-precise-memory-info'] },
    viewport: { width: 1366, height: 768 },
  },
  webServer: {
    command: `${python} ../../tests/scale_server.py ${port} ${songs} ${inMix}`,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
