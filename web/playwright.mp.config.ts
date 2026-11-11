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
  // its own folder: another spec's run empties test-results, and these files feed the register check
  outputDir: './mp-results',
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `${python} ../tests/e2e_server.py ${port}`,
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 300_000, // twenty synthesized songs on a busy 4-core laptop
    stdout: 'ignore',
    stderr: 'pipe',
    // SELECTA_E2E_STEMS: cached stems for the first transition, so 'fx.studio.open' can open the Studio
    env: { SELECTA_E2E_STRESS: '1', SELECTA_E2E_STEMS: '1' },
  },
});
