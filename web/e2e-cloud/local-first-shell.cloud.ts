import { APIRequestContext, expect, test } from '@playwright/test';
import { listener } from './cloud';
import { openLocalFirst, seeded } from './localFirst';

// ADR-0462/0463 mounting: an account with the local-first experience and `cloud.local_first`
// on gets the shared shell (Listen, Make a Mix, My Mixes, Library, with Cloud's own places in
// More); every other account keeps the hosted pages exactly as before.
//
// How the spec turns the experience on for its one person: see localFirst.ts.

async function seededWith(request: APIRequestContext, user: string, localSongs: number) {
  await seeded(request, user, { local_songs: localSongs });
}

test('a local-first account sees the shared music destinations', async ({ page, request }) => {
  const user = listener('local-first');
  await seededWith(request, user, 2);
  await openLocalFirst(page, user, '/library');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();
  for (const name of ['Listen', 'Make a Mix', 'My Mixes', 'Library']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('navigation', { name: 'Cloud workspace' })).toHaveCount(0);
  // the catalogue songs the seed registered, in the shared Library, and Connect Music beside them
  await expect(page.getByRole('button', { name: 'Details for Local song 1' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connect music' })).toBeVisible();
  // nobody meets an upload surface they were not granted
  await expect(page.getByText(/upload tracks/i)).toHaveCount(0);
});

test('a local-first account finds account places in More, and no dead button', async ({ page, request }) => {
  const user = listener('local-first-more');
  await seededWith(request, user, 1);
  await openLocalFirst(page, user, '/listen');
  await expect(page.getByRole('heading', { name: 'Nothing is playing' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More' }).first().click();
  const more = page.getByRole('navigation', { name: 'More' });
  await expect(more.getByRole('link', { name: 'Account' })).toBeVisible();
  await expect(more.getByRole('link', { name: 'Plan & billing' })).toBeVisible();
  await expect(more.getByRole('link', { name: 'Add music' })).toHaveCount(0);
});

test('a flag switched off for a local-first account reflows its open shell over the event stream (BF-0462-03)', async ({ page, request }) => {
  const user = listener('local-first-live');
  await seededWith(request, user, 1);
  await openLocalFirst(page, user, '/listen');
  await page.evaluate(() => { (window as unknown as { stayed: boolean }).stayed = true; });
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More' }).first().click();
  const more = page.getByRole('navigation', { name: 'More' });
  await expect(more.getByRole('link', { name: 'Devices' })).toBeVisible();

  // a real per-user rule: the server publishes `flags.changed`, the shell reads its account again
  // and the one flag read closes More up around the feature, without a reload
  const off = await request.post('/test/flags/off', { data: { user, flags: ['devices'] } });
  expect(off.ok(), await off.text()).toBeTruthy();
  await expect(more.getByRole('link', { name: 'Devices' })).toHaveCount(0, { timeout: 10_000 });
  await expect(more.getByRole('link', { name: 'Account' })).toBeVisible();

  const back = await request.post('/test/flags/off', { data: { user, flags: [] } });
  expect(back.ok(), await back.text()).toBeTruthy();
  await expect(more.getByRole('link', { name: 'Devices' })).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
});

test('a legacy account keeps the hosted Cloud pages', async ({ page, request }) => {
  const user = listener('legacy');
  await seededWith(request, user, 0);
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Cloud workspace' })).toBeVisible();
  await expect(page.locator('main h1')).toHaveText('Your music workspace');
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});
