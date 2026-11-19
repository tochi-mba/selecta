import { defineConfig, devices } from '@playwright/test';
import cloud from './playwright.cloud.config';

// SC-0399-02 is intentionally separate from the ordinary Edge-only cloud suite: release
// evidence must exercise each browser engine's actual audio decoder. WebKit is the automated
// Safari-engine check; the checklist still requires the owner's real-Safari listening pass.

// TEMP(2026-11-18): packages.microsoft.com intermittently serves a bad signing key and the Edge
// install fails in CI. SELECTA_E2E_CHANNEL=chromium runs this suite on Playwright's bundled
// Chromium instead of Chrome and Edge. Remove once the mirror is reliable.
const chromiumProjects =
  process.env.SELECTA_E2E_CHANNEL === 'chromium'
    ? [{ name: 'Chromium (fallback)', use: { ...devices['Desktop Chrome'], channel: undefined } }]
    : [
        { name: 'Chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
        { name: 'Edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
      ];

export default defineConfig({
  ...cloud,
  testMatch: '**/playback-alignment.cloud.ts',
  outputDir: './test-results/alignment',
  // The cloud config pins channel 'msedge' for its Edge-only suite; Firefox and WebKit reject
  // any channel, so only the Chromium projects below name one.
  use: { ...cloud.use, channel: undefined },
  projects: [
    ...chromiumProjects,
    // Chromium launch flags from the Cloud suite are not understood by other engines.
    { name: 'Firefox', use: { ...devices['Desktop Firefox'], launchOptions: { args: [] } } },
    { name: 'WebKit (Safari engine)', use: { ...devices['Desktop Safari'], launchOptions: { args: [] } } },
  ],
});
