import { expect, Page, test } from '@playwright/test';
import { accessible, listener, signedIn } from '../e2e-cloud/cloud';
import { sideways } from './helpers';

// ADR-0450 and ADR-0451 browser runs in the real Cloud app, on their own server with content
// controls and Rooms for Business built on (playwright.content.config.ts, SELECTA_E2E_CONTENT=1;
// controls in tests/e2e_cloud_business.py). Each test is named after its checklist line.

type Seeded = { org: string; venues: string[]; zones: string[] };
const CONTENT = ['business.content_controls', 'business.content_controls.bulk', 'business.content_controls.lyrics_hint'];
const ROOMS = ['business.rooms', 'business.rooms.branding', 'business.rooms.print', 'business.rooms.screen_code'];

async function seed(page: Page, owner: string, extra: Record<string, unknown> = {}): Promise<Seeded> {
  const made = await page.request.post('/test/business/seed', { data: { user: owner, songs: 6, ...extra } });
  expect(made.ok(), await made.text()).toBeTruthy();
  return (await made.json()) as Seeded;
}

async function venueTab(page: Page, seeded: Seeded, tab: string) {
  await page.goto(`/b/${seeded.org}/v/${seeded.venues[0]}/${tab}`);
}

test('BZ-0450-04: the bulk editor selects, applies and undoes', async ({ page, request }) => {
  const owner = listener('content-bulk');
  await signedIn(page, request, owner);
  const seeded = await seed(page, owner);
  await venueTab(page, seeded, 'rules');
  await page.getByRole('button', { name: 'Count songs' }).click();
  await expect(page.getByText('Marking 6 songs as clean')).toBeVisible();
  await page.getByRole('button', { name: 'Mark them' }).click();
  await expect(page.getByRole('button', { name: 'Undo last change' })).toBeVisible();
  await page.getByRole('button', { name: 'Count songs' }).click();
  await expect(page.getByText('Marking 0 songs as clean')).toBeVisible();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await page.getByRole('button', { name: 'Count songs' }).click();
  await expect(page.getByText('Marking 6 songs as clean')).toBeVisible();
});

test('BZ-0450-03 and -06: the song sheet and an artist block with its spellings', async ({ page, request }) => {
  const owner = listener('content-sheet');
  await signedIn(page, request, owner);
  const seeded = await seed(page, owner);
  await venueTab(page, seeded, 'rules');
  await page.getByLabel('Find a song').fill('Harbour Song 1');
  await page.getByRole('button', { name: 'Harbour Song 1 by Rude Words' }).click();
  await page.getByLabel('Explicit lyrics').selectOption('explicit');
  await expect(page.getByLabel('Explicit lyrics')).toHaveValue('explicit');
  await page.getByLabel('Artist to block').fill('Harbour Band 1');
  await expect(page.getByRole('button', { name: 'Add to the blocklist' })).toBeDisabled();
  await page.getByRole('button', { name: 'Check spellings' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'This also blocks' })).toContainText('Harbour Band 1');
  await page.getByRole('button', { name: 'Add to the blocklist' }).click();
  await expect(page.getByText(/Artist: Harbour Band 1/)).toBeVisible();
  await accessible(page, 'music rules');
});

test('BZ-0450-09: the staff volume slider ends at the zone cap', async ({ page, request }) => {
  const owner = listener('content-vol');
  await signedIn(page, request, owner);
  const seeded = await seed(page, owner);
  await venueTab(page, seeded, 'rules');
  await page.getByLabel('Highest volume in Bar').fill('60');
  await page.getByRole('button', { name: 'Save rules' }).click();
  // six songs are under 2 hours of music, so the save warns first (ADR-0450)
  await expect(page.getByRole('alert').filter({ hasText: 'under 2 hours' })).toBeVisible();
  await page.getByRole('button', { name: 'Save anyway' }).click();
  await expect(page.getByText('Save anyway')).toHaveCount(0);
  await page.goto(`/b/${seeded.org}/v/${seeded.venues[0]}/control`);
  const slider = page.getByRole('slider').first();
  await expect(slider).toHaveAttribute('aria-valuemax', '60');
});

test('BZ-0451-02: rotating warns first, and the print sheet carries each zone code', async ({ page, request, context }) => {
  const owner = listener('rooms-print');
  await signedIn(page, request, owner);
  const seeded = await seed(page, owner);
  await venueTab(page, seeded, 'requests');
  const code = page.getByText(/^Table card code:/).first();
  const before = await code.textContent();
  await page.getByRole('button', { name: 'Make a new code' }).first().click();
  await expect(page.getByRole('alertdialog')).toContainText('stop working');
  await page.getByRole('button', { name: 'Make the new code' }).click();
  await expect(code).not.toHaveText(before ?? '');
  const sheet = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Print table cards and posters' }).click();
  const printed = await sheet;
  await expect(printed.locator('section.card')).toHaveCount(2);
  await expect(printed.locator('section.card svg[role=img]').first()).toBeVisible();
});

test('BZ-0451-04 and -08: a guest asks at 320 px in both themes and staff approve on the staff view', async ({ page, request, browser }) => {
  const owner = listener('rooms-owner');
  const staff = listener('rooms-staff');
  await signedIn(page, request, staff);
  await signedIn(page, request, owner);
  const seeded = await seed(page, owner, { staff });
  await venueTab(page, seeded, 'requests');
  const text = (await page.getByText(/^Table card code:/).first().textContent()) ?? '';
  const code = text.replace(/^Table card code:\s*/, '').replace(/-/g, '').trim();

  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await signedIn(staffPage, staffContext.request, staff);
  await staffPage.goto(`/b/${seeded.org}/v/${seeded.venues[0]}/control`);
  await expect(staffPage.getByRole('heading', { name: /Staff controls/ })).toBeVisible();

  const guestContext = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const guest = await guestContext.newPage();
  for (const scheme of ['light', 'dark'] as const) {
    await guest.emulateMedia({ colorScheme: scheme });
    await guest.goto(`/r/${code}?at=venue`);
    if (scheme === 'light') await guest.getByRole('button', { name: 'Join' }).click();
    await expect(guest.getByRole('heading', { name: 'Bar' })).toBeVisible();
    await expect(guest.getByText('Powered by SelectaDJ')).toBeVisible();
    expect(await sideways(guest)).toBeLessThanOrEqual(1);
  }
  await guest.getByRole('searchbox', { name: 'Search songs' }).fill('Harbour Song 2');
  await guest.getByRole('button', { name: 'Ask' }).first().click();
  await expect(guest.getByText('Waiting for staff')).toBeVisible();
  for (const word of ['tablet', 'kiosk', 'billing', 'licence']) await expect(guest.getByText(new RegExp(word, 'i'))).toHaveCount(0);

  await staffPage.reload();
  await staffPage.getByRole('button', { name: /^Approve Harbour Song 2/ }).click();
  await guest.reload();
  await expect(guest.getByText('Coming up').first()).toBeVisible();
  await staffContext.close();
  await guestContext.close();
});

test('flag sweep: content and rooms controls vanish with their flags and the page reflows', async ({ page, request }) => {
  const owner = listener('content-off');
  await signedIn(page, request, owner);
  const seeded = await seed(page, owner, { without: [...CONTENT, ...ROOMS] });
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await venueTab(page, seeded, 'now');
    await expect(page.getByRole('heading', { name: 'Harbour Street' })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Venue sections' });
    await expect(tabs.getByRole('button', { name: 'Music rules' })).toHaveCount(0);
    await expect(tabs.getByRole('button', { name: 'Requests' })).toHaveCount(0);
    expect(await sideways(page)).toBeLessThanOrEqual(1);
  }
  const on = listener('content-on');
  await signedIn(page, request, on);
  const all = await seed(page, on, { without: ['business.content_controls.lyrics_hint', 'business.rooms.print'] });
  await venueTab(page, all, 'rules');
  await expect(page.getByText('What each zone can play')).toBeVisible();
  await expect(page.getByText('Worth checking')).toHaveCount(0);
  await venueTab(page, all, 'requests');
  await expect(page.getByText('Guest request rooms')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print table cards and posters' })).toHaveCount(0);
});
