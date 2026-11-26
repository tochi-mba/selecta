import { Browser, expect, Page, test } from '@playwright/test';
import { LONG_TITLE, pressIfThere, sweep, verdict } from '../e2e/layoutSweep';
import { asStaff, enterConsole, listener, signedIn } from './cloud';
import { endRooms, hostWithRoom } from './helpers';

// The Cloud layout sweep, part three (e2e/layoutSweep.ts says what is measured): the other sites on
// the Cloud server. Every page of the staff console and a customer's record; SelectaDJ for
// Business, from HQ through each section and each of a venue's tabs to the staff controls and the
// start page; a guest who has joined a room and is choosing songs; and a paired room display.
// web/src/shell/layoutSweepCoverage.test.ts reads the quoted surface ids here.

/** The staff console's pages, by inventory id. Pages an Owner does not have say so, and are measured
 * as they are. */
const ADMIN: [id: string, path: string][] = [
  ['site.admin.overview', '/admin'],
  ['site.admin.customers', '/admin/customers'],
  ['site.admin.billing', '/admin/billing'],
  ['site.admin.jobs', '/admin/jobs'],
  ['site.admin.workers', '/admin/workers'],
  ['site.admin.ai', '/admin/ai'],
  ['site.admin.flags', '/admin/flags'],
  ['site.admin.content', '/admin/content'],
  ['site.admin.covers', '/admin/covers'],
  ['site.admin.emergency', '/admin/emergency'],
  ['site.admin.security', '/admin/security'],
  ['site.admin.communications', '/admin/communications'],
  ['site.admin.system', '/admin/system'],
  ['site.admin.pilots', '/admin/pilots'],
];

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

async function settled(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
}

test('every page of the staff console, and a customer’s record', async ({ page, request }, testInfo) => {
  test.setTimeout(900_000);
  // a customer whose email is long and unbroken, as a record's heading and the search results show it
  const customer = listener(`sweep-${LONG_TITLE.slice(0, 40).toLowerCase()}`);
  await request.post('/test/seed', { data: { user: customer, songs: 1, seconds: 4 } });
  await asStaff(page, request);
  await enterConsole(page, { changes: false });
  const problems: string[] = [];
  for (const [id, path] of ADMIN) {
    await page.goto(path);
    await expect(page.locator('main h1, h1').first()).toBeVisible();
    await settled(page);
    problems.push(...(await sweep(page, testInfo, id)));
  }
  // the record, with its sections
  await page.goto('/admin/customers');
  await page.getByLabel('Email, user or workspace id').fill(`${customer}@example.test`);
  await page.getByRole('search').getByRole('button', { name: 'Search', exact: true }).click();
  await pressIfThere(page, page.getByRole('button', { name: `Open ${customer}@example.test` }));
  await page.getByRole('heading', { name: `${customer}@example.test` }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  problems.push(...(await sweep(page, testInfo, 'site.admin.customers record')));
  await verdict(testInfo, problems);
});

type Seeded = { org: string; venues: string[]; zones: string[] };

test('SelectaDJ for Business: HQ, each section, each venue tab, staff controls and the start page', async ({ page, request }, testInfo) => {
  test.setTimeout(900_000);
  const owner = listener('sweep-biz');
  await signedIn(page, request, owner);
  const made = await page.request.post('/test/business/seed', { data: { user: owner } });
  expect(made.ok(), await made.text()).toBeTruthy();
  const { org, venues } = (await made.json()) as Seeded;
  const venue = venues[0];
  const pages: [id: string, path: string][] = [
    ['site.business.app', `/b/${org}`],
    ['site.business.app venues', `/b/${org}/venues`],
    ['site.business.app setup', `/b/${org}/setup`],
    ...['schedules', 'library', 'requests', 'people', 'usage', 'billing', 'settings'].map((section): [string, string] => [`site.business.app ${section}`, `/b/${org}/${section}`]),
    ...['now', 'today', 'schedule', 'hours', 'music', 'rules', 'requests', 'devices', 'people', 'licence', 'log'].map((tab): [string, string] => [`site.business.app venue ${tab}`, `/b/${org}/v/${venue}/${tab}`]),
    ['site.business.app control', `/b/${org}/v/${venue}/control`],
    ['site.business.app start', '/business/start'],
  ];
  const problems: string[] = [];
  for (const [id, path] of pages) {
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    await settled(page);
    problems.push(...(await sweep(page, testInfo, id)));
  }
  await verdict(testInfo, problems);
});

/** A guest of the room at `joinPath`, joined, with a search's results and a song in the basket. */
async function joinedGuest(browser: Browser, joinPath: string) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const guest = await context.newPage();
  await guest.goto(joinPath);
  await guest.getByRole('button', { name: 'Join the room' }).click();
  await expect(guest.getByRole('heading', { name: 'Garden party' })).toBeVisible({ timeout: 30_000 });
  return { context, guest };
}

test('a guest choosing songs, and a paired room display', async ({ browser, page }, testInfo) => {
  test.setTimeout(600_000);
  await endRooms(page);
  const { context: hostContext, host, joinPath } = await hostWithRoom(browser);
  const problems: string[] = [];
  const { context, guest } = await joinedGuest(browser, joinPath);
  try {
    await guest.getByRole('searchbox', { name: 'Request a song' }).fill('Song');
    await guest.getByRole('button', { name: /^Add Song/ }).first().click();
    problems.push(...(await sweep(guest, testInfo, 'site.guest.join choosing')));
    await guest.getByRole('button', { name: 'Send request', exact: true }).click();
    await guest.getByRole('region', { name: 'Your requests' }).waitFor({ timeout: 30_000 }).catch(() => undefined);
    problems.push(...(await sweep(guest, testInfo, 'site.guest.join requested')));
    // the display, paired from the host's room panel
    const screen = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
    await screen.goto('/display');
    await expect(screen.getByRole('heading', { name: 'Pair this screen' })).toBeVisible();
    const pairing = (await screen.locator('#d-pairing').textContent()) ?? '';
    await host.getByLabel('Code on the screen').fill(pairing);
    await host.getByRole('button', { name: 'Pair screen' }).click();
    await expect(screen.getByRole('heading', { name: 'Garden party' })).toBeVisible({ timeout: 15_000 });
    await expect(screen.locator('#d-upcoming li').first()).toBeVisible({ timeout: 15_000 }).catch(() => undefined);
    problems.push(...(await sweep(screen, testInfo, 'site.display.pairing paired')));
    await screen.context().close();
  } finally {
    await endRooms(page);
    await context.close();
    await hostContext.close();
  }
  await verdict(testInfo, problems);
});
