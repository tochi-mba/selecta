import { expect, Page, test } from '@playwright/test';
import { accessible, listener, signedIn } from './cloud';

// Venue hours (ADR-0444) and business usage (ADR-0448) in the real Cloud app. The test server
// builds the business flags on with a last "0 percent" rule; `/test/business/seed` turns them on
// for this test's people, except the ones named in `without`, which stay off for them.

type Seeded = { org: string; venues: string[]; zones: string[] };

async function seed(page: Page, owner: string, without: string[] = []): Promise<Seeded> {
  const made = await page.request.post('/test/business/seed', { data: { user: owner, without } });
  expect(made.ok(), await made.text()).toBeTruthy();
  return (await made.json()) as Seeded;
}

test('with business.schedules and business.entitlements off, their pages are gone and the layout reflows', async ({ page, request }) => {
  const owner = listener('biz-flags-off');
  await signedIn(page, request, owner);
  const seeded = await seed(page, owner, ['business.schedules', 'business.entitlements']);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/b/${seeded.org}/v/${seeded.venues[0]}`);
  const tabs = page.getByRole('navigation', { name: 'Venue sections' });
  await expect(tabs.getByRole('button', { name: 'Now' })).toBeVisible();
  for (const gone of ['Today', 'Schedule', 'Hours', 'Upload music']) {
    await expect(tabs.getByRole('button', { name: gone, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('link', { name: 'Usage', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Schedules', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const usage = await page.request.get('/api/business/usage', { headers: { 'X-Workspace-ID': seeded.org } });
  expect(usage.status()).toBeGreaterThanOrEqual(400);
  const hours = await page.request.get(`/api/business/venues/${seeded.venues[0]}/hours`, { headers: { 'X-Workspace-ID': seeded.org } });
  expect(hours.status()).toBeGreaterThanOrEqual(400);
});

test('an owner reads the usage meters with the pooled storage and the continuity table', async ({ page, request }) => {
  const owner = listener('biz-usage');
  await signedIn(page, request, owner);
  const seeded = await seed(page, owner);
  await page.goto(`/b/${seeded.org}/usage`);
  await expect(page.getByRole('heading', { level: 1, name: 'Usage' })).toBeVisible();
  await expect(page.getByText('Storage', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Pooled: 250 GB for the organisation/)).toBeVisible();
  await expect(page.getByText('Staff seats', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'By venue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Playback continuity this month' })).toBeVisible();
  await accessible(page, 'business usage');
});

test('an owner sets opening hours and the closing mode on the venue Hours tab', async ({ page, request }) => {
  const owner = listener('biz-hours');
  await signedIn(page, request, owner);
  const seeded = await seed(page, owner);
  await page.goto(`/b/${seeded.org}/v/${seeded.venues[0]}/hours`);
  await expect(page.getByRole('heading', { name: /^Opening hours for / })).toBeVisible();
  await page.getByRole('button', { name: 'Save opening hours' }).click();
  await expect(page.getByText(/Opening hours saved/)).toBeVisible();
  await page.getByRole('radio', { name: /End exactly at the closing time/ }).check();
  await expect(page.getByText('Closing time setting saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: /End exactly at the closing time/ })).toBeChecked();
  await accessible(page, 'venue hours');
});
