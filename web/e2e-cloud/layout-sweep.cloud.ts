import { APIRequestContext, Browser, BrowserContext, expect, Page, test, TestInfo } from '@playwright/test';
import { rewriteJson } from '../e2e/helpers';
import { LONG_FILE, LONG_TITLE, sweep, verdict } from '../e2e/layoutSweep';
import { listener } from './cloud';
import { endRooms } from './helpers';
import { connectOnThisDevice, seeded } from './localFirst';

// The Cloud layout sweep (plan "two places", phase 1; e2e/layoutSweep.ts says what is measured).
// Every Cloud surface in docs/adr/mp-0272-surface-inventory.json and every place in the shell's
// navigation, at 320, 390, 768, 1280 and 1920 px and a phone on its side, with a long unbroken
// song title and file name. The two shared shells are swept with cloud.page_layout off and on
// (the account answer is amended in the browser, as the other local-first specs do); with it on
// each page must also fill the frame or sit centred in it. web/src/shell/layoutSweepCoverage.test.ts
// fails when a surface is neither here nor in SKIPPED with its reason.

/** The local-first shell's places: its four destinations, Workspace and everything in More. */
const LOCAL_FIRST: [id: string, path: string, heading: string | RegExp][] = [
  ['site.cloud.local.listen', '/listen', 'Listen'],
  ['site.cloud.local.library', '/library', 'Library'],
  ['site.cloud.local.mixes', '/mixes', 'Make a Mix'],
  ['site.cloud.local.mixes-mine', '/mixes/mine', 'My Mixes'],
  ['cloud.local.workspace', '/workshop', /Workspace|This device/],
  ['cloud.local.account', '/account', 'Account'],
  ['cloud.local.billing', '/account/billing', 'Plan & billing'],
  ['cloud.local.devices', '/account/devices', 'Devices'],
  ['cloud.local.rooms', '/rooms', 'Rooms'],
  ['cloud.local.uploads', '/upload', 'Add music'],
  ['cloud.local.listening-room', '/listening-room', /Listening Room|Page not found|isn’t on this account/i],
  ['cloud.local.missing', '/an-old-link', /not found/i],
];

/** The hosted shell (`cloud.hosted_shell` on): the pages a cloud library account has. */
const HOSTED_SHELL: [id: string, path: string][] = [
  ['site.cloud.hosted-shell', '/'],
  ['cloud.hosted.listen', '/listen'],
  ['cloud.hosted.library', '/library'],
  ['cloud.hosted.uploads', '/upload'],
  ['cloud.hosted.account', '/account'],
  ['cloud.hosted.billing', '/account/billing'],
];

/** The legacy rail (`cloud.hosted_shell` off, this build's default). */
const LEGACY: [id: string, path: string][] = [
  ['site.cloud.home', '/'], ['site.cloud.listen', '/listen'], ['site.cloud.library', '/library'],
  ['site.cloud.uploads', '/upload'], ['site.cloud.settings', '/account'], ['site.cloud.billing', '/account/billing'],
  ['site.cloud.not-found', '/an-old-link'],
];

/** Surfaces not swept here, and why. */
const SKIPPED: Record<string, string> = {
  'site.admin.overview': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.admin.customers': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.admin.billing': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.admin.jobs': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.admin.workers': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.admin.ai': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.admin.flags': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.admin.content': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.admin.covers': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.admin.emergency': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.admin.security': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.admin.communications': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.admin.system': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.admin.pilots': 'the staff console has its own frame, not the Cloud page layout; bf-accessibility.cloud.ts checks each console page for sideways scroll at 320 px',
  'site.business.app': 'needs a business organisation this server does not seed; its parts are swept through the business harness (site.business.harness)',
};

/** A short real WAV, so the upload plan sees an audio file. */
function wav(seconds = 1): Buffer {
  const rate = 8000;
  const frames = rate * seconds;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + frames * 2, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  return bytes;
}

/** The account answer this person gets: local-first or the hosted shell, with the layout flag. */
async function amend(page: Page, { localFirst, layout }: { localFirst: boolean; layout: boolean }) {
  await page.route('**/api/account', (route) => rewriteJson(route, (account) => ({
    ...account,
    experience: { ...(account.experience ?? {}), local_first: localFirst, hosted: true },
    features: {
      ...account.features,
      ...(localFirst
        ? { 'cloud.local_first': true, 'cloud.local_media': true, 'cloud.progressive_import': true, 'cloud.offline_shell': true, 'cloud.workspace': true, 'cloud.mix_outbox': true }
        : { 'cloud.hosted_shell': true }),
      'cloud.page_layout': layout,
    },
  })));
}

/** Add music with a long unbroken file name: `progress`, the upload's parts never answer, so
 * "Uploading {name}" stays while the page is measured (T-20261125-3d9f); `result`, the plan turns
 * the file down, so its own line in the results list carries the name (and the held upload from
 * the first state is in the unfinished list). */
async function longUpload(page: Page, state: 'progress' | 'result' = 'progress') {
  if (state === 'progress') await page.route('**/api/uploads/*/parts', () => { /* held, so "Uploading ..." stays on screen */ });
  else await page.route('**/api/uploads/plan', (route) => route.fulfill({ json: { uploads: [{ index: 0, name: LONG_FILE, refused: 'This file is longer than your plan allows.' }] } }));
  const picker = page.getByLabel(/Choose music files/);
  // every Add music page has the picker; over the storage limit it waits, disabled
  await expect(picker).toBeAttached();
  if (!(await picker.isEnabled())) return;
  await picker.setInputFiles({ name: LONG_FILE, mimeType: 'audio/wav', buffer: wav() });
  await page.getByRole('button', { name: 'Start upload' }).click();
  const shown = state === 'result' ? page.locator('.cloud-upload-list li') : page.getByText(LONG_FILE);
  await expect(shown.first()).toBeVisible({ timeout: 10_000 }).catch(() => undefined);
}

/** Sweep Add music in both of its long-name states. */
async function sweepUploads(page: Page, testInfo: TestInfo, id: string, options: { frame?: boolean; label?: string }) {
  await longUpload(page, 'progress');
  const problems = await sweep(page, testInfo, id, options);
  // only the held parts go: the account answer this person gets must stay
  await page.unroute('**/api/uploads/*/parts');
  await opened(page, new URL(page.url()).pathname);
  await longUpload(page, 'result');
  return [...problems, ...(await sweep(page, testInfo, `${id} results`, options))];
}

/** A menu opened at each width (`opener` finds its button): menus sit against the right edge. */
const withMenu = (page: Page, opener: string) => ({
  prepare: async () => {
    const button = page.locator(opener).first();
    if (await button.isVisible().catch(() => false)) await button.click();
  },
  after: async () => { await page.keyboard.press('Escape'); },
});

async function opened(page: Page, path: string, heading?: string | RegExp) {
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Main' }).or(page.getByRole('navigation', { name: 'Cloud workspace' })).first()).toBeVisible();
  // a place this account lacks says so under its own heading, which is fine to measure too
  await expect(page.getByRole('heading', { level: 1, name: heading }).or(page.locator('main h1')).first()).toBeVisible();
  // the library's first read and the notices settle; the event stream never goes quiet, so this
  // waits a few seconds at most
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

/** A local-first member with the long title on this device too, so the Library and the mixes draw
 * it as playable. */
async function localFirstMember(page: Page, request: APIRequestContext, name: string, layout: boolean) {
  const user = listener(name);
  const made = await seeded(request, user, { songs: 1, local_songs: 3, local_titles: [LONG_TITLE, 'Second song', 'Third song'] });
  await connectOnThisDevice(page, made.workspace_id, [{ songId: made.local_songs[0], title: LONG_TITLE, audio: true }]);
  await page.addInitScript((who) => localStorage.setItem('selecta-e2e-user', who), user);
  await amend(page, { localFirst: true, layout });
  return user;
}

for (const layout of [false, true]) {
  const label = layout ? 'layout-on' : 'layout-off';
  for (const [id, path, heading] of LOCAL_FIRST) {
    test(`${id} ${path} in the local-first shell, cloud.page_layout ${layout ? 'on' : 'off'}`, async ({ page, request }, testInfo) => {
      await localFirstMember(page, request, `sweep-${label}`, layout);
      await opened(page, path, heading);
      const options = { frame: layout && id !== 'cloud.local.missing', label };
      if (path === '/upload') return verdict(testInfo, await sweepUploads(page, testInfo, id, options));
      const problems = await sweep(page, testInfo, id, options);
      if (path === '/library') {
        problems.push(...(await sweep(page, testInfo, `${id} connect menu`, { ...options, ...withMenu(page, '.lw-connect-menu > button') })));
        problems.push(...(await sweep(page, testInfo, `${id} song menu`, { ...options, ...withMenu(page, '.library-rows .lw-actions .menu > button') })));
      }
      await verdict(testInfo, problems);
    });
  }

  test(`many notices at once in the local-first shell, cloud.page_layout ${layout ? 'on' : 'off'}`, async ({ page, request }, testInfo) => {
    const user = await localFirstMember(page, request, `sweep-notices-${label}`, layout);
    // over the storage limit as well as the cutover note
    const quota = await request.post('/test/quota', { data: { user, limit_bytes: 1 } });
    expect(quota.ok(), await quota.text()).toBeTruthy();
    await opened(page, '/library', 'Library');
    await verdict(testInfo, await sweep(page, testInfo, 'site.cloud.local.library over quota', { frame: layout, label }));
  });

  for (const [id, path] of HOSTED_SHELL) {
    test(`${id} ${path} in the hosted shell, cloud.page_layout ${layout ? 'on' : 'off'}`, async ({ page, request }, testInfo) => {
      const user = listener(`sweep-hosted-${label}`);
      await seeded(request, user, { songs: 2 });
      await page.addInitScript((who) => localStorage.setItem('selecta-e2e-user', who), user);
      await amend(page, { localFirst: false, layout });
      await opened(page, path);
      if (path === '/upload') return verdict(testInfo, await sweepUploads(page, testInfo, id, { frame: layout, label }));
      await verdict(testInfo, await sweep(page, testInfo, id, { frame: layout, label }));
    });
  }
}

test('the legacy rail pages', async ({ page, request }, testInfo) => {
  test.setTimeout(300_000);
  const user = listener('sweep-legacy');
  await seeded(request, user, { songs: 2 });
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  const problems: string[] = [];
  for (const [id, path] of LEGACY) {
    await opened(page, path);
    if (path === '/upload') problems.push(...(await sweepUploads(page, testInfo, id, {})));
    else problems.push(...(await sweep(page, testInfo, id)));
  }
  await verdict(testInfo, problems);
});

test('a new local-first member’s onboarding', async ({ page, request }, testInfo) => {
  const user = listener('sweep-onboarding');
  await seeded(request, user, { songs: 0, local_songs: 0 });
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  const problems: string[] = [];
  for (const layout of [false, true]) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await amend(page, { localFirst: true, layout });
    await page.goto('/library');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome to SelectaDJ' })).toBeVisible();
    problems.push(...(await sweep(page, testInfo, 'site.cloud.onboarding', { frame: layout, label: layout ? 'layout-on' : 'layout-off' })));
  }
  await verdict(testInfo, problems);
});

test('Rooms and devices on the harness, the gallery and the business harness', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await endRooms(page);
  const problems: string[] = [];
  await page.goto('/harness?as=alice');
  await expect(page.getByRole('heading', { name: /room/i }).first()).toBeVisible();
  problems.push(...(await sweep(page, testInfo, ['site.cloud.rooms', 'site.cloud.devices'].join(' '))));
  await page.goto('/harness?page=gallery');
  await expect(page.getByRole('heading', { level: 1, name: 'SelectaDJ Cloud patterns' })).toBeVisible();
  problems.push(...(await sweep(page, testInfo, 'site.cloud.gallery')));
  await page.goto('/business-harness.html');
  await expect(page.getByRole('heading', { level: 1, name: /SelectaDJ for Business/ })).toBeVisible();
  problems.push(...(await sweep(page, testInfo, 'site.business.harness')));
  await verdict(testInfo, problems);
});

/** Open a room as alice on the harness and say where guests join. The code is read from the
 * page's words, which may say it twice (once for the eye, once for a screen reader). */
async function openRoom(browser: Browser): Promise<{ context: BrowserContext; joinPath: string }> {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const host = await context.newPage();
  await host.goto('/harness?as=alice');
  const current = host.getByTestId('room-code');
  if (!(await current.isVisible().catch(() => false))) {
    await host.getByLabel('Room name', { exact: true }).fill('Garden party');
    await host.getByRole('button', { name: 'Open room' }).click();
  }
  await expect(current).toHaveText(/[2-9A-Z]{4}-[2-9A-Z]{4}/);
  const code = /[2-9A-Z]{4}-[2-9A-Z]{4}/.exec((await current.textContent()) ?? '')![0];
  return { context, joinPath: `/r/${code.replace('-', '')}` };
}

test('the guest page and the room display', async ({ browser, page }, testInfo) => {
  test.setTimeout(300_000);
  await endRooms(page);
  const problems: string[] = [];
  const { context, joinPath } = await openRoom(browser);
  try {
    await page.goto(joinPath);
    await expect(page.getByRole('button', { name: 'Join the room' })).toBeVisible();
    problems.push(...(await sweep(page, testInfo, 'site.guest.join')));
    await page.goto('/display');
    await expect(page.getByRole('heading', { name: 'Pair this screen' })).toBeVisible();
    problems.push(...(await sweep(page, testInfo, 'site.display.pairing')));
  } finally {
    await endRooms(page);
    await context.close();
  }
  await verdict(testInfo, problems);
});
