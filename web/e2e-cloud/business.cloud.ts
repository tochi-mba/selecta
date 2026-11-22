import { expect, Page, test } from '@playwright/test';
import { accessible, listener, signedIn } from './cloud';

// SelectaDJ for Business in the real Cloud app (ADR-0453 BZ-0453-01, -04, -08, -13, -19, -20;
// ADR-0442 BZ-0442-11). The test server builds the business flags on with a last "0 percent" rule,
// and `/test/business/seed` turns them on only for this test's people (tests/e2e_cloud_business.py),
// so every other spec sees them off.

type Seeded = { org: string; venues: string[]; zones: string[] };

async function seedBusiness(page: Page, owner: string, staff?: string): Promise<Seeded> {
  const made = await page.request.post('/test/business/seed', { data: { user: owner, staff } });
  expect(made.ok(), await made.text()).toBeTruthy();
  return (await made.json()) as Seeded;
}

async function sideways(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test('with the business flags off, /b/{org} opens no organisation', async ({ page, request }) => {
  const person = listener('biz-off');
  await signedIn(page, request, person);
  const business: string[] = [];
  page.on('request', (sent) => { if (sent.url().includes('/api/business/')) business.push(sent.url()); });
  await page.goto('/b/not-an-org');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  expect(business).toEqual([]);
});

test('an owner opens the HQ console with the business navigation at phone and desktop widths', async ({ page, request }) => {
  const owner = listener('biz-owner');
  await signedIn(page, request, owner);
  const seeded = await seedBusiness(page, owner);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/b/${seeded.org}`);
    await expect(page.getByText('Harbour Street').first()).toBeVisible();
    // Phones get a list of venue cards (D7); wider screens the keyboard grid.
    if (width >= 768) await expect(page.getByRole('grid')).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(1);
  }
  await accessible(page, 'business HQ');
});

test('a staff member lands on the staff controls and has no organisation menu', async ({ page, request }) => {
  const owner = listener('biz-owner2');
  const staff = listener('biz-staff');
  await signedIn(page, request, owner);
  await signedIn(page, request, staff);
  const seeded = await seedBusiness(page, owner, staff);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`/b/${seeded.org}`);
  await expect(page.getByRole('heading', { name: /^Staff controls: Harbour Street$/ })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/b/${seeded.org}/v/${seeded.venues[0]}/control$`));
  await expect(page.getByRole('button', { name: /Delete|Unpair|Archive/ })).toHaveCount(0);
  await accessible(page, 'business staff controls');
});

test('the start page is the private-pilot contact form while sign-up is off', async ({ page, request }) => {
  const owner = listener('biz-start');
  await signedIn(page, request, owner);
  await seedBusiness(page, owner);
  await page.goto('/business/start');
  await expect(page.getByRole('heading', { name: 'SelectaDJ for Business' })).toBeVisible();
  await expect(page.getByText(/in private pilot/)).toBeVisible();
  await accessible(page, 'business start');
});
