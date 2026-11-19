import { expect, test } from '@playwright/test';
import { listener, signedIn } from '../e2e-cloud/cloud';
import { seedBusiness, sideways } from './helpers';

// ADR-0454 "UI" tests (BZ-0454-05), each named after its ADR entry.

const STATES = ['normal', 'empty', 'silent', 'long_pause', 'over_seats', 'licence_expiring', 'licence_expired', 'grace', 'grace_final',
  'grace_ended', 'plan_locked', 'pilot', 'pilot_ending', 'pilot_ended', 'degraded', 'stress'];

test('every surface renders each state in its matrix', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const state of STATES) {
    await page.goto(`/business-harness.html?scenario=${state}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Organisation' })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

const MANAGER_ONLY = ['Set up SelectaDJ for Business', 'SelectaDJ for Business pricing', 'Update payment to make changes'];

test('customer bundles never contain manager copy', async ({ page, request }) => {
  await page.goto('/kiosk');
  const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean)
    .concat(performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.endsWith('.js'))));
  expect(scripts.length).toBeGreaterThan(0);
  for (const src of new Set(scripts)) {
    const body = await (await request.get(new URL(src).pathname)).text();
    for (const words of MANAGER_ONLY) expect(body.includes(words), `${src}: ${words}`).toBe(false);
  }
});

test('staff view has no destructive control', async ({ page, request }) => {
  const owner = listener('ui-owner');
  const staff = listener('ui-staff');
  await signedIn(page, request, owner);
  await signedIn(page, request, staff);
  const seeded = await seedBusiness(page, owner, { staff });
  await page.goto(`/b/${seeded.org}`);
  await expect(page.getByRole('heading', { name: /^Staff controls/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Delete|Unpair|Archive|Remove/i })).toHaveCount(0);
});

test('silent zone alert appears within 70 seconds and clears', async () => {
  test.fixme(true, 'Needs a paired kiosk that reports digital silence; the kiosk e2e server (playwright.kiosk.config.ts) has no control to silence a player yet. The alert timing is tests/test_business_kiosk_alerts.py.');
});

test('workspace band on every business page', async ({ page, request }) => {
  const owner = listener('ui-band');
  await signedIn(page, request, owner);
  const seeded = await seedBusiness(page, owner);
  for (const path of [`/b/${seeded.org}`, `/b/${seeded.org}/venues`, `/b/${seeded.org}/v/${seeded.venues[0]}`, `/b/${seeded.org}/people`, `/b/${seeded.org}/settings`]) {
    await page.goto(path);
    await expect(page.locator('[data-workspace-band="business"]'), path).toBeVisible();
  }
});

test('400 percent zoom reflows every surface', async ({ page, request }) => {
  const owner = listener('ui-zoom');
  await signedIn(page, request, owner);
  const seeded = await seedBusiness(page, owner, { selling: true });
  // 1280 px at 400% zoom lays out like a 320 px viewport (WCAG 1.4.10).
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of [`/b/${seeded.org}`, `/b/${seeded.org}/venues`, `/b/${seeded.org}/v/${seeded.venues[0]}`, '/business/pricing', '/business-harness.html']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    expect(await sideways(page), path).toBeLessThanOrEqual(1);
  }
});

test('reduced motion stops every animation on the kiosk', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/kiosk');
  await expect(page.getByRole('heading').first()).toBeVisible();
  await page.waitForTimeout(500);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  expect(running).toBe(0);
});

test('500 venues grid sorts and searches under 100 ms', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/business-harness.html?grid=500');
  const grid = page.getByRole('region', { name: 'Venue grid' });
  await expect(grid.getByRole('grid')).toBeVisible();
  const timings: number[] = [];
  for (const query of ['Riverside', 'Venue 4', '']) {
    await page.getByLabel('Search venues', { exact: true }).fill(query);
    timings.push(Number(await grid.getAttribute('data-arrange-ms')));
  }
  for (const sort of ['name', 'region', 'severity']) {
    await page.locator('#grid-sort').selectOption(sort);
    timings.push(Number(await grid.getAttribute('data-arrange-ms')));
  }
  expect(timings.every((ms) => Number.isFinite(ms) && ms < 100), timings.join(', ')).toBe(true);
});
