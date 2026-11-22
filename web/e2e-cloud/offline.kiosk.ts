import { expect, test } from '@playwright/test';
import { audible, makeOrg, pairedKiosk } from './kioskHelpers';

// ADR-0446 offline-first playback on the real /kiosk page (playwright.kiosk.config.ts). Time is
// compressed: each test song is 30 s of audio catalogued as 30 minutes long, so a horizon of
// hours is a handful of small files, and "hours offline" is shown by what the player holds and
// keeps doing with the network switched off, not by waiting hours.

const savedHours = async (page: import('@playwright/test').Page) =>
  Number(await page.locator('html').getAttribute('data-saved-hours'));

test('test_four_hours_of_music_are_saved_ahead_during_opening', async ({ page, baseURL }) => {
  const org = await makeOrg(page.request, true, { songs: 9, recorded_seconds: 1800 });
  await pairedKiosk(page, baseURL!, org);
  await audible(page);
  await expect.poll(() => savedHours(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(3.9);
});

test('test_device_storage_cap_holds_what_fits_and_never_drops_the_next_songs', async ({ page, baseURL }) => {
  // a browser reporting a small quota: the cap is half of it, so only part of four hours fits;
  // the three committed songs are always kept (eviction order itself is in zoneCache's vitest)
  await page.addInitScript(() => {
    const storage = navigator.storage as StorageManager & { estimate: () => Promise<StorageEstimate> };
    storage.estimate = async () => ({ usage: 0, quota: 24 * 1024 * 1024 });
  });
  const org = await makeOrg(page.request, true, { songs: 9, recorded_seconds: 1800 });
  await pairedKiosk(page, baseURL!, org);
  await audible(page);
  await expect.poll(() => savedHours(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(1.4);
  await page.waitForTimeout(10_000); // let any further downloads try
  expect(await savedHours(page)).toBeLessThan(3.9);
});

test('test_internet_drop_for_two_hours_keeps_playing', async ({ page, context, baseURL }) => {
  const org = await makeOrg(page.request, true, { songs: 9, recorded_seconds: 1800 });
  await pairedKiosk(page, baseURL!, org);
  await audible(page);
  await expect.poll(() => savedHours(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  await context.setOffline(true);
  await expect(page.locator('[data-screen="playing_saved"]')).toBeVisible({ timeout: 30_000 });
  for (let second = 0; second < 15; second += 5) {
    await page.waitForTimeout(5_000);
    await expect(page.locator('html')).toHaveAttribute('data-audible', 'yes');
  }
  await context.setOffline(false);
  await expect(page.locator('[data-screen="playing"]')).toBeVisible({ timeout: 30_000 });
});

test('test_offline_beyond_saved_music_shows_back_shortly', async ({ page, context, baseURL }) => {
  // nothing can be saved: every file URL is refused
  await page.route('**/api/kiosk/segment-url', (route) => route.fulfill({ status: 503, body: '{}' }));
  const org = await makeOrg(page.request);
  await pairedKiosk(page, baseURL!, org);
  await expect(page.locator('[data-screen="problem"]')).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await expect(page.getByRole('heading', { name: 'The music will be back shortly' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-audible', 'no');
});

test('test_kiosk_clock_six_hours_wrong_uses_server_time', async ({ page, baseURL }) => {
  // the zone opens only from an hour ago to an hour ahead; the device clock says six hours on
  await page.clock.setFixedTime(new Date(Date.now() + 6 * 3600 * 1000));
  const org = await makeOrg(page.request, true, { window_hours: 1 });
  await pairedKiosk(page, baseURL!, org);
  await audible(page);
  await expect(page.locator('[data-screen="playing"]')).toBeVisible();
});
