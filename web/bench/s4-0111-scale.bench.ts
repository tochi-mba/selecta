import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { rewriteJson } from '../e2e/helpers';
import { browserLine, frameWindow, installProbe, interactionsSince, mark, timed } from '../e2e/perf-probe';

/**
 * S4-0111-05, -06 and -07: lab traces of a 20,000-song Library (search, filter, deep paging and a
 * refresh at depth, with memory), a 100-song Editor (selection, keyboard reorder and scroll, with focus
 * kept) and the 64-cell Studio while analysis and a render run on the server and the main player plays.
 * In Edge against tests/scale_server.py (20,000 songs, 100 in the mix):
 *   pnpm exec playwright test --config bench/playwright.config.ts s4-0111
 * Builds on web/bench/mi-0162-scale.bench.ts and web/e2e/perf-probe.ts; the throttled journeys are
 * T0265's (web/e2e/t0265-constrained-profiles.e2e.ts). Memory comes from Chromium's own
 * Performance.getMetrics. Each test prints one `S4-0111 {...}` line with the machine it ran on.
 * These are lab numbers from one shared, headless, muted laptop: they are not the hardware- and
 * version-controlled traces a person records on a named machine, and say nothing about audible dropouts.
 */

// Budgets, stated before measuring. Interactions at web.dev's "good" 200 ms, no long task over 200 ms
// while typing, paging, moving or toggling, a refresh at depth showing rows within 3 s, the JS heap
// under 200 MB after 1,000 Library rows, and the main player's time moving on while the Studio works.
const BUDGET = {
  interactionMs: 200,
  longTaskMs: 200,
  refreshFirstRowsMs: 3000,
  searchSettleMs: 1500,
  heapMb: 200,
  frameP95Ms: 50,
  editorOpenMs: 5000,
};
const WINDOW_MS = 3000;

async function memory(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  await cdp.detach();
  const read = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? 0;
  return { js_heap_used_mb: Math.round(read('JSHeapUsedSize') / 1e5) / 10, dom_nodes: read('Nodes'), listeners: read('JSEventListeners') };
}

/** The app's own router, so the player keeps playing between pages. */
async function go(page: Page, path: string) {
  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function total(request: APIRequestContext, query: string) {
  return (await (await request.get(`/api/library?${query}&limit=1`)).json()).total as number;
}

test('S4-0111-05 a 20,000-song Library: search, filter, deep paging and a refresh at depth, with memory', async ({ page, request }) => {
  await installProbe(page);
  const everything = await total(request, 'state=all');
  expect(everything, 'the synthetic library is not 20,000 songs').toBeGreaterThanOrEqual(20_000);
  const shown = page.locator('.library-count');
  const rows = page.locator('.library-rows .song-row');
  await page.goto('/library');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const opened = await memory(page);

  const golden = await total(request, 'q=golden&state=all');
  const box = page.getByRole('searchbox', { name: 'Search your library' }).or(page.getByRole('textbox', { name: 'Search your library' })).first();
  await box.click();
  const typingFrom = await mark(page);
  await box.pressSequentially('golden', { delay: 120 });
  const searchSettleMs = await timed(async () => undefined, () => expect(shown).toContainText(`of ${golden} songs`, { timeout: 30_000 }));
  await expect(box).toBeFocused();
  const typing = await interactionsSince(page, typingFrom);

  const ready = await total(request, 'q=golden&state=ready');
  const filterFrom = await mark(page);
  const filterMs = await timed(() => page.getByRole('button', { name: 'Ready', exact: true }).click(),
    () => expect(shown).toContainText(ready < 100 ? `${ready} song` : `of ${ready} songs`, { timeout: 30_000 }));
  const filtering = await interactionsSince(page, filterFrom);
  await page.getByRole('button', { name: 'Everything', exact: true }).click();
  await box.fill('');
  await expect(shown).toContainText(`of ${everything} songs`, { timeout: 30_000 });

  const more = page.getByRole('button', { name: 'Show more songs' });
  await more.focus();
  const moreFrom = await mark(page);
  for (let round = 1; round <= 9; round += 1) {
    await page.keyboard.press('Enter');
    await expect(rows).toHaveCount(100 + round * 100, { timeout: 30_000 });
    await expect(more).toBeFocused();
  }
  const paging = await interactionsSince(page, moreFrom);
  const deep = await memory(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const scrolling = await frameWindow(page, WINDOW_MS, { scrollBy: 400 });

  // a refresh at depth: the address keeps the search, and the page comes back with rows
  await box.fill('golden');
  await expect(shown).toContainText(`of ${golden} songs`, { timeout: 30_000 });
  const address = page.url();
  const refreshMs = await timed(() => page.reload(), () => expect(rows.first()).toBeVisible({ timeout: 60_000 }));
  await expect(shown).toContainText(`of ${golden} songs`, { timeout: 30_000 });
  const afterRefresh = await memory(page);

  const reading = {
    songs: everything,
    memory: { opened, after_1000_rows: deep, after_refresh: afterRefresh },
    search: { matches: golden, settle_ms: searchSettleMs, slowest_key_paint_ms: typing.nextPaintWorstMs, slowest_event_timing_ms: typing.eventTimingWorstMs, long_tasks_ms: typing.longTasks },
    filter: { matches: ready, ms: filterMs, slowest_paint_ms: filtering.nextPaintWorstMs, long_tasks_ms: filtering.longTasks },
    paging: { rows: 1000, slowest_key_paint_ms: paging.nextPaintWorstMs, slowest_event_timing_ms: paging.eventTimingWorstMs, long_tasks_ms: paging.longTasks },
    scroll: { frame_p95_ms: scrolling.frameP95, long_tasks_ms: scrolling.longTasks },
    refresh: { address: address.replace(/^https?:\/\/[^/]+/, ''), first_rows_ms: refreshMs },
  };
  console.log(`S4-0111 ${JSON.stringify({ test: 'S4-0111-05', machine: await browserLine(page), budget: BUDGET, reading })}`);
  expect.soft(searchSettleMs, 'search settled').toBeLessThanOrEqual(BUDGET.searchSettleMs);
  expect.soft(Math.max(typing.nextPaintWorstMs, typing.eventTimingWorstMs), 'slowest keystroke').toBeLessThanOrEqual(BUDGET.interactionMs);
  expect.soft(Math.max(filtering.nextPaintWorstMs, filtering.eventTimingWorstMs), 'filter press').toBeLessThanOrEqual(BUDGET.interactionMs);
  expect.soft(Math.max(paging.nextPaintWorstMs, paging.eventTimingWorstMs), 'slowest Show more').toBeLessThanOrEqual(BUDGET.interactionMs);
  expect.soft(deep.js_heap_used_mb, 'JS heap after 1,000 rows').toBeLessThanOrEqual(BUDGET.heapMb);
  expect.soft(refreshMs, 'refresh at depth').toBeLessThanOrEqual(BUDGET.refreshFirstRowsMs);
  expect.soft(scrolling.frameP95, 'scroll p95 frame').toBeLessThanOrEqual(BUDGET.frameP95Ms);
});

test('S4-0111-06 a 100-song Editor: selection, keyboard reorder and scroll keep focus without long stalls', async ({ page, request }) => {
  await installProbe(page);
  const songs = (await (await request.get('/api/mix')).json()).mix.length as number;
  expect(songs, 'the scale mix is not 100 songs').toBe(100);
  await page.setViewportSize({ width: 1440, height: 900 });
  const timeline = page.locator('.timeline > .song');
  const openMs = await timed(() => page.goto('/mix/current/edit'), () => expect(timeline).toHaveCount(100, { timeout: 60_000 }));
  const opened = await memory(page);

  // selection across the long list, by click and then by keyboard on the select button
  const selectFrom = await mark(page);
  for (const index of [5, 40, 75, 99]) {
    const button = timeline.nth(index).locator('.song-select');
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'true');
  }
  const keyed = timeline.nth(60).locator('.song-select');
  await keyed.scrollIntoViewIfNeeded();
  await keyed.focus();
  await page.keyboard.press('Enter');
  await expect(keyed).toHaveAttribute('aria-current', 'true');
  await expect(keyed).toBeFocused();
  const selecting = await interactionsSince(page, selectFrom);

  const grip = (index: number) => timeline.nth(index).locator('.grip');
  let at = 50;
  await grip(at).scrollIntoViewIfNeeded();
  await grip(at).focus();
  const name = await grip(at).getAttribute('aria-label');
  const moveFrom = await mark(page);
  for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowUp', 'ArrowDown', 'ArrowDown']) {
    const to = key === 'ArrowUp' ? at - 1 : at + 1;
    await page.keyboard.press(key);
    await expect(grip(to)).toBeFocused({ timeout: 30_000 });
    await expect(grip(to)).toHaveAttribute('aria-label', name!);
    at = to;
  }
  const moving = await interactionsSince(page, moveFrom);
  await page.evaluate(() => window.scrollTo(0, 0));
  const scrolling = await frameWindow(page, WINDOW_MS, { scrollBy: 300 });
  const after = await memory(page);

  const reading = {
    songs,
    open_ms: openMs,
    memory: { opened, after },
    selection: { slowest_paint_ms: selecting.nextPaintWorstMs, slowest_event_timing_ms: selecting.eventTimingWorstMs, slowest: selecting.eventTimingWorst, long_tasks_ms: selecting.longTasks, focus_kept: true },
    reorder: { moves: 6, slowest_paint_ms: moving.nextPaintWorstMs, slowest_event_timing_ms: moving.eventTimingWorstMs, long_tasks_ms: moving.longTasks, focus_kept: true },
    scroll: { frame_p95_ms: scrolling.frameP95, long_tasks_ms: scrolling.longTasks },
  };
  console.log(`S4-0111 ${JSON.stringify({ test: 'S4-0111-06', machine: await browserLine(page), budget: BUDGET, reading })}`);
  expect.soft(openMs, '100 songs open').toBeLessThanOrEqual(BUDGET.editorOpenMs);
  expect.soft(Math.max(selecting.nextPaintWorstMs, selecting.eventTimingWorstMs), 'slowest selection').toBeLessThanOrEqual(BUDGET.interactionMs);
  expect.soft(Math.max(moving.nextPaintWorstMs, moving.eventTimingWorstMs), 'slowest reorder key').toBeLessThanOrEqual(BUDGET.interactionMs);
  expect.soft([...selecting.longTasks, ...moving.longTasks].filter((ms) => ms > BUDGET.longTaskMs), 'long tasks while selecting or moving').toEqual([]);
  expect.soft(scrolling.frameP95, 'editor scroll p95 frame').toBeLessThanOrEqual(BUDGET.frameP95Ms);
});

/** The real 2 sides x 4 lanes x 8 squares Studio (64 cells) for transition 1, with stand-in stems,
 * because splitting needs the big model (as in mi-0162-scale.bench.ts). What is measured is the grid. */
async function withStudio(page: Page, request: APIRequestContext) {
  const row = Array.from({ length: 8 }, (_, index) => (index < 4 ? 1 : 0));
  const lanes = { vocals: row, drums: row, bass: row, other: row };
  const shape = { a: lanes, b: lanes };
  const first = (await (await request.get('/api/mix')).json()).mix[0].song_id;
  const stem = await (await request.get(`/api/songs/${first}/audio`)).body();
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: 's4-0111-bench', cells: 8, seconds: 8, bars: 16, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
}

/** Every playing media element's time, and how often any of them had to wait for data. */
async function watchMedia(page: Page) {
  await page.evaluate(() => {
    const seen = window as unknown as { s40111Waits: number };
    seen.s40111Waits = 0;
    for (const media of document.querySelectorAll('audio, video')) {
      media.addEventListener('waiting', () => { seen.s40111Waits += 1; });
      media.addEventListener('stalled', () => { seen.s40111Waits += 1; });
    }
  });
}
const mediaNow = (page: Page) => page.evaluate(() => ({
  playing: [...document.querySelectorAll<HTMLMediaElement>('audio, video')].filter((media) => !media.paused).map((media) => media.currentTime),
  waits: (window as unknown as { s40111Waits?: number }).s40111Waits ?? 0,
}));

test('S4-0111-07 the 64-cell Studio answers while analysis and a render run and the main player plays', async ({ page, request }) => {
  await installProbe(page);
  await withStudio(page, request);
  await page.goto('/listen');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).first().click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true }).first()).toBeVisible({ timeout: 60_000 });

  await go(page, '/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click();
  const cells = page.locator('.studio-grid .studio-cell');
  await expect(cells).toHaveCount(64, { timeout: 120_000 });
  const studioOpen = await memory(page);

  // the server gets busy: analysis and a render of the mix, both asked for, both reported as found
  const analysis = (await request.post('/api/analysis/start')).status();
  const render = (await request.post('/api/mix/render')).status();
  const busy = (await (await request.get('/api/status')).json()) as Record<string, unknown>;
  await watchMedia(page);
  const before = await mediaNow(page);
  const wallFrom = Date.now();

  const toggleFrom = await mark(page);
  const toggles: number[] = [];
  for (const target of ['0-0', '1-3', '2-5', '3-7', '4-1', '5-4', '6-6', '7-2']) {
    const square = page.locator(`[data-cell="${target}"]`);
    await square.focus();
    const pressed = await square.getAttribute('aria-pressed');
    toggles.push(await timed(() => page.keyboard.press('Space'), () => expect(square).not.toHaveAttribute('aria-pressed', pressed ?? '')));
    await page.keyboard.press('Space');
    await expect(square).toHaveAttribute('aria-pressed', pressed ?? '');
  }
  const toggling = await interactionsSince(page, toggleFrom);
  const busyFrames = await frameWindow(page, WINDOW_MS);
  const after = await mediaNow(page);
  const wallMs = Date.now() - wallFrom;
  const afterMemory = await memory(page);
  const advanced = before.playing.length && after.playing.length ? Math.round((after.playing[0] - before.playing[0]) * 1000) : null;

  const reading = {
    cells: 64,
    server: { analysis_start_status: analysis, render_status: render, status_keys: Object.keys(busy).slice(0, 12) },
    memory: { studio_open: studioOpen, after_toggles: afterMemory },
    toggles: { count: toggles.length * 2, space_toggle_ms: toggles, slowest_paint_ms: toggling.nextPaintWorstMs, slowest_event_timing_ms: toggling.eventTimingWorstMs, long_tasks_ms: toggling.longTasks },
    frames: { frame_p95_ms: busyFrames.frameP95, worst_ms: busyFrames.frameWorst, long_tasks_ms: busyFrames.longTasks },
    main_player: { playing_elements: after.playing.length, media_time_advanced_ms: advanced, wall_ms: wallMs, waits_or_stalls: after.waits },
  };
  console.log(`S4-0111 ${JSON.stringify({ test: 'S4-0111-07', machine: await browserLine(page), budget: BUDGET, reading })}`);
  expect.soft(Math.max(toggling.nextPaintWorstMs, toggling.eventTimingWorstMs), 'slowest Studio toggle').toBeLessThanOrEqual(BUDGET.interactionMs);
  expect.soft(toggling.longTasks.filter((ms) => ms > BUDGET.longTaskMs), 'long tasks while toggling').toEqual([]);
  expect.soft(busyFrames.frameP95, 'Studio p95 frame while the server works').toBeLessThanOrEqual(BUDGET.frameP95Ms);
  expect.soft(after.waits, 'main player waited for data').toBe(0);
});
