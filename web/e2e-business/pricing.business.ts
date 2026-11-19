import { expect, test } from '@playwright/test';
import { accessible, listener, signedIn } from '../e2e-cloud/cloud';
import { seedBusiness, sideways } from './helpers';

// ADR-0441 BZ-0441-02 and -05: the business pricing page exists only where `business.signups`
// reaches (named pilots until Gate S), shows the per-venue price ex VAT and a live total, and
// works in both themes at 320 px.

test('with business.signups off the pricing page is not found and nothing is fetched', async ({ page, request }) => {
  const owner = listener('price-off');
  await signedIn(page, request, owner);
  await seedBusiness(page, owner); // selling left off
  const asked: string[] = [];
  page.on('request', (sent) => { if (sent.url().includes('/api/business/pricing')) asked.push(sent.url()); });
  await page.goto('/business/pricing');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  expect(asked).toEqual([]);
});

test('with business.signups on for a pilot the pricing page shows the price and a live total', async ({ page, request }) => {
  const owner = listener('price-on');
  await signedIn(page, request, owner);
  await seedBusiness(page, owner, { selling: true });
  await page.goto('/business/pricing');
  await expect(page.getByRole('heading', { level: 1, name: 'SelectaDJ for Business pricing' })).toBeVisible();
  await expect(page.getByTestId('pricing-venue')).toHaveText('£79');
  await expect(page.getByText('All prices exclude VAT.')).toBeVisible();
  await expect(page.getByText(/You bring the music/)).toBeVisible();
  await page.getByLabel('Venues').fill('2');
  await page.getByLabel('Zones in all').fill('3');
  await expect(page.getByTestId('pricing-total')).toHaveText('£183');
  await page.getByLabel('Venues').fill('30');
  await expect(page.getByTestId('pricing-enterprise')).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 320, height: 800 });
    expect(await sideways(page)).toBeLessThanOrEqual(1);
  }
  await accessible(page, 'business pricing');
});
