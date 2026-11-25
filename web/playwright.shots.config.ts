import { defineConfig } from '@playwright/test';
// TEMPORARY (Workers page screenshots); not committed.
const port = '8871';
export default defineConfig({
  testDir: './e2e-shots', testMatch: '**/*.shots.ts', timeout: 180_000, workers: 1, reporter: [['list']],
  outputDir: './test-results/shots',
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, channel: 'msedge' },
  webServer: { command: `uv run python ${process.env.SHOTS_SERVER} ${port}`, cwd: '..', url: `http://127.0.0.1:${port}/api/status`, reuseExistingServer: false, timeout: 180_000, stdout: 'ignore', stderr: 'pipe' },
});
