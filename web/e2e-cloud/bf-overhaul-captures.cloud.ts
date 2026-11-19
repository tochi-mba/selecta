import { expect, Page, test } from '@playwright/test';
import { rewriteJson } from '../e2e/helpers';
import { asStaff, enterConsole, listener, signedIn } from './cloud';
import { endRooms, hostWithRoom } from './helpers';

/**
 * BF overhaul W6 visual evidence: the Cloud, staff console, Rooms, devices, guest and display
 * surfaces captured at a phone and a desktop width in both themes, with motion stilled. Run with
 * BF_CAPTURE=1 against this build and against the build before the overhaul; the pairs, with a
 * review note each, are in docs/verification/claude-checks/bf-overhaul/. Captures are candidates,
 * never approval, and never compared as goldens.
 */
test.skip(process.env.BF_CAPTURE !== '1', 'capture run only: BF_CAPTURE=1');

const DISPLAYS = [
  { width: 375, height: 812, scheme: 'light' }, { width: 375, height: 812, scheme: 'dark' },
  { width: 1440, height: 900, scheme: 'light' }, { width: 1440, height: 900, scheme: 'dark' },
] as const;

async function capture(page: Page, name: string) {
  for (const display of DISPLAYS) {
    await page.setViewportSize({ width: display.width, height: display.height });
    await page.emulateMedia({ colorScheme: display.scheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: test.info().outputPath(`bf-${name}-${display.width}-${display.scheme}.png`),
      fullPage: true, animations: 'disabled', caret: 'hide',
      mask: [page.locator('time'), page.locator('canvas'), page.locator('.mini-time')],
    });
  }
}

test('hosted Cloud pages on the legacy rail', async ({ page, request }) => {
  test.setTimeout(300_000);
  await signedIn(page, request, listener('bf-capture'), { songs: 2 });
  for (const [name, path] of [['cloud-home', '/'], ['cloud-library', '/library'], ['cloud-upload', '/upload'], ['cloud-account', '/account'], ['cloud-billing', '/account/billing']] as const) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Cloud workspace' })).toBeVisible();
    await capture(page, name);
  }
});

test('the hosted shell, flag on', async ({ page, request }) => {
  const user = listener('bf-capture-shell');
  await request.post('/test/seed', { data: { user, songs: 2 } });
  await page.route('**/api/account', (route) => rewriteJson(route, (account) => ({
    ...account,
    experience: { ...(account.experience ?? {}), local_first: false },
    features: { ...account.features, 'cloud.hosted_shell': true },
  })));
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();
  await capture(page, 'cloud-hosted-shell');
});

test('the staff console overview', async ({ page, request }) => {
  await asStaff(page, request);
  await enterConsole(page);
  await capture(page, 'admin-overview');
});

test('Rooms and devices, the guest page and the display', async ({ browser, page }) => {
  test.setTimeout(300_000);
  await endRooms(page);
  const { context, joinPath } = await hostWithRoom(browser);
  try {
    await page.goto('/harness?as=alice');
    await expect(page.getByTestId('room-code')).toBeVisible();
    await capture(page, 'rooms-devices');
    await page.goto(joinPath);
    await expect(page.getByRole('button', { name: 'Join the room' })).toBeVisible();
    await capture(page, 'guest-join');
    await page.goto('/display');
    await expect(page.getByRole('heading', { name: 'Pair this screen' })).toBeVisible();
    await capture(page, 'display-pairing');
  } finally {
    await endRooms(page);
    await context.close();
  }
});
