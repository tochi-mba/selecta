import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { resetMix, rewriteJson } from './helpers';
import { Defect, measure, Reading } from './mp-measure';

/**
 * MP-0272 measured baseline (candidates, never a human approval; MP-0272-08 is a person's job).
 *
 * Runs with `pnpm e2e:mp` (web/playwright.mp.config.ts): the stress-metadata library, headless Edge,
 * muted, light theme, still motion. Every route in docs/adr/mp-0272-surface-inventory.json is loaded at
 * all 11 viewports, and every driven dynamic fixture is set up once and then measured at all 11 (the
 * More drawer only exists on narrow layouts, so it is measured at those). Each fixture writes its
 * geometry and defects to mp-data/mp-0272/<fixture>.json. The last test gathers every P0/P1 defect
 * and fails when one is missing from docs/adr/mp-0272-defect-register.md, so the register cannot fall
 * behind what the browser measures. MP_WRITE_DOCS=1 also refreshes docs/adr/mp-0272-measured-summary.json.
 */

const ROOT = resolve(process.cwd(), process.cwd().replace(/\\/g, '/').endsWith('/web') ? '..' : '.');
// outside every outputDir: Playwright empties those at the start of a run, and the register check
// must be able to run on its own against the last full run
const OUT = resolve(process.cwd(), 'mp-data/mp-0272');
type Viewport = { id: string; width: number; height: number };
const INVENTORY = JSON.parse(readFileSync(resolve(ROOT, 'docs/adr/mp-0272-surface-inventory.json'), 'utf8')) as {
  viewports: Viewport[];
  routes: { id: string; path: string; fixtureId: string }[];
};
const VIEWPORTS = INVENTORY.viewports;
const NARROW = VIEWPORTS.filter((viewport) => viewport.width < 760);
// tests/e2e_server.py STRESS_MIX: long title first (with lyrics), then missing, bidi, CJK, Arabic,
// two songs called Same Name, the exact duplicate and the unbroken title
const STRESS_MIX = [8, 15, 18, 19, 20, 10, 17, 16];
// how a route is set up before measuring; Listen idle is the first half of 'fx.listen.playing'
const ROUTE_FIXTURES = new Set(['fx.route.idle', 'fx.route.missing', 'fx.draft.edit', 'fx.listen.playing']);

type Observation = { fixture: string; surface: string; viewport: Viewport } & Reading;

function save(fixture: string, observations: Observation[]) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${fixture}.json`), JSON.stringify({
    status: 'candidate-not-independently-verified',
    sourceSha: process.env.GITHUB_SHA ?? null,
    capturedAt: new Date().toISOString(),
    browser: 'msedge headless', theme: 'light', motion: 'still/reduced',
    fixtureLibrary: 'tests/e2e_server.py SELECTA_E2E_STRESS=1',
    fixture, required: observations.length ? observations.length : 0, observations,
  }, null, 2));
}

async function prepare(page: Page) {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/mixes');
  await page.evaluate(() => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: 'light', motion: 'still' })));
}

async function settle(page: Page) {
  await expect(page.locator('main#main, main').first()).toBeVisible();
  // skeletons first: wait for the real layout, but a page that keeps polling may stay busy
  await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 8_000 }).catch(() => null);
  await page.evaluate(() => document.fonts.ready);
}

/** Measure what is on screen now at every viewport, without reloading, so a dynamic state survives. */
async function sweep(page: Page, fixture: string, surface: string, viewports = VIEWPORTS, check?: () => Promise<void>) {
  const observations: Observation[] = [];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(150);
    if (check) await check();
    observations.push({ fixture, surface, viewport, ...(await measure(page)) });
  }
  expect(observations).toHaveLength(viewports.length);
  save(fixture, observations);
  return observations;
}

async function playListen(page: Page, request: APIRequestContext) {
  await resetMix(request, STRESS_MIX);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
}

async function openEditor(page: Page, request: APIRequestContext) {
  await resetMix(request, STRESS_MIX);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/mix/current/edit');
  await settle(page);
}

const dialog = (page: Page) => page.locator('.overlay-panel').last();

test.beforeEach(async ({ page }) => {
  await prepare(page);
});

for (const route of INVENTORY.routes) {
  test(`route ${route.id} at 11 viewports ('${route.fixtureId}')`, async ({ page, request }) => {
    expect(ROUTE_FIXTURES, `no route driver for ${route.fixtureId}`).toContain(route.fixtureId);
    await resetMix(request, STRESS_MIX);
    let path = route.path;
    if (route.fixtureId === 'fx.draft.edit') {
      const made = await request.post('/api/drafts', { data: { name: 'A draft with a name long enough to wrap twice on a phone', copy_current: true } });
      expect(made.ok()).toBe(true);
      path = `/mixes/drafts/${(await made.json()).id}/edit`;
    }
    const observations: Observation[] = [];
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(path);
      await settle(page);
      if (route.fixtureId === 'fx.route.missing') await expect(page.getByText(/nothing at this address/i)).toBeVisible();
      observations.push({ fixture: route.fixtureId, surface: route.id, viewport, ...(await measure(page)) });
    }
    save(route.id, observations);
  });
}

test("dynamic 'fx.listen.playing', 'fx.handoff.mini' and 'fx.stage'", async ({ page, request }) => {
  await playListen(page, request);
  await sweep(page, 'fx.listen.playing', 'route.listen', VIEWPORTS, async () => {
    await expect(page.locator('.now .transport .primary')).toHaveText('Pause');
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  const launcher = page.locator('[data-stage-launcher]');
  await launcher.evaluate((button) => { for (let up = button.parentElement; up; up = up.parentElement) if (up.tagName === 'DETAILS') (up as HTMLDetailsElement).open = true; });
  await launcher.click();
  await expect(page.locator('.stage-controls')).toBeVisible();
  await sweep(page, 'fx.stage', 'persistent.stage', VIEWPORTS, async () => {
    await expect(page.locator('.stage-controls')).toBeVisible();
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('.exit-stage').click();
  await expect(page.locator('.stage-controls')).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await sweep(page, 'fx.handoff.mini', 'persistent.mini', VIEWPORTS, async () => {
    await expect(page.locator('.mini')).toBeVisible();
  });
});

test("dynamic 'fx.edit.inspector' and 'fx.studio'", async ({ page, request }) => {
  await openEditor(page, request);
  // the inspector is a side panel on wide layouts and a sheet on narrow ones; crossing that line can
  // drop the selection, so each width reopens it the way a person would, from the first transition
  const inspector = page.locator('.edit-inspector, .overlay-sheet');
  const reopen = async () => {
    if (!(await inspector.first().isVisible())) await page.getByRole('button', { name: 'Change', exact: true }).first().click();
    await expect(inspector.first()).toBeVisible();
  };
  await reopen();
  await sweep(page, 'fx.edit.inspector', 'overlay.inspector', VIEWPORTS, reopen);

  // the unavailable state, whatever this pair could really do: the options answer says no, with a
  // reason long enough to wrap, the way a tempo gap or a build without stems would
  await page.route('**/api/mix/*/options*', (route) => rewriteJson(route, (body) => ({
    ...body, studio: { available: false, reason: 'These two are 12% apart in tempo, too far to play their stems together.' },
  })));
  await page.setViewportSize({ width: 1280, height: 800 });
  await reopen();
  await studioTab(page).click();
  const reason = page.locator('.warn').filter({ hasText: /stems together/ }).first();
  await expect(reason).toBeVisible();
  await sweep(page, 'fx.studio', 'overlay.studio');
});

const studioTab = (page: Page) => page.getByRole('tab', { name: 'Studio', exact: true }).or(page.getByRole('button', { name: 'Studio', exact: true })).first();

test("dynamic 'fx.studio.open'", async ({ page, request }) => {
  // tests/e2e_server.py SELECTA_E2E_STEMS=1 caches the stems for the first transition, so the real
  // Studio lays out its grid without the separation model (tests/test_e2e_studio_stems.py)
  test.setTimeout(600_000);
  await openEditor(page, request);
  const transport = page.locator('.studio .studio-transport');
  const open = async () => {
    if (await transport.isVisible()) return;
    if (!(await page.locator('.overlay-workspace').isVisible())) {
      if (!(await studioTab(page).isVisible())) await page.getByRole('button', { name: 'Change', exact: true }).first().click();
      await studioTab(page).click();
      await page.getByRole('button', { name: 'Open the Studio' }).click({ timeout: 60_000 });
      await expect(page.locator('.overlay-workspace')).toBeVisible();
    }
    // the worker may be finishing a render first; laying out cached stems itself takes seconds
    await expect(transport).toBeVisible({ timeout: 240_000 });
  };
  await open();
  await expect(page.locator('.studio')).not.toContainText('Separating vocals');
  await sweep(page, 'fx.studio.open', 'overlay.studio', VIEWPORTS, open);
});

test("dynamic 'fx.export.dialog' and 'fx.overlay.clear_mix'", async ({ page, request }) => {
  await openEditor(page, request);
  await page.getByRole('button', { name: 'Download audio' }).click();
  await expect(page.getByRole('dialog', { name: 'Save as an audio file' })).toBeVisible();
  await sweep(page, 'fx.export.dialog', 'overlay.export');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Clear the current mix?' })).toBeVisible();
  await sweep(page, 'fx.overlay.clear_mix', 'overlay.clear_mix');
  await page.getByRole('button', { name: 'Keep current mix' }).click();
});

test("dynamic 'fx.requests.bridge'", async ({ page, request }) => {
  await resetMix(request, STRESS_MIX);
  const songs = await (await request.get('/api/mix')).json();
  const titled = (songs.mix as { song_id: number; title: string | null; artist: string | null }[])
    .map((item) => ({ id: item.song_id, title: item.title, artist: item.artist }));
  const [first, missing, bidi, cjk, arabic] = titled;
  const rows = [
    {
      id: 901, song_id: cjk.id, title: cjk.title, artist: cjk.artist, status: 'pending', available: 1,
      stage: 'approve', needs_approval: true, bridge_choice: null, after: first.title, after_id: first.id,
      route: [{ id: arabic.id, title: arabic.title, artist: arabic.artist }, { id: cjk.id, title: cjk.title, artist: cjk.artist }],
      transitions: [{ from: first.title, to: arabic.title, key: 'a', status: 'waiting' }, { from: arabic.title, to: cjk.title, key: 'b', status: 'waiting' }],
    },
    { id: 902, song_id: bidi.id, title: bidi.title, artist: bidi.artist, status: 'pending', available: 1, stage: 'waiting', waiting_on: first.title, seconds: 95 },
    { id: 903, song_id: missing.id, title: null, artist: null, status: 'failed', available: 0, stage: 'unavailable', reason: 'The file could not be read' },
  ];
  await page.route('**/api/requests', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ json: { requests: rows } })
    : route.continue()));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/listen');
  await settle(page);
  await page.getByRole('button', { name: /^Requests/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Requests' })).toBeVisible();
  await expect(dialog(page)).toContainText(cjk.title ?? '');
  await sweep(page, 'fx.requests.bridge', 'overlay.requests');
});

test("failures 'fx.fail.offline' and 'fx.fail.library'", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/library');
  await settle(page);
  await page.route('**/api/status', (route) => route.abort('connectionrefused'));
  await expect(page.locator('.connection')).toBeVisible({ timeout: 30_000 });
  await sweep(page, 'fx.fail.offline', 'persistent.connection', VIEWPORTS, async () => {
    await expect(page.locator('.connection')).toBeVisible();
  });
  await page.unroute('**/api/status');

  await page.route('**/api/library?**', (route) => route.fulfill({ status: 500, json: { detail: 'synthetic failure for MP-0272' } }));
  await page.goto('/library');
  await expect(page.locator('.problem').first()).toBeVisible({ timeout: 30_000 });
  await sweep(page, 'fx.fail.library', 'route.library');
});

test("overlays 'fx.overlay.palette', 'fx.overlay.help', 'fx.overlay.glossary', 'fx.overlay.activity', 'fx.overlay.shaping'", async ({ page, request }) => {
  await resetMix(request, STRESS_MIX);
  const open = async (name: string | RegExp, title: string, then?: string) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/mixes');
    await settle(page);
    await page.getByRole('button', { name }).first().click();
    if (then) await page.getByRole('button', { name: then }).first().click();
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();
  };
  await open('Search and commands', 'Search and commands');
  await sweep(page, 'fx.overlay.palette', 'overlay.palette');
  await open('Keyboard shortcuts', 'Keyboard shortcuts');
  await sweep(page, 'fx.overlay.help', 'overlay.help');
  await open('Keyboard shortcuts', 'Music terms', 'Music terms');
  await sweep(page, 'fx.overlay.glossary', 'overlay.glossary');
  await open(/^Activity/, 'Activity');
  await sweep(page, 'fx.overlay.activity', 'overlay.activity');
  await open('Customize', 'Shape the next mix');
  await sweep(page, 'fx.overlay.shaping', 'overlay.shaping');
});

test("overlays 'fx.overlay.song_details' and 'fx.overlay.more'", async ({ page, request }) => {
  await resetMix(request, STRESS_MIX);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/library');
  await settle(page);
  await page.getByRole('button', { name: /^Details for / }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await sweep(page, 'fx.overlay.song_details', 'overlay.song_details');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/library');
  await settle(page);
  await page.locator('.nav-more-mobile').click();
  await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
  await sweep(page, 'fx.overlay.more', 'overlay.more', NARROW);
});

/** A real notice through the app's own path for an uncaught failure, raised again if it timed out. */
async function raiseToast(page: Page) {
  const words = 'A synthetic notice for the MP-0272 baseline, long enough to wrap onto a second line on a phone.';
  if (await page.locator('.toast-row').filter({ hasText: words }).isVisible()) return;
  await page.evaluate((message) => {
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error(message) }));
  }, words);
  await expect(page.locator('.toast-row').filter({ hasText: words })).toBeVisible();
}

const MAIN_NAV = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });
/** In-app navigation, so the music keeps playing; the bottom bar may hide a destination under More. */
async function go(page: Page, name: string, path: string) {
  const link = MAIN_NAV(page, name);
  if (await link.isVisible()) await link.click();
  else await page.evaluate((to) => { window.history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
  await expect(page).toHaveURL((url) => url.pathname === path);
  await settle(page);
}

test("'fx.toast' over the playing mini-player", async ({ page, request }) => {
  await playListen(page, request);
  await go(page, 'Library', '/library');
  await expect(page.locator('.mini')).toBeVisible();
  await raiseToast(page);
  await sweep(page, 'fx.toast', 'persistent.toasts', VIEWPORTS, () => raiseToast(page));
});

test("dialogs 'fx.overlay.delete_mix' and 'fx.overlay.delete_draft'", async ({ page, request }) => {
  await resetMix(request, STRESS_MIX);
  // within the 60 characters a draft name keeps (a longer one is cut, and the dialog title with it)
  const name = 'A draft to delete, named long enough to wrap on a phone';
  const made = await request.post('/api/drafts', { data: { name, copy_current: true } });
  expect(made.ok()).toBe(true);
  const id = (await made.json()).id as number;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/mixes/drafts/${id}/edit`);
    await settle(page);
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: `Delete ${name}?` })).toBeVisible();
    await sweep(page, 'fx.overlay.delete_mix', 'overlay.delete_mix');
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/mixes/mine');
    await settle(page);
    const card = page.locator('.draft-list .draft').filter({ hasText: name }).first();
    await card.getByRole('button', { name: /^More actions for / }).click();
    await page.getByRole('menuitem', { name: /^Delete / }).click();
    const dialog = page.getByRole('dialog', { name: /^Delete .*\?$/ });
    await expect(dialog.getByRole('button', { name: 'Keep draft' })).toBeVisible();
    await sweep(page, 'fx.overlay.delete_draft', 'overlay.delete_draft');
    await dialog.getByRole('button', { name: 'Keep draft' }).click();
  } finally {
    await request.delete(`/api/drafts/${id}`);
  }
});

test("replace dialogs 'fx.overlay.replace_mix', 'fx.overlay.library_replace' and 'fx.overlay.replace_with_draft'", async ({ page, request }) => {
  // each one asks only while something is playing, so the music starts first and every page after
  // it is reached in-app, without a reload that would stop it
  await resetMix(request, STRESS_MIX);
  const made = await request.post('/api/drafts', { data: { name: 'A draft that would replace the playing mix', copy_current: true } });
  expect(made.ok()).toBe(true);
  const id = (await made.json()).id as number;
  try {
    await playListen(page, request);

    await go(page, 'Make a Mix', '/mixes');
    await page.getByRole('main').getByRole('button', { name: 'Play', exact: true }).first().click({ timeout: 60_000 });
    const replace = page.getByRole('dialog', { name: /^Replace .*\?$/ });
    await expect(replace).toBeVisible();
    await sweep(page, 'fx.overlay.replace_mix', 'overlay.replace_mix');
    await replace.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.setViewportSize({ width: 1280, height: 800 });
    await go(page, 'Library', '/library');
    await page.locator('.library-rows').getByRole('button', { name: 'Start a mix' }).first().click();
    const library = page.getByRole('dialog', { name: 'Replace your current mix?' });
    await expect(library).toBeVisible();
    await sweep(page, 'fx.overlay.library_replace', 'overlay.library.replace_mix');
    await library.getByRole('button', { name: 'Keep current mix' }).click();

    await page.setViewportSize({ width: 1280, height: 800 });
    await go(page, 'My Mixes', '/mixes/mine');
    await page.getByRole('button', { name: /^Play A draft that would replace/ }).first().click();
    const draft = page.getByRole('dialog', { name: /^Replace .*\?$/ });
    await expect(draft.getByRole('button', { name: 'Keep current mix' })).toBeVisible();
    await sweep(page, 'fx.overlay.replace_with_draft', 'overlay.replace_with_draft');
    await draft.getByRole('button', { name: 'Keep current mix' }).click();
  } finally {
    await request.delete(`/api/drafts/${id}`);
  }
});

test("dialog 'fx.overlay.library_batch'", async ({ page, request }) => {
  await resetMix(request, STRESS_MIX);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/library');
  await settle(page);
  await page.getByRole('button', { name: 'Select up to 200 loaded songs' }).click();
  await page.getByRole('button', { name: 'Prioritize selected' }).or(page.getByRole('button', { name: 'Never play selected' })).first().click();
  const dialog = page.getByRole('dialog', { name: 'Apply batch Library action?' });
  await expect(dialog).toBeVisible();
  await sweep(page, 'fx.overlay.library_batch', 'overlay.library_batch');
  await dialog.getByRole('button', { name: 'Cancel - change nothing' }).click();
});

test("folder dialogs 'fx.overlay.folder_stop' and 'fx.overlay.folder_relink'", async ({ page }) => {
  // one watched folder that has gone missing, served in the browser: nothing on disk moves
  const folder = 'D:\\Synthetic Music\\An Evening Of Records Kept In A Folder With A Long Name';
  await page.route('**/api/folders', (route) => route.fulfill({ json: { folders: [{ path: folder, available: false, songs: 20 }], watch_every: 60 } }));
  await page.route('**/api/folders/check*', (route) => route.fulfill({ json: { ok: true, kind: 'ok', reason: '' } }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/workshop/sources');
  await settle(page);
  await page.locator('.folder-list li').getByRole('button', { name: 'Stop watching' }).click();
  const stop = page.getByRole('dialog', { name: 'Stop watching this folder?' });
  await expect(stop).toBeVisible();
  await sweep(page, 'fx.overlay.folder_stop', 'overlay.folder_stop');
  await stop.getByRole('button', { name: 'Keep watching' }).click();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Find moved folder' }).click();
  const relink = page.getByRole('dialog', { name: 'Re-link a moved music folder' });
  await expect(relink).toBeVisible();
  await sweep(page, 'fx.overlay.folder_relink', 'overlay.folder_relink');
  await relink.getByRole('button', { name: 'Cancel - keep original paths' }).click();
});

test("dialog 'fx.overlay.backup_restore'", async ({ page }) => {
  // a synthetic archive and preview answered in the browser: nothing is staged or restored
  await page.route('**/api/backup/status', (route) => route.fulfill({ json: { pending_restart: false, rollback_available: false, problem: null } }));
  await page.route('**/api/backup/preview', (route) => route.fulfill({ json: {
    token: 'synthetic-token', created_utc: '2026-11-01 09:30 UTC', counts: { songs: 20, drafts: 2, ratings: 7 },
    replaces: 'library records, drafts, feedback and preferences', skips: 'music files, audio caches and exports',
  } }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/workshop/storage');
  await settle(page);
  const backup = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Local data backup' }) });
  await backup.locator('input[type="file"]').setInputFiles({ name: 'synthetic-backup.zip', mimeType: 'application/zip', buffer: Buffer.from('PK synthetic') });
  await backup.getByRole('button', { name: 'Validate and preview restore' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace local data on next restart?' });
  await expect(dialog).toBeVisible();
  await sweep(page, 'fx.overlay.backup_restore', 'overlay.backup_restore');
  await dialog.getByRole('button', { name: 'Cancel - keep current data' }).click();
});

test("Lucy drawers 'fx.overlay.lucy_settings' and 'fx.overlay.lucy_conversations'", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/mixes/lucy');
  await settle(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Lucy settings' });
  await expect(settings).toBeVisible();
  await sweep(page, 'fx.overlay.lucy_settings', 'overlay.lucy.settings');
  await page.keyboard.press('Escape');

  // the list is a drawer only below 1280px; wider, it is a column of the page (measured with the route)
  const narrower = VIEWPORTS.filter((viewport) => viewport.width < 1280);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('button', { name: 'Conversations', exact: true }).click();
  const conversations = page.getByRole('dialog', { name: 'Conversations' });
  await expect(conversations).toBeVisible();
  await sweep(page, 'fx.overlay.lucy_conversations', 'overlay.lucy.conversations', narrower, async () => {
    if (!(await conversations.isVisible())) await page.getByRole('button', { name: 'Conversations', exact: true }).click();
    await expect(conversations).toBeVisible();
  });
});

test('D-01: Library rows reflow when the window narrows without a reload', async ({ page }) => {
  // measured P0 before the fix: loaded at 1280, narrowed to 375, rows stayed 976px wide (page 992px)
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/library');
  await settle(page);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(150);
    const widths = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      list: document.querySelector('.library-rows')!.getBoundingClientRect().width,
      row: document.querySelector('.library-rows .song-row')!.getBoundingClientRect().width,
    }));
    expect(widths.page, `page width at ${viewport.width}`).toBeLessThanOrEqual(viewport.width + 1);
    expect(widths.row, `row width at ${viewport.width}`).toBeLessThanOrEqual(widths.list + 1);
  }
});

test('every measured P0 and P1 defect is in the defect register', async () => {
  const files = ['fx.listen.playing', 'fx.handoff.mini', 'fx.stage', 'fx.edit.inspector', 'fx.studio', 'fx.export.dialog',
    'fx.overlay.clear_mix', 'fx.requests.bridge', 'fx.fail.offline', 'fx.fail.library', 'fx.overlay.palette', 'fx.overlay.help',
    'fx.overlay.glossary', 'fx.overlay.activity', 'fx.overlay.shaping', 'fx.overlay.song_details', 'fx.overlay.more',
    'fx.studio.open', 'fx.toast', 'fx.overlay.delete_mix', 'fx.overlay.delete_draft', 'fx.overlay.replace_mix',
    'fx.overlay.library_replace', 'fx.overlay.replace_with_draft', 'fx.overlay.library_batch', 'fx.overlay.folder_stop',
    'fx.overlay.folder_relink', 'fx.overlay.backup_restore', 'fx.overlay.lucy_settings', 'fx.overlay.lucy_conversations',
    ...INVENTORY.routes.map((route) => route.id)];
  const found = new Map<string, Defect & { fixture: string; widths: Set<number> }>();
  const coverage: Record<string, number> = {};
  for (const file of files) {
    let data: { observations: Observation[] };
    try {
      data = JSON.parse(readFileSync(resolve(OUT, `${file}.json`), 'utf8'));
    } catch {
      test.skip(true, `run the whole MP spec first: ${file}.json is missing`);
      return;
    }
    coverage[file] = data.observations.length;
    for (const observation of data.observations) {
      for (const defect of observation.defects) {
        const key = `${defect.rule} ${observation.surface} ${defect.selector}`;
        const seen = found.get(key) ?? { ...defect, fixture: observation.fixture, widths: new Set<number>() };
        seen.widths.add(observation.viewport.width * 10_000 + observation.viewport.height);
        found.set(key, seen);
      }
    }
  }
  const summary = [...found.entries()].map(([key, defect]) => ({
    key, severity: defect.severity, rule: defect.rule, fixture: defect.fixture, selector: defect.selector,
    measured: defect.measured, target: defect.target,
    viewports: [...defect.widths].sort((a, b) => a - b).map((code) => `${Math.floor(code / 10_000)}x${code % 10_000}`),
  })).sort((a, b) => a.severity.localeCompare(b.severity) || a.key.localeCompare(b.key));
  const result = { status: 'candidate-not-independently-verified', capturedAt: new Date().toISOString(), coverage, defects: summary };
  writeFileSync(resolve(OUT, 'defects.json'), JSON.stringify(result, null, 2));
  // one defect per line, so the committed summary stays a readable size (the repo's 1,000-line rule)
  const compact = [
    '{',
    `  "status": ${JSON.stringify(result.status)},`,
    `  "capturedAt": ${JSON.stringify(result.capturedAt)},`,
    `  "coverage": ${JSON.stringify(coverage)},`,
    '  "defects": [',
    summary.map((defect) => `    ${JSON.stringify(defect)}`).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
  if (process.env.MP_WRITE_DOCS === '1') writeFileSync(resolve(ROOT, 'docs/adr/mp-0272-measured-summary.json'), compact);

  const register = readFileSync(resolve(ROOT, 'docs/adr/mp-0272-defect-register.md'), 'utf8');
  const missing = summary.filter((defect) => defect.severity !== 'P2' && !register.includes(`\`${defect.key}\``)).map((defect) => defect.key);
  expect(missing, 'measured P0/P1 defects not in docs/adr/mp-0272-defect-register.md').toEqual([]);
});
