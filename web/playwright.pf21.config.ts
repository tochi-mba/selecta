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
    // Chromium launch flags are not understood by other engines. PF21_FIREFOX / PF21_WEBKIT may
    // point at an already installed engine build when the pinned one is not downloaded.
    { name: 'Firefox', use: { ...devices['Desktop Firefox'], launchOptions: { args: [], executablePath: process.env.PF21_FIREFOX } } },
    { name: 'WebKit (Safari engine)', use: { ...devices['Desktop Safari'], launchOptions: { args: [], executablePath: process.env.PF21_WEBKIT } } },
  ],
});
