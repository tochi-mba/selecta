import { defineConfig } from '@playwright/test';
import cloud from './playwright.cloud.config';

// The ADR-0450 content controls and ADR-0451 Rooms for Business browser runs
// (web/e2e-business/*.content.ts), over their own copy of the cloud e2e server with those flags
// built on (SELECTA_E2E_CONTENT=1, tests/e2e_cloud_business.py). Its own port and build folder.
//
//   pnpm exec playwright test -c playwright.content.config.ts
const python = process.env.SELECTA_PYTHON ?? 'uv run python';
const port = process.env.SELECTA_CONTENT_E2E_PORT ?? '8832';
const dist = process.env.SELECTA_CONTENT_E2E_DIST ?? 'dist-content-e2e';

export default defineConfig({
  ...cloud,
  testDir: './e2e-business',
  testMatch: '**/*.content.ts',
  outputDir: './test-results/content',
  use: { ...cloud.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `pnpm exec vite build -c vite.cloud-e2e.config.ts --outDir ${dist} --logLevel warn && pnpm exec vite build -c vite.cloud-e2e-authkit.config.ts --outDir ${dist}-authkit --logLevel warn && ${python} ../tests/e2e_cloud_server.py ${port}`,
    env: { ...process.env, SELECTA_CLOUD_E2E_DIST: dist, SELECTA_E2E_CONTENT: '1' } as Record<string, string>,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
