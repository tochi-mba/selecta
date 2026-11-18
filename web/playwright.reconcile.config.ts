import { defineConfig } from '@playwright/test';
import cloud from './playwright.cloud.config';

// BF-0465-02: the migration reconciliation over the e2e Cloud server (`pnpm e2e:reconcile`).
// The same server and site as `pnpm e2e:cloud`, except that this build turns the local media
// catalogue on (SELECTA_FLAGS=+cloud.local_media), because the reconciliation reads it and a
// per-account rule can never grant past a build-off (ADR-0414). Its own port and build folder,
// so it never meets the ordinary cloud run, whose build keeps the catalogue off.
const python = process.env.SELECTA_PYTHON ?? 'uv run python';
const port = process.env.SELECTA_RECONCILE_PORT ?? '8815';
const dist = process.env.SELECTA_RECONCILE_DIST ?? 'dist-reconcile';

export default defineConfig({
  ...cloud,
  testMatch: '**/*.reconcile.ts',
  outputDir: './test-results/reconcile',
  use: { ...cloud.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `pnpm exec vite build -c vite.cloud-e2e.config.ts --outDir ${dist} --logLevel warn && pnpm exec vite build -c vite.cloud-e2e-authkit.config.ts --outDir ${dist}-authkit --logLevel warn && ${python} ../tests/e2e_cloud_server.py ${port}`,
    env: { ...process.env, SELECTA_CLOUD_E2E_DIST: dist, SELECTA_FLAGS: '+cloud.local_media' } as Record<string, string>,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
