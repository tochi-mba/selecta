import AxeBuilder from '@axe-core/playwright';
import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { rewriteJson } from '../e2e/helpers';
import { asStaff, enterConsole, listener, signedIn } from './cloud';
import { endRooms, hostWithRoom } from './helpers';

// BF-0463-06, the automated half: the new Browser-first Cloud surfaces checked by machine for
// WCAG 2.2 AA (axe), at 320 px (which is also what 400% zoom of a 1280 px window lays out) and
// desktop width, in both themes, with reduced motion asked for, and by keyboard alone. The
// recorded manual pass with a screen reader stays a person's job; nothing here claims it.
//
// The surfaces: the local-first shell's four destinations and More, with the cutover note a
// hosted account sees there (the account answer is amended in the browser to select the shell,
// as local-first-shell.cloud.ts does, since a rule can never grant past the build); and the
// hosted Library after the hosted media grant is revoked (uploads gone, stored music kept).
//
// Not covered here: the venue tablet's landscape kiosk posture has no Cloud page in this build
// (`cloud.venue_tablet` ships dark with no UI yet), so there is nothing to check by machine.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const VIEWS = [{ width: 320, height: 720 }, { width: 1280, height: 900 }];

async function checked(page: Page, where: string): Promise<string[]> {
  const found: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const view of VIEWS) {
      await page.setViewportSize(view);
      await page.waitForTimeout(250);
      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      for (const problem of violations) for (const node of problem.nodes) found.push(`${where} ${scheme} ${view.width}: ${problem.id} ${String(node.target)}`);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 1) found.push(`${where} ${scheme} ${view.width}: scrolls sideways by ${wide}px`);
    }
  }
  // Reduced motion: nothing keeps animating once it is asked for.
  const moving = await page.evaluate(() => document.getAnimations().filter((animation) => {
    const timing = animation.effect?.getComputedTiming();
    return animation.playState === 'running' && (timing?.iterations === Infinity || Number(timing?.duration ?? 0) > 1000);
  }).length);
  if (moving) found.push(`${where}: ${moving} long or endless animations run with reduced motion asked for`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  return found;
}

/** Tab from the top of the page until `name` has focus; every stop must show a focus mark. */
async function tabTo(page: Page, name: RegExp, limit = 40): Promise<string[]> {
  const problems: string[] = [];
  await page.locator('body').focus();
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      const marked = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
      return { label: (element.getAttribute('aria-label') || element.innerText || element.tagName).trim().slice(0, 60), marked };
    });
    if (!stop) continue;
    if (!stop.marked) problems.push(`no visible focus on "${stop.label}"`);
    if (name.test(stop.label)) return problems;
  }
  return [...problems, `never reached ${name} by Tab`];
}

async function localFirst(page: Page, request: APIRequestContext, user: string) {
  const seeded = await request.post('/test/seed', { data: { user, songs: 1, local_songs: 1 } });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await page.route('**/api/account', (route) => rewriteJson(route, (account) => ({
    ...account,
    experience: { ...(account.experience ?? {}), local_first: true, hosted: true },
    features: { ...account.features, 'cloud.local_first': true },
  })));
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
}

test('the local-first shell destinations pass WCAG AA at 320 px and desktop, both themes, reduced motion', async ({ page, request }) => {
  test.setTimeout(300_000);
  await localFirst(page, request, listener('bf-a11y'));
  const found: string[] = [];
  for (const [path, heading, id] of [['/listen', 'Listen', 'site.cloud.local.listen'], ['/library', 'Library', 'site.cloud.local.library'], ['/mixes', 'Make a Mix', 'site.cloud.local.mixes'], ['/mixes/mine', 'My Mixes', 'site.cloud.local.mixes-mine']]) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    found.push(...(await checked(page, `${id} ${path}`)));
  }
  expect(found).toEqual([]);
});

test('the local-first shell is usable by keyboard alone: visible focus, the account menu opens, the cutover note dismisses', async ({ page, request }) => {
  await localFirst(page, request, listener('bf-keys'));
  await page.goto('/listen');
  const note = page.getByRole('region', { name: 'Nothing has changed for you' });
  await expect(note).toBeVisible();
  expect(await tabTo(page, /^Library$/)).toEqual([]);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();

  // The account menu, by keyboard, and its account places as menu items.
  const opener = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Account: / });
  await opener.focus();
  await page.keyboard.press('Enter');
  const places = page.getByRole('menu', { name: 'Account' });
  await expect(places.getByRole('menuitem', { name: 'Account' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(places).toHaveCount(0);
  await expect(opener).toBeFocused();

  // The cutover note's buttons are named and it goes away from the keyboard.
  await note.getByRole('button', { name: 'Got it' }).focus();
  await page.keyboard.press('Enter');
  await expect(note).toHaveCount(0);
});

test('the hosted Library with the hosted media grant revoked passes WCAG AA, both themes, 320 px', async ({ page, request }) => {
  const user = listener('bf-a11y-revoked');
  await signedIn(page, request, user, { songs: 1, path: '/library' });
  const off = await request.post('/test/flags/off', { data: { user, flags: ['cloud.hosted_media'] } });
  expect(off.ok(), await off.text()).toBeTruthy();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload tracks' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Listen to Song 1/ })).toBeVisible();
  expect(await checked(page, '/library revoked')).toEqual([]);
  // By keyboard, the stored song still plays.
  expect(await tabTo(page, /^Listen to Song 1/)).toEqual([]);
  await request.post('/test/flags/off', { data: { user, flags: [] } });
});

// BF overhaul W6: every Cloud, staff console, business, guest and display surface in the MP-0272
// inventory's `sites` list (docs/adr/mp-0272-surface-inventory.json) is checked here under its id;
// web/src/shell/mpSurfaceInventory.test.ts fails when a listed surface is not named in this file.

/** Wait until the page has drawn past its loading placeholders, then run the shared checks. */
async function settledCheck(page: Page, id: string): Promise<string[]> {
  await expect(page.locator('[aria-busy="true"]:not(button)')).toHaveCount(0, { timeout: 20_000 }).catch(() => undefined);
  return checked(page, id);
}

test('the hosted Cloud pages pass WCAG AA at 320 px and desktop, both themes, reduced motion', async ({ page, request }) => {
  test.setTimeout(400_000);
  await signedIn(page, request, listener('bf-a11y-hosted'), { songs: 1 });
  const found: string[] = [];
  for (const [id, path] of [
    ['site.cloud.home', '/'], ['site.cloud.listen', '/listen'], ['site.cloud.library', '/library'], ['site.cloud.uploads', '/upload'],
    ['site.cloud.billing', '/account/billing'], ['site.cloud.not-found', '/an-old-link'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Cloud workspace' })).toBeVisible();
    found.push(...(await settledCheck(page, `${id} ${path}`)));
  }
  expect(found).toEqual([]);
});

test('Cloud settings with devices and the venue tablet card pass WCAG AA', async ({ page, request }) => {
  test.setTimeout(200_000);
  await page.route('**/api/account', (route) => rewriteJson(route, (account) => ({
    ...account,
    features: { ...account.features, devices: true, 'devices.browser_player': true, 'cloud.venue_tablet': true },
  })));
  await signedIn(page, request, listener('bf-a11y-settings'), { songs: 1, path: '/account' });
  await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible();
  expect(await settledCheck(page, 'site.cloud.settings')).toEqual([]);
});

test('the unified hosted shell passes WCAG AA', async ({ page, request }) => {
  const user = listener('bf-a11y-hosted-shell');
  const seeded = await request.post('/test/seed', { data: { user } });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await page.route('**/api/account', (route) => rewriteJson(route, (account) => ({
    ...account,
    experience: { ...(account.experience ?? {}), local_first: false },
    features: { ...account.features, 'cloud.hosted_shell': true },
  })));
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  expect(await settledCheck(page, 'site.cloud.hosted-shell')).toEqual([]);
});

test('a new local-first member sees the onboarding spine, and it passes WCAG AA', async ({ page, request }) => {
  const user = listener('bf-a11y-onboarding');
  const seeded = await request.post('/test/seed', { data: { user, songs: 0, local_songs: 0 } });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await page.route('**/api/account', (route) => rewriteJson(route, (account) => ({
    ...account,
    experience: { ...(account.experience ?? {}), local_first: true, hosted: false },
    features: { ...account.features, 'cloud.local_first': true, 'cloud.local_media': true, 'cloud.progressive_import': true },
  })));
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  await page.goto('/library');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome to SelectaDJ' })).toBeVisible();
  expect(await settledCheck(page, 'site.cloud.onboarding')).toEqual([]);
});

test('the staff console pages pass WCAG AA', async ({ page, request }) => {
  test.setTimeout(400_000);
  await asStaff(page, request);
  const nav = await enterConsole(page);
  const found: string[] = [];
  // the redesigned console's pages are links (59906603, e1d2d27a)
  for (const [id, label] of [
    ['site.admin.overview', 'Overview'], ['site.admin.customers', 'Customers'], ['site.admin.billing', 'Billing'],
    ['site.admin.jobs', 'Jobs'], ['site.admin.workers', 'Workers'], ['site.admin.ai', 'AI'], ['site.admin.flags', 'Flags'], ['site.admin.content', 'Content'],
    ['site.admin.emergency', 'Emergency'], ['site.admin.security', 'Staff and security'],
    ['site.admin.communications', 'Communications'], ['site.admin.system', 'System'],
  ] as const) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    found.push(...(await settledCheck(page, `${id} ${label}`)));
  }
  expect(found).toEqual([]);
});

test('Rooms, devices, the cloud gallery and the business harness pass WCAG AA', async ({ page }) => {
  test.setTimeout(400_000);
  await endRooms(page);
  const found: string[] = [];
  await page.goto('/harness?as=alice');
  await expect(page.getByRole('heading', { name: /room/i }).first()).toBeVisible();
  // one harness page carries the Rooms panel, the devices panel and the playing bar
  found.push(...(await settledCheck(page, ['site.cloud.rooms', 'site.cloud.devices'].join(' '))));
  await page.goto('/harness?page=gallery');
  await expect(page.getByRole('heading', { level: 1, name: 'SelectaDJ Cloud patterns' })).toBeVisible();
  found.push(...(await settledCheck(page, 'site.cloud.gallery')));
  await page.goto('/business-harness.html');
  await expect(page.getByRole('heading', { level: 1, name: /SelectaDJ for Business/ })).toBeVisible();
  found.push(...(await settledCheck(page, 'site.business.harness')));
  expect(found).toEqual([]);
});

test('the guest page and the room display pass WCAG AA', async ({ browser, page }) => {
  test.setTimeout(300_000);
  await endRooms(page);
  const { context, joinPath } = await hostWithRoom(browser);
  const found: string[] = [];
  try {
    await page.goto(joinPath);
    await expect(page.getByRole('button', { name: 'Join the room' })).toBeVisible();
    found.push(...(await checked(page, `${'site.guest.join'} before joining`)));
    await page.getByRole('button', { name: 'Join the room' }).click();
    await expect(page.getByRole('heading', { name: 'Request a song' })).toBeVisible();
    found.push(...(await checked(page, `${'site.guest.join'} joined`)));
    await page.goto('/display');
    await expect(page.getByRole('heading', { name: 'Pair this screen' })).toBeVisible();
    found.push(...(await checked(page, 'site.display.pairing')));
  } finally {
    await endRooms(page);
    await context.close();
  }
  expect(found).toEqual([]);
});
