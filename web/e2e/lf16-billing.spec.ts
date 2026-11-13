import { expect, test } from '@playwright/test';

/**
 * LF16 end-to-end acceptance against a seeded, authenticated Cloud test account.
 *
 * Requires an integration-owned fixture for a pre-migrated v2 account and
 * SELECTA_LF16_BILLING_URL (absolute URL). Do not point these tests at live
 * Stripe or customer accounts. The general playwright.config.ts currently
 * discovers *.e2e.ts only; docs/integration/lf16.md lists the discovery wiring.
 */
const url = process.env.SELECTA_LF16_BILLING_URL;
test.skip(!url, 'Requires seeded local-first v2 Cloud fixture, never production billing');

test('v2 explains local disk and never advertises hosted GB or local render quotas', async ({ page }) => {
  await page.goto(url!);
  await expect(page.getByRole('heading', { name: /plan & billing/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'On your device, not billed by GB' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No plan-imposed daily quota' })).toBeVisible();
  await expect(page.getByText(/local music files|music, stems, renders and exports stay on your own device/i)).toBeVisible();
  await expect(page.getByText('50 GB hosted audio (legacy)')).toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: /storage|analysis today|exports this month/i })).toHaveCount(0);
});

test('v2 payment failure cannot impersonate an actual playing device', async ({ page }) => {
  await page.goto(url!);
  // The billing UI can describe entitlements but must never assert device readiness.
  await expect(page.getByText(/storage capacity, available music and cache health are verified by the local engine/i)).toBeVisible();
  await expect(page.getByText(/subscription quotas/i)).toBeVisible();
  await expect(page.getByText(/upgrading lifts the pause on uploads and exports/i)).toHaveCount(0);
});
