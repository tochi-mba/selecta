import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { listener } from './cloud';

// BF-0467-05: the Labs opt-in card (web/src/cloud/labs/LocalFirstLabs.tsx) in Cloud settings,
// against the real routes (src/selecta/routes/local_first_labs.py) on a server whose build turns
// `cloud.local_first` and `cloud.local_first_labs` on (playwright.labs.config.ts, `pnpm e2e:labs`).
// `cloud.local_first`'s rules end with a 0% catch-all, the cutover shape, so nobody has the
// local-first experience until they join: joining writes them into the Labs cohort rule ahead of
// it. Nothing here amends an account answer in the browser; every decision is the server's.

test.beforeAll(async ({ request }) => {
  const staged = await request.post('/test/flags/catch-all', { data: { flag: 'cloud.local_first' } });
  expect(staged.ok(), await staged.text()).toBeTruthy();
  expect((await staged.json()).error).toBeUndefined();
});

async function member(page: Page, request: APIRequestContext, name: string) {
  const user = listener(name);
  const seeded = await request.post('/test/seed', { data: { user } });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await page.addInitScript((who) => localStorage.setItem('selecta-e2e-user', who), user);
  return { user, auth: { Authorization: `Bearer e2e:${user}`, Origin: String(test.info().project.use.baseURL) } };
}

test('joining Labs puts the account in browser-first Cloud, and leaving returns it', async ({ page, request }) => {
  const { auth } = await member(page, request, 'labs-join');
  const before = await (await request.get('/api/account', { headers: auth })).json();
  expect(before.features['cloud.local_first'], 'the catch-all leaves a new member out').toBe(false);
  expect(before.features['cloud.local_first_labs']).toBe(true);

  // The hosted pages, with the Labs card in settings.
  await page.goto('/account');
  await expect(page.getByRole('navigation', { name: 'Cloud workspace' })).toBeVisible();
  const card = page.getByRole('region', { name: 'Labs: browser-first Cloud' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Join Labs' }).click();

  // The shell switches: the shared local-first navigation replaces the hosted menu.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('navigation', { name: 'Cloud workspace' })).toHaveCount(0);
  const joined = await (await request.get('/api/account', { headers: auth })).json();
  expect(joined.features['cloud.local_first']).toBe(true);
  expect(joined.experience.local_first).toBe(true);
  const status = await (await request.get('/api/account/labs/local-first', { headers: auth })).json();
  expect(status).toMatchObject({ enrolled: true, on: true, labs_open: true });

  // Leave, from the same card in the local-first shell's account place.
  await page.goto('/account');
  const inShell = page.getByRole('region', { name: 'Labs: browser-first Cloud' });
  await expect(inShell.getByRole('button', { name: 'Leave Labs' })).toBeVisible();
  await inShell.getByRole('button', { name: 'Leave Labs' }).click();
  // leaving asks first, in the shared confirmation
  await page.getByRole('alertdialog', { name: 'Leave Labs?' }).getByRole('button', { name: 'Yes, leave Labs' }).click();
  await expect(page.getByRole('navigation', { name: 'Cloud workspace' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  const left = await (await request.get('/api/account', { headers: auth })).json();
  expect(left.features['cloud.local_first']).toBe(false);
  expect((await (await request.get('/api/account/labs/local-first', { headers: auth })).json()).enrolled).toBe(false);
});

test('with Labs closed, joining is refused with the honest reason and the card is gone', async ({ page, request }) => {
  const { user, auth } = await member(page, request, 'labs-closed');
  // The owner closes Labs for this member (a real per-user rule on the companion flag).
  const closed = await request.post('/test/flags/off', { data: { user, flags: ['cloud.local_first_labs'] } });
  expect(closed.ok(), await closed.text()).toBeTruthy();

  const refused = await request.post('/api/account/labs/local-first/join', { headers: auth });
  expect(refused.status()).toBe(403);
  const detail = (await refused.json()).detail;
  expect(detail).toMatchObject({ code: 'flag_off', flag: 'cloud.local_first_labs' });
  expect(detail.message).toContain('Labs: browser-first Cloud');
  expect(detail.message).toContain("isn't available on this account right now");
  // Where they stand is still readable, and true: not in, Labs closed, the experience off.
  const status = await (await request.get('/api/account/labs/local-first', { headers: auth })).json();
  expect(status).toMatchObject({ enrolled: false, on: false, labs_open: false });

  // Closed and not in: the card renders nothing, and the settings page closes up around it.
  await page.goto('/account');
  await expect(page.getByRole('heading', { level: 1, name: 'Account settings' })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByRole('region', { name: 'Labs: browser-first Cloud' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Join Labs' })).toHaveCount(0);
  await request.post('/test/flags/off', { data: { user, flags: [] } });
});
