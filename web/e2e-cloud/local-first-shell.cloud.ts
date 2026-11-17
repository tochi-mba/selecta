import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { listener } from './cloud';

// ADR-0462/0463 mounting: an account with the local-first experience and `cloud.local_first`
// on gets the shared shell (Listen, Make a Mix, My Mixes, Library, with Cloud's own places in
// More); every other account keeps the hosted pages exactly as before.
//
// The build ships `cloud.local_first` off by default and a per-user rule can never grant what
// the build denies (ADR-0414), so this spec turns it on for its one person by amending the
// account answer in the browser: the server's own decision is replaced only for the two fields
// that select the shell (`experience.local_first`, `features["cloud.local_first"]`). Everything
// else, including the catalogue songs, comes from the real e2e server.

async function seeded(request: APIRequestContext, user: string, localSongs: number) {
  const seed = await request.post('/test/seed', { data: { user, local_songs: localSongs } });
  expect(seed.ok(), await seed.text()).toBeTruthy();
}

/** Open the site as `user`, with the local-first experience switched on for them. */
async function openLocalFirst(page: Page, user: string, path: string) {
  await page.route('**/api/account', async (route) => {
    const answer = await route.fetch();
    const account = await answer.json();
    account.experience = { ...(account.experience ?? {}), local_first: true };
    account.features = { ...account.features, 'cloud.local_first': true, 'cloud.local_media': true };
    await route.fulfill({ response: answer, json: account });
  });
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  await page.goto(path);
}

test('a local-first account sees the shared music destinations', async ({ page, request }) => {
  const user = listener('local-first');
  await seeded(request, user, 2);
  await openLocalFirst(page, user, '/library');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();
  for (const name of ['Listen', 'Make a Mix', 'My Mixes', 'Library']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('navigation', { name: 'Cloud workspace' })).toHaveCount(0);
  // the catalogue songs the seed registered, in the shared Library, and Connect Music beside them
  await expect(page.getByText('Local song 1')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connect music' })).toBeVisible();
  // nobody meets an upload surface they were not granted
  await expect(page.getByText(/upload tracks/i)).toHaveCount(0);
});

test('a local-first account finds account places in More, and no dead button', async ({ page, request }) => {
  const user = listener('local-first-more');
  await seeded(request, user, 1);
  await openLocalFirst(page, user, '/listen');
  await expect(page.getByRole('heading', { name: 'Nothing is playing' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More' }).first().click();
  const more = page.getByRole('navigation', { name: 'More' });
  await expect(more.getByRole('link', { name: 'Account' })).toBeVisible();
  await expect(more.getByRole('link', { name: 'Plan & billing' })).toBeVisible();
  await expect(more.getByRole('link', { name: 'Add music' })).toHaveCount(0);
});

test('a legacy account keeps the hosted Cloud pages', async ({ page, request }) => {
  const user = listener('legacy');
  await seeded(request, user, 0);
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Cloud workspace' })).toBeVisible();
  await expect(page.locator('main h1')).toHaveText('Your music workspace');
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});
