import { expect, test } from '@playwright/test';
import { accessible, listener, signedIn } from './cloud';

// SC-0402-04 (meters) and SC-0403-04 (checkout consent and confirmation), on the real Cloud API.

test('Plan & billing shows storage, analysis today, Lucy turns and exports, with resets', async ({ page, request }) => {
  const user = listener('meters');
  await signedIn(page, request, user, { songs: 2, seconds: 2 });
  await request.post('/test/usage', { data: { user, amounts: { analysis_song: 12, 'lucy_turn.haiku': 9, export: 1 } } });
  await page.goto('/account/billing');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan & billing');
  const storage = page.getByRole('region', { name: 'Storage' });
  await expect(storage).toContainText('of 10.0 GB');
  await expect(page.getByRole('region', { name: 'Analysis today' })).toContainText('12 of 150 songs');
  await expect(page.getByRole('region', { name: 'Analysis today' })).toContainText('Resets');
  await expect(page.getByRole('region', { name: 'Lucy turns this month' })).toContainText('9 of 40 turns');
  await expect(page.getByRole('region', { name: 'Lucy turns this month' })).toContainText(/Resets \d+ \w+/);
  await expect(page.getByRole('region', { name: 'Exports this month' })).toContainText('1 of 3 exports');
  await expect(page.getByText('Includes Lucy Basic.')).toBeVisible();
  await accessible(page, 'billing');
});

test('checkout needs all three consents, sends the consent version, and waits for the snapshot', async ({ page, request }) => {
  const user = listener('checkout');
  await signedIn(page, request, user, { path: '/account/billing' });
  await request.post('/test/checkout-delay', { data: { seconds: 4 } });
  const choose = page.getByRole('button', { name: 'Choose Premium' });
  await expect(choose).toBeDisabled();
  await page.getByLabel('I agree to the subscription terms.').check();
  await page.getByLabel('I ask for access to start immediately.').check();
  await expect(choose).toBeDisabled();
  await page.getByLabel(/14-day cancellation right/).check();
  await expect(page.getByText(/Consent wording version terms-e2e-2026-11/)).toBeVisible();

  const sent = page.waitForRequest((sent) => sent.url().endsWith('/api/billing/checkout'));
  await choose.click();
  const body = (await sent).postDataJSON();
  expect(body).toEqual({
    plan: 'premium', interval: 'month', consent_version: 'terms-e2e-2026-11',
    accepted_terms: true, requested_immediate_access: true, acknowledged_cancellation_right: true,
  });

  await expect(page.getByRole('heading', { name: 'Test checkout: premium' })).toBeVisible();
  await page.getByRole('button', { name: 'Pay' }).click();
  // Back on Selecta before the "webhook" lands: never a premature "You're on Premium".
  await expect(page.getByText('Confirming your payment…')).toBeVisible();
  await expect(page.getByText(/You’re on Premium/)).toHaveCount(0);
  await expect(page.locator('.cloud-plan-chip')).toHaveText('Free plan');
  await expect(page.getByText('You’re on Premium. Thanks for subscribing.')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.cloud-plan-chip')).toHaveText('Premium plan');
  await expect(page.getByRole('region', { name: 'Storage' })).toContainText('of 100.0 GB');
  expect(new URL(page.url()).search).toBe('');
});

test('a paid plan changes or cancels in the portal', async ({ page, request }) => {
  const user = listener('portal');
  await signedIn(page, request, user, { path: '/account/billing' });
  await request.post('/test/checkout-delay', { data: { seconds: 0 } });
  for (const box of ['I agree to the subscription terms.', 'I ask for access to start immediately.']) await page.getByLabel(box).check();
  await page.getByLabel(/14-day cancellation right/).check();
  await page.getByRole('button', { name: 'Choose Standard' }).click();
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByText(/You’re on Standard/)).toBeVisible({ timeout: 30_000 });
  // The server only returns to an https address, and this test server has no TLS: send the
  // request on as the production site would (https), and let the fake portal come back over http.
  await page.route('**/api/billing/portal', async (route) => {
    const body = route.request().postDataJSON() as { return_url: string };
    await route.continue({ postData: JSON.stringify({ return_url: body.return_url.replace(/^http:/, 'https:') }) });
  });
  await page.getByRole('button', { name: 'Change plan or cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Test billing portal' })).toBeVisible();
  await page.getByRole('link', { name: 'Return to SelectaDJ' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan & billing');
});
