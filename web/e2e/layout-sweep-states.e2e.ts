import { expect, Page, test } from '@playwright/test';
import { allRendered, resetMix, rewriteJson } from './helpers';
import { barStates, escapeAll, failAnswers, holdAnswers, LONG_TITLE, pressIfThere, sweep, sweepStates, verdict, type SweepState } from './layoutSweep';

// The local app's layout sweep, part two: the states layout-sweep.e2e.ts does not reach by opening
// a route (layoutSweep.ts says what is measured). The drawers, sheets and menus of the bars; the
// strip's lens at its right end; Listen playing, with its hand-off card; the editor with the Seam
// Inspector and the Studio open; a song's details; a very long Lucy conversation; empty, loading and
// error states; and the venue staff dashboard. Each at every width of the sweep.

const playButton = (page: Page) => page.locator('.now .transport .primary');

/** The first song of every list the pages read carries the long title, as in layout-sweep.e2e.ts. */
function lengthen(body: unknown): unknown {
  if (Array.isArray(body)) return body.map((item, index) => (index === 0 && item && typeof item === 'object' && 'title' in item ? { ...item, title: LONG_TITLE } : lengthen(item)));
  if (body && typeof body === 'object') return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, lengthen(value)]));
  return body;
}

/** Every list in an answer, emptied: the page's empty state. */
function emptied(body: unknown): unknown {
  if (Array.isArray(body)) return [];
  if (body && typeof body === 'object') return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, key === 'total' ? 0 : emptied(value)]));
  return body;
}

async function withLongTitles(page: Page) {
  for (const route of ['**/api/library?**', '**/api/library', '**/api/mix', '**/api/mixes**']) {
    await page.route(route, (handled) => (handled.request().method() === 'GET' ? rewriteJson(handled, lengthen) : handled.fallback()));
  }
}

/** The feel's depth part on, which draws the strip's lens (views/NowStrip.tsx). */
async function withDepth(page: Page) {
  await page.route('**/api/status', (route) => (route.request().method() === 'GET' ? rewriteJson(route, (status) => ({ ...status, flags: { ...(status.flags ?? {}), 'app.feel_depth': true, 'app.feel_motion': true } })) : route.fallback()));
}

async function opened(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('main h1, main [role="heading"][aria-level="1"], h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('the bars’ drawers, sheets and menus over Listen', async ({ page, request }, testInfo) => {
  test.setTimeout(600_000);
  await resetMix(request);
  await withLongTitles(page);
  await opened(page, '/listen');
  await verdict(testInfo, await sweepStates(page, testInfo, 'route.listen', barStates(page)));
});

test('the strip’s lens at its right end, and Listen playing into a hand-off', async ({ page, request }, testInfo) => {
  test.setTimeout(600_000);
  await resetMix(request);
  // a hand-off is drawn once its transition is made; on a busy machine this may not finish, and
  // then the card says it is preparing, which is measured instead
  await allRendered(request, 280_000).catch(() => undefined);
  await withLongTitles(page);
  await withDepth(page);
  await opened(page, '/listen');
  const strip = page.locator('.now .strip').first();
  const problems: string[] = [];
  // the lens follows the mouse; at the strip's last pixel it is as far right as it goes
  problems.push(...(await sweep(page, testInfo, 'route.listen strip lens', {
    prepare: async () => {
      const box = await strip.boundingBox().catch(() => null);
      if (box) await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
    },
    after: async () => { await page.mouse.move(0, 0); },
  })));
  // playing, then moved to the transition's start so the hand-off card is mid-transition
  await playButton(page).click();
  await expect(playButton(page)).toHaveText('Pause', { timeout: 30_000 }).catch(() => undefined);
  const intoTheSeam = async () => {
    if (await page.locator('.handoff.active').isVisible().catch(() => false)) return;
    // Listen's own "Jump to the transition", else a press on the strip at the seam's mark
    if (!(await pressIfThere(page, page.getByRole('button', { name: 'Jump to the transition' })))) {
      const mark = await page.locator('.now .strip .seam-mark').first().boundingBox().catch(() => null);
      const box = await strip.boundingBox().catch(() => null);
      if (!mark || !box) return;
      await page.mouse.click(mark.x + mark.width / 2 + 1, box.y + box.height / 2);
    }
    await page.locator('.handoff.active').waitFor({ timeout: 6_000 }).catch(() => undefined);
  };
  problems.push(...(await sweep(page, testInfo, 'route.listen hand-off', { prepare: intoTheSeam })));
  await playButton(page).click().catch(() => undefined);
  await verdict(testInfo, problems);
});

test('the editor with the Seam Inspector open, and the Studio', async ({ page, request }, testInfo) => {
  test.setTimeout(600_000);
  await resetMix(request, [1, 2, 3]);
  await withLongTitles(page);
  // the Studio's session and stems, served here as mp-0289-stem-studio.e2e.ts serves them
  const row = Array.from({ length: 8 }, (_, index) => (index < 4 ? 1 : 0));
  const lanes = { vocals: row, drums: row, bass: row, other: row };
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: 'sweep-8', cells: 8, seconds: 8, bars: 16, start_shape: { a: lanes, b: lanes }, shape: { a: lanes, b: lanes } } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
  await opened(page, '/mix/current/edit');
  const inspector: SweepState = {
    name: 'seam inspector',
    open: async () => {
      if (await page.locator('.inspector-identity').isVisible().catch(() => false)) return;
      await pressIfThere(page, page.getByRole('button', { name: 'Change', exact: true }));
      await page.locator('.inspector-identity').waitFor({ timeout: 5_000 }).catch(() => undefined);
    },
  };
  const problems = await sweepStates(page, testInfo, 'route.edit', [inspector]);
  // the Studio opens inside the inspector, and stays open across widths
  await pressIfThere(page, page.getByRole('tab', { name: 'Studio' }));
  const studio = page.getByRole('button', { name: 'Open the Studio' });
  await studio.waitFor({ timeout: 10_000 }).catch(() => undefined);
  await studio.click({ timeout: 10_000 }).catch(() => undefined);
  await page.locator('.studio-cell').first().waitFor({ timeout: 60_000 }).catch(() => undefined);
  await pressIfThere(page, page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }));
  problems.push(...(await sweep(page, testInfo, 'route.edit studio')));
  await escapeAll(page);
  await verdict(testInfo, problems);
});

test('a song’s details, the selection bar, and the Library empty, loading and failing', async ({ page, request }, testInfo) => {
  test.setTimeout(600_000);
  await resetMix(request);
  await withLongTitles(page);
  await opened(page, '/library');
  const problems = await sweepStates(page, testInfo, 'route.library', [
    { name: 'song details', open: async () => { await pressIfThere(page, '.library-rows button.song-open'); }, close: () => escapeAll(page) },
    {
      name: 'selection bar',
      open: async () => { const box = page.locator('.library-rows input[type="checkbox"]').first(); if (await box.isVisible().catch(() => false) && !(await box.isChecked())) await box.check().catch(() => undefined); },
      close: async () => { const box = page.locator('.library-rows input[type="checkbox"]').first(); if (await box.isChecked().catch(() => false)) await box.uncheck().catch(() => undefined); },
    },
  ]);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('**/api/library**', (route) => (route.request().method() === 'GET' ? rewriteJson(route, emptied) : route.fallback()));
  await opened(page, '/library');
  problems.push(...(await sweep(page, testInfo, 'route.library empty')));
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await failAnswers(page, '**/api/library**');
  await opened(page, '/library');
  problems.push(...(await sweep(page, testInfo, 'route.library failing')));
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await holdAnswers(page, '**/api/library**');
  await page.goto('/library');
  await page.waitForTimeout(800);
  problems.push(...(await sweep(page, testInfo, 'route.library loading')));
  await verdict(testInfo, problems);
});

test('My Mixes and Make a Mix empty and failing', async ({ page, request }, testInfo) => {
  test.setTimeout(600_000);
  await resetMix(request);
  const problems: string[] = [];
  await page.route('**/api/drafts**', (route) => (route.request().method() === 'GET' ? rewriteJson(route, emptied) : route.fallback()));
  await opened(page, '/mixes/mine');
  problems.push(...(await sweep(page, testInfo, 'route.mine empty')));
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await failAnswers(page, '**/api/drafts**');
  await opened(page, '/mixes/mine');
  problems.push(...(await sweep(page, testInfo, 'route.mine failing')));
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await failAnswers(page, '**/api/vibes**');
  await opened(page, '/mixes');
  problems.push(...(await sweep(page, testInfo, 'route.mixes failing')));
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await holdAnswers(page, '**/api/vibes**');
  await page.goto('/mixes');
  await page.waitForTimeout(800);
  problems.push(...(await sweep(page, testInfo, 'route.mixes loading')));
  await verdict(testInfo, problems);
});

test('starting up and unable to reach the server', async ({ page }, testInfo) => {
  const problems: string[] = [];
  await holdAnswers(page, '**/api/status');
  await page.goto('/listen');
  await expect(page.getByText('Starting SelectaDJ')).toBeVisible();
  problems.push(...(await sweep(page, testInfo, 'route.listen starting')));
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await failAnswers(page, '**/api/status', 503);
  await page.goto('/listen');
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
  problems.push(...(await sweep(page, testInfo, 'route.listen unreachable')));
  await verdict(testInfo, problems);
});

/** A conversation of `turns` exchanges, each reply long, with an unbroken word and a long list. */
function longConversation(base: { messages: unknown[] }, turns: number) {
  const now = Date.now() / 1000;
  const messages = [] as unknown[];
  for (let index = 0; index < turns; index += 1) {
    const at = now - (turns - index) * 60;
    messages.push({ id: `sweep-u-${index}`, seq: index * 2 + 1, role: 'user', turn: `t${index}`, run: null, content: `Could the transition into ${LONG_TITLE} come in on the chorus instead of the verse, and keep the energy up through the bridge? (${index + 1})`, status: 'complete', revision: null, meta: {}, created_at: at });
    messages.push({ id: `sweep-a-${index}`, seq: index * 2 + 2, role: 'assistant', turn: `t${index}`, run: null, content: `Yes. I moved the entry to bar 33, where the chorus starts, and kept the drums of the outgoing song for eight bars so the energy holds.\n\n- ${LONG_TITLE} now enters on the chorus\n- the bridge keeps its drums\n- nothing else in the mix changed\n\nhttps://example.test/${LONG_TITLE}/${LONG_TITLE}`, status: 'complete', revision: null, meta: {}, created_at: at + 20 });
  }
  return { ...base, messages };
}

test('a very long Lucy conversation', async ({ page, request }, testInfo) => {
  test.setTimeout(600_000);
  const made = await request.post('/api/lucy/conversations', { data: { title: `Sweep ${LONG_TITLE}` } });
  test.skip(!made.ok(), 'Lucy is off on this server');
  const { id } = (await made.json()) as { id: string };
  await page.route(`**/api/lucy/conversations/${id}`, (route) => (route.request().method() === 'GET' ? rewriteJson(route, (snapshot) => longConversation(snapshot, 40)) : route.fallback()));
  await opened(page, `/mixes/lucy/${id}`);
  await verdict(testInfo, await sweep(page, testInfo, 'route.lucy long conversation'));
});

test('the venue staff dashboard', async ({ page }, testInfo) => {
  // the dashboard's state is answered here, as apb-staff-dashboard.e2e.ts does, and its flag is
  // turned on in this browser's status answer only, so no other test sees it
  await page.route('**/api/status', (route) => (route.request().method() === 'GET' ? rewriteJson(route, (status) => ({ ...status, flags: { ...(status.flags ?? {}), 'venue.staff_dashboard': true, 'autopilot.venue_mode': true } })) : route.fallback()));
  await page.route('**/api/venue/staff/*/dashboard', (route) => route.fulfill({ json: {
    nav: 'live', headline: 'Autopilot is playing.',
    now: { title: LONG_TITLE, artist: 'An Artist With A Long Name', seconds_left: 80 },
    next: { title: 'Song B', artist: 'Artist B', seconds_left: null },
    horizon: { songs: 4, minutes: 17.6, words: '4 songs planned, about 18 min.' },
    health: { level: 'ok', words: 'Everything is working.' },
    pending: [], applied: [],
    enabled: ['more_energy', 'less_energy', 'hold_genre', 'skip_next', 'extend_current', 'pause', 'hand_to_manual'],
    stop: { visible: true, enabled: true }, announcement: '',
    expert_controls: [{ id: 'listen', label: 'Listen and transport', path: '/listen' }, { id: 'edit_mix', label: 'Edit the mix', path: '/mix/current/edit' }],
  } }));
  await page.goto('/venue/staff/sweep');
  await expect(page.getByRole('heading', { level: 1, name: 'Staff dashboard' })).toBeVisible();
  await verdict(testInfo, await sweep(page, testInfo, 'venue.staff-dashboard'));
});
