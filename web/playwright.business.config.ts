import { defineConfig } from '@playwright/test';
import cloud from './playwright.cloud.config';

// The SelectaDJ for Business browser tests named by ADR-0441 and ADR-0454 (web/e2e-business),
// over their own copy of the cloud e2e server (tests/e2e_cloud_server.py, controls in
// tests/e2e_cloud_business.py). Its own port and build folder.
//
//   pnpm exec playwright test -c playwright.business.config.ts
const python = process.env.SELECTA_PYTHON ?? 'uv run python';
const port = process.env.SELECTA_BUSINESS_E2E_PORT ?? '8822';
const dist = process.env.SELECTA_BUSINESS_E2E_DIST ?? 'dist-business-e2e';

export default defineConfig({
  ...cloud,
  testDir: './e2e-business',
  testMatch: '**/*.business.ts',
  outputDir: './test-results/business',
  use: { ...cloud.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `pnpm exec vite build -c vite.cloud-e2e.config.ts --outDir ${dist} --logLevel warn && pnpm exec vite build -c vite.cloud-e2e-authkit.config.ts --outDir ${dist}-authkit --logLevel warn && ${python} ../tests/e2e_cloud_server.py ${port}`,
    env: { ...process.env, SELECTA_CLOUD_E2E_DIST: dist } as Record<string, string>,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
