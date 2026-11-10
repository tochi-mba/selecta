import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// MP-0272 measured baseline: the same browser and server as the ordinary run, on its own port, with
// the stress-metadata library (SELECTA_E2E_STRESS=1 in tests/e2e_server.py). The ordinary run leaves
// these specs out, so its screenshots keep the twelve-song library. `pnpm e2e:mp`.
const python = process.env.SELECTA_PYTHON ?? 'uv run python';
const port = process.env.SELECTA_MP_PORT ?? '8797';

export default defineConfig({
  ...base,
  testMatch: '**/*.mp.ts',
  testIgnore: [],
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `${python} ../tests/e2e_server.py ${port}`,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { SELECTA_E2E_STRESS: '1' },
  },
});
