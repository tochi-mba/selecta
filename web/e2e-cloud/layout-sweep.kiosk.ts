import { expect, test } from '@playwright/test';
import { sweep, verdict } from '../e2e/layoutSweep';
import { makeOrg, pairedKiosk } from './kioskHelpers';

// The kiosk's layout sweep (e2e/layoutSweep.ts says what is measured), against the kiosk e2e server
// (playwright.kiosk.config.ts): the pairing screen, then the paired player playing, then closed.
//
//   pnpm exec playwright test -c playwright.kiosk.config.ts e2e-cloud/layout-sweep.kiosk.ts

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('the kiosk pairing, playing and closed', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(600_000);
  const problems: string[] = [];
  await page.goto('/kiosk');
  await expect(page.getByRole('heading', { name: 'Pair this player' })).toBeVisible();
  problems.push(...(await sweep(page, testInfo, 'kiosk pairing')));
  const org = await makeOrg(page.request);
  await pairedKiosk(page, baseURL!, org);
  await expect(page.locator('[data-screen="playing"]')).toBeVisible({ timeout: 30_000 });
  problems.push(...(await sweep(page, testInfo, 'kiosk playing')));
  expect((await page.request.post('/test/kiosk/hours', { data: { org: org.org, venue: org.venue, open: false } })).ok()).toBe(true);
  await page.reload();
  await page.locator('[data-screen]').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  problems.push(...(await sweep(page, testInfo, 'kiosk closed')));
  await verdict(testInfo, problems);
});
