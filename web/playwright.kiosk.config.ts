import { defineConfig } from '@playwright/test';
import cloud from './playwright.cloud.config';

// The kiosk player's browser tests (ADR-0445 BZ-0445-02, 04, 06, 08) over their own e2e Cloud
// server (`pnpm e2e:kiosk`). The shared cloud run ships the business flags off and a rule can
// never grant past a build-off (ADR-0414), so this server's build turns on the organisations,
// schedules and kiosk flags. Its own port and build folder: what every other spec sees is
// unchanged. Test controls: tests/e2e_cloud_kiosk.py.
const python = process.env.SELECTA_PYTHON ?? 'uv run python';
const port = process.env.SELECTA_KIOSK_PORT ?? '8818';
const dist = process.env.SELECTA_KIOSK_DIST ?? 'dist-kiosk-e2e';

export default defineConfig({
  ...cloud,
  testMatch: '**/*.kiosk.ts',
  outputDir: './test-results/kiosk',
  use: { ...cloud.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `pnpm exec vite build -c vite.cloud-e2e.config.ts --outDir ${dist} --logLevel warn && pnpm exec vite build -c vite.cloud-e2e-authkit.config.ts --outDir ${dist}-authkit --logLevel warn && ${python} ../tests/e2e_cloud_server.py ${port}`,
    env: { ...process.env, SELECTA_CLOUD_E2E_DIST: dist, SELECTA_FLAGS: '+business.orgs +business.schedules +business.kiosk +business.offline' } as Record<string, string>,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
