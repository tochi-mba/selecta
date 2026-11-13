import { expect, test, type Page, type Route } from '@playwright/test';
import { listener, signedIn } from '../e2e-cloud/cloud';

/**
 * LF10 cloud-harness scenarios. Integration owner must add this .spec.ts file to
 * the Cloud Playwright test discovery (see docs/integration/lf10.md). Never use
 * commercial recordings: only metadata fixtures and the existing fake auth.
 */
const verify = () => new Date().toISOString();
const fixture = () => ({
  schema_version: 1,
  devices: [
    { id: 'pc-1', display_name: 'Studio PC', role: 'engine', engine_state: 'ready', connectivity: 'online', output_state: 'verified', last_verified_at: verify(), verified_tracks: 5, total_tracks: 8 },
    { id: 'phone-1', display_name: 'Controller phone', role: 'controller', connectivity: 'online' },
  ],
  sources: [{ id: 'drive-1', device_id: 'pc-1', display_name: 'External drive', state: 'source_disconnected', total_tracks: 8, analysed_tracks: 5, unsupported_tracks: 1, last_scanned_at: verify() }],
  recent_recipes: [{ recipe_id: 'mix-1', revision_id: 'rev-1', title: 'Eight-song recipe', target_device_id: 'pc-1', status: 'missing', verified_tracks: 5, total_tracks: 8, last_verified_at: verify() }],
  playback_owner: { device_id: 'pc-1', output_name: 'Speakers', status: 'playing' },
  local_storage: [{ device_id: 'pc-1', used_bytes: 1000000000, free_bytes: 8000000000, cache_bytes: 500000000 }],
});
async function localAccount(page: Page) {
  await page.route('**/api/account', async (route) => {
    const response = await route.fetch();
    const account = await response.json();
    await route.fulfill({
      response,
      json: { ...account, features: { ...account.features, 'local_first.personal': true, 'cloud.uploads': false } },
    });
  });
}
const json = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

test('LF10: 320px, keyboard, light/dark and 400% zoom retain device controls', async ({ page, request }) => {
  await localAccount(page);
  await page.route('**/api/local-first/personal/snapshot', (route) => json(route, fixture()));
  await signedIn(page, request, listener('lf10-viewport'));
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const width of [320, 375, 1280]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });
      await expect(page.getByRole('combobox', { name: 'Selected music device' })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(scrollWidth, `${scheme} at ${width}px`).toBeLessThanOrEqual(1);
    }
  }
  await page.getByRole('combobox', { name: 'Selected music device' }).focus();
  await expect(page.getByRole('combobox', { name: 'Selected music device' })).toBeFocused();
  await page.getByRole('combobox', { name: 'Selected music device' }).selectOption('__controller_only__');
  await expect(page.getByText(/This browser cannot play music from another computer/)).toBeVisible();
});

test('LF10: /uploads deep link opens local source onboarding and never uploads audio', async ({ page, request }) => {
  const outgoing: string[] = [];
  await localAccount(page);
  await page.route('**/api/local-first/personal/snapshot', (route) => json(route, fixture()));
  page.on('request', (r) => {
    if (/\/api\/(uploads|assets|playback)/.test(new URL(r.url()).pathname)) outgoing.push(r.url());
  });
  await signedIn(page, request, listener('lf10-upload'), { path: '/uploads' });
  await expect(page.getByRole('heading', { name: 'Connect local music' }).first()).toBeVisible();
  await expect(page.getByText(/This browser does not upload originals/)).toBeVisible();
  expect(await page.locator('input[type="file"]').count()).toBe(0);
  expect(outgoing).toEqual([]);
});

test('LF10: disconnected drive, unknown cloud status and changing availability are truthful', async ({ page, request }) => {
  let available = true;
  let data = fixture();
  await localAccount(page);
  await page.route('**/api/local-first/personal/snapshot', (route) =>
    available ? json(route, data) : json(route, { detail: 'offline' }, 503));
  await signedIn(page, request, listener('lf10-offline'), { path: '/library' });
  await expect(page.getByText(/Drive disconnected/)).toBeVisible();
  expect(await page.getByText(/Analysis: 5 of 8/).count()).toBe(1);
  available = false;
  await page.getByRole('button', { name: 'Check devices again' }).click();
  await expect(page.getByText(/Device status is unavailable/)).toBeVisible();
  await expect(page.getByText(/Previously loaded device information/)).toBeVisible();
  available = true;
  data = { ...fixture(), sources: [{ ...fixture().sources[0], state: 'ready' }] };
  await page.getByRole('button', { name: 'Check devices again' }).click();
  await expect(page.getByText(/Indexed locally/)).toBeVisible();
});

test('LF10: missing engine endpoint is a recoverable unavailable state, not an empty music library', async ({ page, request }) => {
  await localAccount(page);
  await page.route('**/api/local-first/personal/snapshot', (route) => json(route, { detail: 'not installed' }, 404));
  await signedIn(page, request, listener('lf10-no-engine'), { path: '/library' });
  await expect(page.getByText(/Device management has not been enabled/)).toBeVisible();
  await expect(page.getByText(/Source inventory is unknown/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check devices again' })).toBeVisible();
  await expect(page.getByText('Your library is empty')).toHaveCount(0);
});
