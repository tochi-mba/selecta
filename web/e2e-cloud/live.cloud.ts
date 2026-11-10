import { expect, test } from '@playwright/test';
import { accessible, listener, signedIn } from './cloud';

// SC-0407-03 (polling fallback when the event stream is blocked), SC-0391-04 (the cloud site's
// origin allowlist; web/e2e/pages.e2e.ts keeps the local "only talks to this computer") and
// SC-0404-05 (Lucy settings show only the person's own choices).

const overQuota = (page: import('@playwright/test').Page) => page.getByRole('alert').filter({ hasText: 'over Free’s' });

test('with the event stream live, a server change reaches the page at once', async ({ page, request }) => {
  const user = listener('live');
  await signedIn(page, request, user, { songs: 1, seconds: 1 });
  await expect(page.locator('.cloud-shell')).toHaveAttribute('data-stream', 'live');
  await request.post('/test/quota', { data: { user, limit_bytes: 1_000 } });
  await expect(overQuota(page)).toBeVisible({ timeout: 8_000 });
});

test('with the event stream blocked, the page falls back to polling and stays correct', async ({ page, request }) => {
  const user = listener('blocked');
  await page.route('**/api/events**', (route) => route.abort('blockedbyclient'));
  await signedIn(page, request, user, { songs: 1, seconds: 1 });
  await expect(page.locator('.cloud-shell')).toHaveAttribute('data-stream', 'polling');
  await expect(page.getByText(/Live updates are paused on this network/)).toBeVisible();
  // Changes no event announces: only polling can find them.
  await request.post('/test/quota-silent', { data: { user, limit_bytes: 1_000 } });
  await expect(overQuota(page)).toBeVisible({ timeout: 25_000 });
  await request.post('/test/quota-silent', { data: { user, limit_bytes: 10_000_000_000 } });
  await expect(overQuota(page)).toHaveCount(0, { timeout: 25_000 });

  await page.unroute('**/api/events**');
  await expect(page.locator('.cloud-shell')).toHaveAttribute('data-stream', 'live', { timeout: 45_000 });
  await expect(page.getByText(/Live updates are paused/)).toHaveCount(0);
});

test('the cloud site only talks to its allowlisted origins', async ({ page, request, baseURL }) => {
  // In production those are the API, R2, Stripe and AuthKit; this harness serves all of them
  // from one origin, so anything else is a leak.
  const allowed = new Set([new URL(baseURL!).origin]);
  const elsewhere: string[] = [];
  page.on('request', (sent) => {
    const url = new URL(sent.url());
    if (!['data:', 'blob:'].includes(url.protocol) && !allowed.has(url.origin)) elsewhere.push(sent.url());
  });
  await signedIn(page, request, listener('origins'), { songs: 2, seconds: 10 });
  const nav = page.getByRole('navigation', { name: 'Cloud workspace' });
  for (const target of ['Library', 'Add music', 'Plan & billing', 'Settings', 'Overview']) {
    await nav.getByRole('button', { name: target }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  await nav.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Listen to Song 2.wav' }).click();
  await expect(page.getByTestId('up-next')).toContainText('loaded', { timeout: 40_000 });
  expect(elsewhere).toEqual([]);
});

test('Lucy settings in Cloud show the plan’s level, the turn meter and only the person’s choices', async ({ page, request }) => {
  const user = listener('lucy');
  await signedIn(page, request, user, { path: '/account' });
  await request.post('/test/usage', { data: { user, amounts: { 'lucy_turn.haiku': 4 } } });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Lucy Basic' })).toBeVisible();
  await expect(page.getByText('4 of 40 turns this month')).toBeVisible();
  for (const hidden of [/Who does the planning/, /API key/, /Spending limit/, /Most rounds/]) await expect(page.getByText(hidden)).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await page.getByRole('checkbox', { name: /Share short lyric snippets/ }).check();
  await page.getByRole('button', { name: 'Save Lucy settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Share short lyric snippets/ })).toBeChecked();
  await accessible(page, 'account');
});
