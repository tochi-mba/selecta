import { defineConfig } from '@playwright/test';
import cloud from './playwright.cloud.config';

// BF-0467-05: the Labs opt-in for browser-first Cloud over its own e2e Cloud server
// (`pnpm e2e:labs`). The shared cloud run ships `cloud.local_first` off, and a rule can never
// grant past a build-off (ADR-0414), so this server's build turns `cloud.local_first` and
// `cloud.local_first_labs` on; the spec then ends `cloud.local_first`'s rules with a 0%
// catch-all, so only members who join have it. Its own port and build folder: what every other
// spec sees is unchanged.
const python = process.env.SELECTA_PYTHON ?? 'uv run python';
const port = process.env.SELECTA_LABS_PORT ?? '8816';
const dist = process.env.SELECTA_LABS_DIST ?? 'dist-labs';

export default defineConfig({
  ...cloud,
  testMatch: '**/*.labs.ts',
  outputDir: './test-results/labs',
  use: { ...cloud.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `pnpm exec vite build -c vite.cloud-e2e.config.ts --outDir ${dist} --logLevel warn && pnpm exec vite build -c vite.cloud-e2e-authkit.config.ts --outDir ${dist}-authkit --logLevel warn && ${python} ../tests/e2e_cloud_server.py ${port}`,
    env: { ...process.env, SELECTA_CLOUD_E2E_DIST: dist, SELECTA_FLAGS: '+cloud.local_first +cloud.local_first_labs' } as Record<string, string>,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
