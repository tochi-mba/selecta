import { defineConfig } from '@playwright/test';

// Selecta 4.0 server drills (S4-0102-09, S4-0103-08, S4-0105-07, S4-0107-09): each drill starts,
// stops and restarts its own real tests/e2e_server.py, so there is no shared webServer here.
// Run: pnpm exec playwright test -c playwright.drills.config.ts (SELECTA_E2E_DIST, SELECTA_E2E_PORT).
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.drill.ts',
  timeout: 600_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results-drills',
  use: {
    actionTimeout: 20_000,
    channel: 'msedge',
    headless: true,
    launchOptions: { args: ['--mute-audio'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
