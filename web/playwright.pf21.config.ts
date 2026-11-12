import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// PF-21 runs the first-Play check in each browser engine, like playwright.alignment.config.ts:
// Edge for Chromium, Firefox, and WebKit as the automated Safari-engine check.
export default defineConfig({
  ...base,
  testMatch: '**/pf-21-first-play.e2e.ts',
  testIgnore: [],
  use: { ...base.use, channel: undefined },
  projects: [
    { name: 'Edge', use: { ...devices['Desktop Edge'], channel: 'msedge', launchOptions: { args: ['--mute-audio'] } } },
    // Chromium launch flags are not understood by other engines.
    { name: 'Firefox', use: { ...devices['Desktop Firefox'], launchOptions: { args: [] } } },
    { name: 'WebKit (Safari engine)', use: { ...devices['Desktop Safari'], launchOptions: { args: [] } } },
  ],
});
