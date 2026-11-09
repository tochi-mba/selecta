import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The feature-flag sweep: every feature off in turn, on every page it shows up on. The same server,
// browser and settings as the ordinary run, which leaves this file out.
export default defineConfig({
  ...base,
  testMatch: '**/flags.e2e.ts',
  testIgnore: [],
});
