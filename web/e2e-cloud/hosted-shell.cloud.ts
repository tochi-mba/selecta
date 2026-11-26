import { expect, Page, test } from '@playwright/test';
import { rewriteJson } from '../e2e/helpers';
import { accessible, listener, signedIn } from './cloud';

// `cloud.hosted_shell` (one shell): with it on, a hosted account's pages render inside the shared
// shell (Main navigation, the account menu, the page in its own Section) with no browser engine loaded; with
// it off, the legacy rail is exactly the markup it was before the flag existed.
//
// The build ships the flag dark and a per-user rule can never grant past the build (ADR-0414), so
// the on-state amends this one person's account answer in the browser, as the local-first specs
// do; the off-state is every account's real state on this server.

/** The rail as the commit before the flag drew it (ff96815b), for this server's seeded account:
 * every hosted page is on and exact routes (`cloud.account_states`) are on. */
const legacyRail = (email: string) => '<aside class="cloud-rail"><button class="cloud-brand" title="Return to Cloud home"><span class="cloud-mark" aria-hidden="true">S</span><span>SelectaDJ <span class="cloud-brand-sub">REX Technologies</span></span></button>'
  + '<nav aria-label="Cloud workspace"><button aria-current="page">Overview</button><button>Listen</button><button>Library</button><button>Add music</button><button>Plan &amp; billing</button><button>Settings</button></nav>'
  + `<div class="cloud-rail-bottom"><span>${email}</span><button>Sign out</button><button>Sign out everywhere</button><button class="cloud-delete-account">Delete account</button></div></aside>`;

/** Words only the browser engine (and the venue tablet flow that carries it) uses: no script the
 * hosted shell loads may hold them. */
const ENGINE_MARKS = ['AudioWorkletNode', 'addModule'];

async function hostedShellOn(page: Page) {
  await page.route('**/api/account', (route) => rewriteJson(route, (account) => ({
    ...account,
    experience: { ...(account.experience ?? {}), local_first: false },
    features: { ...account.features, 'cloud.hosted_shell': true },
  })));
}

/** Every script the page loads, kept as text, so the bundle boundary is checked on the real build. */
function scriptsOf(page: Page): Map<string, string> {
  const scripts = new Map<string, string>();
  page.on('response', async (response) => {
    if (response.request().resourceType() !== 'script') return;
    try { scripts.set(response.url(), await response.text()); } catch { /* the page moved on */ }
  });
  return scripts;
}

test('with cloud.hosted_shell off, the legacy rail is byte for byte what it was', async ({ page, request }) => {
  const user = listener('hosted-shell-off');
  await signedIn(page, request, user);
  await expect(page.locator('aside.cloud-rail')).toBeVisible();
  expect(await page.locator('aside.cloud-rail').evaluate((rail) => rail.outerHTML)).toBe(legacyRail(`${user}@example.test`));
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

  // the rail's delete asks in the shared dialog, never the browser's own confirm
  page.on('dialog', () => { throw new Error('window.confirm opened'); });
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete your SelectaDJ Cloud account?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('It is erased for good after 30 days');
  await dialog.getByRole('button', { name: 'Keep my account' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('aside.cloud-rail')).toBeVisible();
});

test('with cloud.hosted_shell on, the hosted pages render in the shared shell, engine-free', async ({ page, request }) => {
  const user = listener('hosted-shell-on');
  const seeded = await request.post('/test/seed', { data: { user, songs: 1 } });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await hostedShellOn(page);
  const scripts = scriptsOf(page);
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  await page.goto('/');

  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();
  for (const name of ['Listen', 'Make a Mix', 'Library']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'My Mixes' })).toHaveCount(0);
  await expect(page.locator('aside.cloud-rail')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  // a hosted page through the shared navigation, then an account place through the account menu
  await nav.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  // on a computer the account places sit in the account menu at the rail's foot (cb8404dc); More
  // is the phone's
  await expect(nav.getByRole('link', { name: 'Add music', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: /^Account:/ }).click();
  const menu = page.getByRole('menu', { name: 'Account' });
  for (const name of ['Account', 'Plan & billing']) await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Signed in as' })).toContainText(`${user}@example.test`);
  await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toBeVisible();

  // the bundle boundary on the real build: every page and place visited has drawn, so every chunk
  // it needed has loaded; none of them carries the engine (the live stream keeps the network busy,
  // so this waits on what the pages show, not on network idle)
  expect(scripts.size).toBeGreaterThan(0);
  const carrying = [...scripts].filter(([, text]) => ENGINE_MARKS.some((mark) => text.includes(mark))).map(([url]) => url);
  expect(carrying).toEqual([]);
});

/** cloud.one_shell for an account with no music on its devices, amended in this person's answer
 * as above: the Cloud shell opens cloud only. */
async function cloudOnlyShell(page: Page) {
  await page.route('**/api/account', (route) => rewriteJson(route, (account) => ({
    ...account,
    experience: { ...(account.experience ?? {}), local_first: false, hosted: true },
    features: { ...account.features, 'cloud.local_first': false, 'cloud.one_shell': true, 'library.places': true, 'cloud.account_mixes': true },
  })));
}

test('with cloud.one_shell on, an account with no music on its devices opens the Cloud shell, cloud only', async ({ page, request }) => {
  const user = listener('one-shell-cloud-only');
  const seeded = await request.post('/test/seed', { data: { user, songs: 1 } });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await cloudOnlyShell(page);
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  await page.goto('/library');

  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();
  for (const name of ['Listen', 'Make a Mix', 'My Mixes', 'Library']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(page.locator('aside.cloud-rail')).toHaveCount(0);
  // nothing about this device: no Workspace, no This device, no folder to connect
  await expect(nav.getByRole('link', { name: 'Workspace', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'This device', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  await expect(page.getByText('Connect music', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Choose (a|your music) folder/)).toHaveCount(0);
  // adding music is uploading: the Library's action and the side bar's place go to /upload
  await expect(page.getByRole('main').getByRole('link', { name: 'Upload music' })).toHaveAttribute('href', '/upload');
  await nav.getByRole('link', { name: 'Upload music', exact: true }).click();
  await expect(page).toHaveURL(/\/upload$/);
  await expect(page.getByRole('button', { name: 'Start upload' })).toBeVisible();
  await accessible(page, 'cloud-only upload music');
});

test('the hosted shell holds together at phone and desktop widths in both themes', async ({ page, request }) => {
  const user = listener('hosted-shell-a11y');
  const seeded = await request.post('/test/seed', { data: { user } });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await hostedShellOn(page);
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await accessible(page, 'hosted overview');
});
