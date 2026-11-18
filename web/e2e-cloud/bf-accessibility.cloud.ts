import AxeBuilder from '@axe-core/playwright';
import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { rewriteJson } from '../e2e/helpers';
import { listener, signedIn } from './cloud';

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
  for (const [path, heading] of [['/listen', 'Listen'], ['/library', 'Library'], ['/mixes', 'Make a Mix'], ['/mixes/mine', 'My Mixes']]) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    found.push(...(await checked(page, path)));
  }
  expect(found).toEqual([]);
});

test('the local-first shell is usable by keyboard alone: visible focus, More opens, the cutover note dismisses', async ({ page, request }) => {
  await localFirst(page, request, listener('bf-keys'));
  await page.goto('/listen');
  const note = page.getByRole('region', { name: 'Nothing has changed for you' });
  await expect(note).toBeVisible();
  expect(await tabTo(page, /^Library$/)).toEqual([]);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();

  // More, by keyboard, and its account places as links.
  const more = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More' }).first();
  await more.focus();
  await page.keyboard.press('Enter');
  const places = page.getByRole('navigation', { name: 'More' });
  await expect(places.getByRole('link', { name: 'Account' })).toBeVisible();
  await page.keyboard.press('Escape');

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
