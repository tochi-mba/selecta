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
  // the catalogue songs the seed registered, in the shared Library, and Connect music in its
  // header (a menu: a folder or single songs, 02889fe5)
  await expect(page.getByRole('button', { name: /^Details for Local song 1 / })).toBeVisible();
  const connect = page.getByRole('main').getByRole('button', { name: 'Connect music', exact: true });
  await connect.click();
  await expect(page.getByRole('menuitem', { name: 'Choose a folder' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Choose songs' })).toBeVisible();
  await page.keyboard.press('Escape');
  // nobody meets an upload surface they were not granted
  await expect(page.getByText(/upload tracks/i)).toHaveCount(0);
});

test('a local-first account finds its account places in the side bar account menu, and no dead button', async ({ page, request }) => {
  const user = listener('local-first-more');
  await seededWith(request, user, 1);
  await openLocalFirst(page, user, '/listen');
  // Listen with nothing playable here: its empty state sends the member to connect music
  await expect(page.getByRole('heading', { name: 'Listen', level: 1 })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Connect music' })).toBeVisible();
  // on a computer there is no More: the account's pages and Sign out sit in the account menu
  const main = page.getByRole('navigation', { name: 'Main' });
  await expect(main.getByRole('button', { name: 'More' })).toBeHidden();
  await main.getByRole('button', { name: /^Account: / }).click();
  const menu = page.getByRole('menu', { name: 'Account' });
  await expect(menu.getByRole('menuitem', { name: 'Account' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Plan & billing' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add music' })).toHaveCount(0);

  // the hosted rail's account controls all live on Account, and each one is there to press
  await menu.getByRole('menuitem', { name: 'Account' }).click();
  const signedIn = page.getByRole('region', { name: 'Signed in as' });
  await expect(signedIn).toContainText(`${user}@example.test`);
  await expect(signedIn.getByRole('button', { name: 'Sign out' })).toBeVisible();
  // the two account removals open a confirmation first, so their buttons end with an ellipsis
  for (const name of ['Download my data', 'Sign out everywhere…', 'Delete account…']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.locator('footer.cloud-footer')).toContainText('Your music files stay on your devices');
  // a new local-first member has no hosted library to line up
  await expect(page.getByRole('heading', { name: 'How your libraries line up' })).toHaveCount(0);
});

test('a grandfathered local-first account sees how its hosted and device libraries line up', async ({ page, request }) => {
  const user = listener('local-first-reconcile');
  await seededWith(request, user, 1);
  await openLocalFirst(page, user, '/account', { hosted: true });
  await expect(page.getByRole('heading', { name: 'How your libraries line up' })).toBeVisible();
  // it loads both libraries from the real server through the injected client (no '/api/api')
  await expect(page.getByText(/\d+ matched · \d+ only in your hosted library · \d+ only on your devices/)).toBeVisible();
  await expect(page.getByText('SelectaDJ couldn’t load both libraries just now. Nothing was changed.')).toHaveCount(0);
});

test('a flag switched off for a local-first account reflows its open shell over the event stream (BF-0462-03)', async ({ page, request }) => {
  const user = listener('local-first-live');
  await seededWith(request, user, 1);
  await openLocalFirst(page, user, '/listen');
  await page.evaluate(() => { (window as unknown as { stayed: boolean }).stayed = true; });
  // Devices is listed in the side bar itself
  const more = page.getByRole('navigation', { name: 'Main' });
  await expect(more.getByRole('link', { name: 'Devices' })).toBeVisible();

  // a real per-user rule: the server publishes `flags.changed`, the shell reads its account again
  // and the one flag read closes the side bar up around the feature, without a reload
  const off = await request.post('/test/flags/off', { data: { user, flags: ['devices'] } });
  expect(off.ok(), await off.text()).toBeTruthy();
  await expect(more.getByRole('link', { name: 'Devices' })).toHaveCount(0, { timeout: 10_000 });
  await expect(more.getByRole('button', { name: /^Account: / })).toBeVisible();

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
