import { defineConfig, devices } from '@playwright/test';
import cloud from './playwright.cloud.config';

// SC-0399-02 is intentionally separate from the ordinary Edge-only cloud suite: release
// evidence must exercise each browser engine's actual audio decoder. WebKit is the automated
// Safari-engine check; the checklist still requires the owner's real-Safari listening pass.
export default defineConfig({
  ...cloud,
  testMatch: '**/playback-alignment.cloud.ts',
  outputDir: './test-results/alignment',
  projects: [
    { name: 'Chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'Edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
    { name: 'Firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'WebKit (Safari engine)', use: { ...devices['Desktop Safari'] } },
  ],
});
