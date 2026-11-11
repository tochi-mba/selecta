import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { rewriteJson } from '../e2e/helpers';
import { browserLine, frameWindow, installProbe, interactionsSince, mark, percentile, timed } from '../e2e/perf-probe';

/**
 * ADR-0162 MI-0162-04 (a 20,000-song Library) and MI-0162-05 (a 100-song draft in the Editor and the
 * 64-cell Studio), in Edge against tests/scale_server.py, with budgets. Run it with:
 *   pnpm exec playwright test --config bench/playwright.config.ts mi-0162
 * The library is synthetic: 19,988 copies of one made-up song's rows under invented names, so the
 * database, server and page are measured, not real music. Lab numbers from one shared 4-core laptop with
 * no GPU, headless; not field data and not independent. Results print as `MI-0162 {...}` lines and are
 * copied into docs/adr/selecta-microinteraction-performance-results.md.
 */

// Budgets, stated before measuring. "Usable" here means: the first rows within 3 s of opening, a
// narrowed list within 1.5 s of the last keystroke or a filter press, 1.5 s per page of 100 more rows,
// p95 frame at most 50 ms while scrolling (software compositing), no long task over 200 ms while
// scrolling, and every keystroke or press painted within 200 ms (the web.dev "good" INP threshold).
const BUDGET = {
  firstRowsMs: 3000,
  searchSettleMs: 1500,
  filterMs: 1500,
  morePageMs: 1500,
  frameP95Ms: 50,
  longTaskMs: 200,
  interactionMs: 200,
  editorOpenMs: 5000,
  moveMs: 1500,
};
const WINDOW_MS = 3000;

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

test('MI-0162-04 a 20,000-song library opens, searches, filters and scrolls deep within budget', async ({ page, request }) => {
  await installProbe(page);
  const counts = (await (await request.get('/api/status')).json()).counts;
  const everything = await total(request, 'state=all');
  expect(everything, 'the synthetic library is not 20,000 songs').toBeGreaterThanOrEqual(20_000);
  const shown = page.locator('.library-count');
  const rows = page.locator('.library-rows .song-row');

  const firstRowsMs = await timed(() => page.goto('/library'), () => expect(rows.first()).toBeVisible({ timeout: 60_000 }));
  await expect(shown).toContainText(`of ${everything} songs`);
  const loadLongTasks = (await interactionsSince(page, 0)).longTasks;

  // typing a search, one key at a time, timed from the last key to the narrowed count
  const golden = await total(request, 'q=golden&state=all');
  const box = page.getByRole('searchbox', { name: 'Search your library' }).or(page.getByRole('textbox', { name: 'Search your library' })).first();
  await box.click();
  const typingFrom = await mark(page);
  await box.pressSequentially('golden', { delay: 120 });
  const searchSettleMs = await timed(async () => undefined, () => expect(shown).toContainText(`of ${golden} songs`, { timeout: 30_000 }));
  await expect(rows.first()).toContainText(/golden/i);
  await expect(box).toBeFocused();
  const typing = await interactionsSince(page, typingFrom);
  await box.fill('');
  await expect(shown).toContainText(`of ${everything} songs`, { timeout: 30_000 });

  // a filter
  const ready = await total(request, 'state=ready');
  const filterFrom = await mark(page);
  const filterMs = await timed(() => page.getByRole('button', { name: 'Ready', exact: true }).click(),
    () => expect(shown).toContainText(ready < 100 ? `${ready} song` : `of ${ready} songs`, { timeout: 30_000 }));
  await expect(page).toHaveURL(/show=ready/);
  const filtering = await interactionsSince(page, filterFrom);
  await page.getByRole('button', { name: 'Everything', exact: true }).click();
  await expect(shown).toContainText(`of ${everything} songs`, { timeout: 30_000 });

  // deep: ten more pages from the keyboard, focus staying on the button, then scrolling through them
  const more = page.getByRole('button', { name: 'Show more songs' });
  await more.focus();
  const moreFrom = await mark(page);
  const pages: number[] = [];
  for (let round = 1; round <= 10; round += 1) {
    pages.push(await timed(() => page.keyboard.press('Enter'), () => expect(rows).toHaveCount(100 + round * 100, { timeout: 30_000 })));
    await expect(more).toBeFocused();
  }
  const paging = await interactionsSince(page, moreFrom);
  await page.evaluate(() => window.scrollTo(0, 0));
  const scrolling = await frameWindow(page, WINDOW_MS, { scrollBy: 400 });
  const domNodes = await page.evaluate(() => document.querySelectorAll('*').length);

  const reading = {
    songs: everything,
    counts,
    first_rows_ms: firstRowsMs,
    load_long_tasks_ms: loadLongTasks,
    search: { words: 'golden', matches: golden, settle_after_last_key_ms: searchSettleMs, slowest_key_paint_ms: typing.nextPaintWorstMs, slowest_event_timing_ms: typing.eventTimingWorstMs, long_tasks_ms: typing.longTasks },
    filter: { ready, ms: filterMs, slowest_paint_ms: filtering.nextPaintWorstMs, slowest_event_timing_ms: filtering.eventTimingWorstMs },
    more_pages: { rows_loaded: await rows.count(), median_ms: percentile(pages, 0.5), worst_ms: Math.max(...pages), slowest_key_paint_ms: paging.nextPaintWorstMs, slowest_event_timing_ms: paging.eventTimingWorstMs },
    scroll: scrolling,
    dom_nodes: domNodes,
  };
  console.log(`MI-0162 ${JSON.stringify({ test: 'MI-0162-04', machine: await browserLine(page), budget: BUDGET, reading })}`);

  expect.soft(firstRowsMs, 'first rows').toBeLessThanOrEqual(BUDGET.firstRowsMs);
  expect.soft(searchSettleMs, 'search settled').toBeLessThanOrEqual(BUDGET.searchSettleMs);
  expect.soft(Math.max(typing.nextPaintWorstMs, typing.eventTimingWorstMs), `slowest keystroke: ${typing.nextPaintWorst} / ${typing.eventTimingWorst}`).toBeLessThanOrEqual(BUDGET.interactionMs);
  expect.soft(filterMs, 'filter').toBeLessThanOrEqual(BUDGET.filterMs);
  expect.soft(Math.max(filtering.nextPaintWorstMs, filtering.eventTimingWorstMs), 'filter press painted').toBeLessThanOrEqual(BUDGET.interactionMs);
  expect.soft(Math.max(...pages), 'slowest page of 100 more').toBeLessThanOrEqual(BUDGET.morePageMs);
  expect.soft(Math.max(paging.nextPaintWorstMs, paging.eventTimingWorstMs), `slowest Enter on Show more: ${paging.nextPaintWorst}`).toBeLessThanOrEqual(BUDGET.interactionMs);
  expect.soft(scrolling.frameP95, 'scroll p95 frame over 1,100 rows').toBeLessThanOrEqual(BUDGET.frameP95Ms);
  expect.soft(scrolling.longTasks.filter((ms) => ms > BUDGET.longTaskMs), 'long tasks while scrolling').toEqual([]);
});

/** The real 2 sides x 4 lanes x 8 squares Studio (64 cells) for transition 1, with stand-in stems,
 * because splitting needs the big model. What is measured is the grid. */
async function withStudio(page: Page, request: APIRequestContext) {
  const row = Array.from({ length: 8 }, (_, index) => (index < 4 ? 1 : 0));
  const lanes = { vocals: row, drums: row, bass: row, other: row };
  const shape = { a: lanes, b: lanes };
  const first = (await (await request.get('/api/mix')).json()).mix[0].song_id;
  const stem = await (await request.get(`/api/songs/${first}/audio`)).body();
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: 'mi0162-bench', cells: 8, seconds: 8, bars: 16, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
}

const focusedCell = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-cell') ?? document.activeElement?.tagName ?? 'none');

test('MI-0162-05 a 100-song draft and the 64-cell Studio keep focus and stay quick', async ({ page, request }) => {
  await installProbe(page);
  await withStudio(page, request);
  const made = await (await request.post('/api/drafts', { data: { name: `MI-0162 hundred ${Date.now()}`, copy_current: true } })).json();
  const draftSongs = () => request.get(`/api/mix?draft=${made.id}`).then((answer) => answer.json()).then((body) => (body.mix as { song_id: number; title: string }[]));
  expect((await draftSongs()).length, 'the draft is not 100 songs').toBe(100);

  // the current mix plays while the draft is edited, as it would for a listener
  await page.goto('/listen');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).first().click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true }).first()).toBeVisible({ timeout: 60_000 });

  const openFrom = await mark(page);
  const editorOpenMs = await timed(() => go(page, `/mixes/drafts/${made.id}/edit`), () => expect(page.locator('.timeline > .song')).toHaveCount(100, { timeout: 60_000 }));
  const opening = await interactionsSince(page, openFrom);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  const editorScroll = await frameWindow(page, WINDOW_MS, { scrollBy: 300 });

  // keyboard reordering in the middle of the long draft: the moved song keeps the focus
  const moves: number[] = [];
  const keysFrom = await mark(page);
  let at = 50;
  const grip = (index: number) => page.locator('.timeline > .song').nth(index).locator('.grip');
  await grip(at).scrollIntoViewIfNeeded();
  await grip(at).focus();
  const name = await grip(at).getAttribute('aria-label');
  for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowUp', 'ArrowDown']) {
    const to = key === 'ArrowUp' ? at - 1 : at + 1;
    moves.push(await timed(() => page.keyboard.press(key), async () => {
      await expect(grip(to)).toBeFocused({ timeout: 30_000 });
      await expect(grip(to)).toHaveAttribute('aria-label', name!);
    }));
    at = to;
  }
  const reordering = await interactionsSince(page, keysFrom);
  const saved = await draftSongs();
  expect(`Reorder ${saved[at].title}`, 'the draft did not keep the move').toBe(name);

  // the 64-cell Studio, by keyboard
  await go(page, '/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  const studioFrom = await mark(page);
  const studioOpenMs = await timed(() => page.getByRole('button', { name: 'Open the Studio' }).click(), () => expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 120_000 }));
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click();
  const cells = page.locator('.studio-grid .studio-cell');
  await expect(cells).toHaveCount(64);
  const studioOpening = await interactionsSince(page, studioFrom);
  const studioIdle = await frameWindow(page, WINDOW_MS);
  const gridFrom = await mark(page);
  await page.locator('[data-cell="0-0"]').focus();
  const path: string[] = [];
  const press = async (key: string, expected: string) => {
    await page.keyboard.press(key);
    await expect.poll(() => focusedCell(page), { timeout: 5_000 }).toBe(expected);
    path.push(expected);
  };
  for (let column = 1; column < 8; column += 1) await press('ArrowRight', `0-${column}`);
  for (let row = 1; row < 8; row += 1) await press('ArrowDown', `${row}-7`);
  await press('Control+Home', '0-0');
  await press('Control+End', '7-7');
  await press('Home', '7-0');
  await press('ArrowLeft', '7--1');
  await press('ArrowRight', '7-0');
  const toggles: number[] = [];
  for (const target of ['7-0', '3-4', '0-7']) {
    await page.locator(`[data-cell="${target}"]`).focus();
    const square = page.locator(`[data-cell="${target}"]`);
    const before = await square.getAttribute('aria-pressed');
    toggles.push(await timed(() => page.keyboard.press('Space'), () => expect(square).not.toHaveAttribute('aria-pressed', before ?? '')));
    expect(await focusedCell(page), 'Space lost the focus').toBe(target);
    await page.keyboard.press('Space');
    await expect(square).toHaveAttribute('aria-pressed', before ?? '');
  }
  const gridKeys = await interactionsSince(page, gridFrom);

  const reading = {
    draft_songs: 100,
    editor: {
      open_ms: editorOpenMs,
      open_long_tasks_ms: opening.longTasks,
      scroll: editorScroll,
      keyboard_moves_ms: moves,
      slowest_key_paint_ms: reordering.nextPaintWorstMs,
      slowest_event_timing_ms: reordering.eventTimingWorstMs,
      focus_kept: true,
    },
    studio: {
      cells: 64,
      open_ms: studioOpenMs,
      open_long_tasks_ms: studioOpening.longTasks,
      idle: studioIdle,
      keys: path.length,
      space_toggle_ms: toggles,
      slowest_key_paint_ms: gridKeys.nextPaintWorstMs,
      key_paint_p50_ms: gridKeys.nextPaintP50Ms,
      slowest_event_timing_ms: gridKeys.eventTimingWorstMs,
      long_tasks_ms: gridKeys.longTasks,
      focus_path: path.join(' '),
    },
  };
  console.log(`MI-0162 ${JSON.stringify({ test: 'MI-0162-05', machine: await browserLine(page), budget: BUDGET, reading })}`);

  expect.soft(editorOpenMs, '100-song draft opened').toBeLessThanOrEqual(BUDGET.editorOpenMs);
  expect.soft(editorScroll.frameP95, 'editor scroll p95 frame').toBeLessThanOrEqual(BUDGET.frameP95Ms);
  expect.soft(editorScroll.longTasks.filter((ms) => ms > BUDGET.longTaskMs), 'long tasks while scrolling the editor').toEqual([]);
  expect.soft(Math.max(...moves), 'slowest keyboard move with focus kept').toBeLessThanOrEqual(BUDGET.moveMs);
  expect.soft(Math.max(reordering.nextPaintWorstMs, reordering.eventTimingWorstMs), `slowest reorder key: ${reordering.nextPaintWorst}`).toBeLessThanOrEqual(BUDGET.interactionMs);
  expect.soft(studioIdle.frameP95, 'Studio p95 frame').toBeLessThanOrEqual(BUDGET.frameP95Ms);
  expect.soft(Math.max(gridKeys.nextPaintWorstMs, gridKeys.eventTimingWorstMs), `slowest Studio key: ${gridKeys.nextPaintWorst}`).toBeLessThanOrEqual(BUDGET.interactionMs);
  expect.soft(gridKeys.longTasks.filter((ms) => ms > BUDGET.longTaskMs), 'long tasks while moving around the Studio').toEqual([]);
  await request.delete(`/api/drafts/${made.id}`);
});
