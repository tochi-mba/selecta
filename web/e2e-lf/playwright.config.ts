import { defineConfig } from '@playwright/test';

/**
 * LF19 isolated E2E entry point; NEVER add to global Playwright discovery
 * before the real LF UI, authenticated fixtures and test servers exist.
 * Missing integration URLs cause an explicit test failure (not a skip).
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 12_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../test-results/lf19',
  use: {
    headless: true,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: process.env.SELECTA_LF_E2E_STORAGE_STATE || undefined,
  },
});
